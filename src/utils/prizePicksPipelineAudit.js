/**
 * End-to-end PrizePicks pipeline audit — logging only, no logic changes.
 */

import { normalizeSource } from "./normalizeSource.js";
import { buildMlbProjectionBoardPool } from "./pipelinePropCountAudit.js";
import { resolvePrizePicksPropCounts } from "./providerStatus.js";
import { classifyVerifiedTier, explainVerificationRejection } from "./verifiedTierSystem.js";
import { passesVerifiedBestPlaysFilter } from "./bestPlaysPipelineDebug.js";
import { resolveVerificationStatus, VERIFICATION_STATUS, resolvePlayProjection } from "./verificationStatus.js";
import { isFakeOrFallbackProp } from "./livePropRender.js";
import { isMinimalRenderableProp } from "./normalizeProp.js";
import { filterResolvedSportProps } from "./underdogSportDetection.js";
import { isBlockedNonMlbPipelineProp } from "./mlbAllowedMarkets.js";
import { resolvePropSport } from "./mlbOnlyMode.js";

const MAX_DROPPED_SAMPLES = 10;

export function isPrizePicksProp(prop = {}) {
  return normalizeSource(prop) === "prizepicks";
}

export function filterPrizePicksProps(props = []) {
  return (props || []).filter(isPrizePicksProp);
}

function propKey(prop = {}) {
  return `${String(prop.playerName || prop.player || "").trim()}|${String(prop.statType || prop.market || prop.propType || "").trim()}|${Number(prop.line)}`;
}

function summarizeDroppedProp(prop = {}, reason = "") {
  return {
    player: prop.playerName || prop.player || "Unknown",
    market: prop.statType || prop.market || prop.propType || "—",
    line: prop.line ?? "—",
    team: prop.team || "—",
    reason: reason || "removed",
  };
}

function buildStageDiff(inputProps = [], outputProps = [], classifyDrop) {
  const input = filterPrizePicksProps(inputProps);
  const output = filterPrizePicksProps(outputProps);
  const outputKeys = new Set(output.map(propKey));
  const dropped = [];

  for (const prop of input) {
    if (outputKeys.has(propKey(prop))) continue;
    const reason = typeof classifyDrop === "function" ? classifyDrop(prop) : "removed";
    dropped.push(summarizeDroppedProp(prop, reason));
  }

  const dropReasons = dropped.reduce((acc, row) => {
    acc[row.reason] = (acc[row.reason] || 0) + 1;
    return acc;
  }, {});

  return {
    inputCount: input.length,
    outputCount: output.length,
    droppedCount: Math.max(0, input.length - output.length),
    dropReason: summarizeDropReasons(dropReasons),
    dropReasons,
    droppedSamples: dropped.slice(0, MAX_DROPPED_SAMPLES),
  };
}

function summarizeDropReasons(reasonCounts = {}) {
  const entries = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "none";
  return entries.map(([reason, count]) => `${reason} (${count})`).join(" · ");
}

function classifyNormalizeDrop(prop = {}) {
  const dedupeKey = propKey(prop);
  if (!dedupeKey.split("|")[0]) return "missing player";
  if (isBlockedNonMlbPipelineProp(prop)) return "non-MLB blocked";
  const sport = resolvePropSport(prop);
  if (sport && sport !== "MLB") return "unsupported sport";
  if (sport !== "MLB") return "non-MLB sport";
  const playerName = String(prop.playerName || prop.player || "").trim();
  if (!playerName) return "missing player";
  const line = Number(prop.line);
  if (!Number.isFinite(line)) return "missing line";
  if (line <= 0) return "bad line";
  return "board pool filter";
}

function classifyProjectDrop(prop = {}) {
  const projection = resolvePlayProjection(prop);
  if (projection == null || projection <= 0) {
    return prop.projectionMissingReason || prop.sportsDataMatchReason || "no projection";
  }
  return "no projection";
}

function classifyVerifyDrop(prop = {}) {
  const status = resolveVerificationStatus(prop);
  if (status === VERIFICATION_STATUS.UNVERIFIED) {
    return explainVerificationRejection(prop) || "unverified";
  }
  if (status === VERIFICATION_STATUS.RESEARCH) return "research only";
  if (!passesVerifiedBestPlaysFilter(prop)) {
    return explainVerificationRejection(prop) || "failed verified filter";
  }
  return "failed verification";
}

function classifyTierDrop(prop = {}) {
  const tier = classifyVerifiedTier(prop);
  if (!tier) return explainVerificationRejection(prop) || "no tier assigned";
  return "no tier assigned";
}

function classifyRenderDrop(prop = {}, { allowFallbackProps = false } = {}) {
  if (!allowFallbackProps && isFakeOrFallbackProp(prop)) return "fallback/demo prop";
  const mlb = filterResolvedSportProps([prop], "MLB", { selectedSportTab: "MLB" });
  if (!mlb.length) return "sport filter";
  if (!isMinimalRenderableProp(prop)) return "not minimally renderable";
  return "render filter";
}

function logPrizePicksStage(tag, stage = {}) {
  console.log(`[${tag}]`, {
    input: stage.inputCount ?? 0,
    output: stage.outputCount ?? 0,
    dropped: stage.droppedCount ?? 0,
    dropReason: stage.dropReason || "none",
  });
  if (stage.droppedSamples?.length) {
    console.log(`[${tag}] dropped sample`, stage.droppedSamples);
  }
}

function filterProjectedPrizePicks(props = []) {
  return filterPrizePicksProps(props).filter((prop) => {
    const projection = resolvePlayProjection(prop);
    return projection != null && projection > 0;
  });
}

function filterVerifiedPrizePicks(props = []) {
  return filterPrizePicksProps(props).filter((prop) => {
    const status = resolveVerificationStatus(prop);
    return status === VERIFICATION_STATUS.FULL || status === VERIFICATION_STATUS.PARTIAL;
  });
}

function filterTieredPrizePicks(props = []) {
  return filterPrizePicksProps(props).filter((prop) => Boolean(classifyVerifiedTier(prop)));
}

export function buildPrizePicksPipelineAudit({
  prizePicksResult = null,
  fetchRawCount = null,
  parseProps = null,
  normalizedProps = null,
  allDisplayProps = [],
  acceptedPropsForRender = [],
  pipelinePropCountAudit = null,
  debugInfo = null,
  allowFallbackRender = false,
} = {}) {
  const ppCounts = resolvePrizePicksPropCounts({
    prizePicksResult,
    prizePicksProps: parseProps,
    pipelinePropCountAudit,
    debugInfo,
  });

  const parsedProps =
    parseProps != null
      ? filterPrizePicksProps(parseProps)
      : filterPrizePicksProps(prizePicksResult?.props || prizePicksResult?.parsedProps || []);

  const fetchCount = Math.max(
    Number(fetchRawCount ?? 0),
    ppCounts.rawPrizePicksProps,
    Number(prizePicksResult?.pipelineAudit?.fetched ?? 0),
    parsedProps.length
  );

  const parseStage = {
    inputCount: fetchCount,
    outputCount: parsedProps.length,
    droppedCount: Math.max(0, fetchCount - parsedProps.length),
    dropReason:
      fetchCount > parsedProps.length
        ? prizePicksResult?.pipelineAudit?.filterReasons
          ? summarizeDropReasons(prizePicksResult.pipelineAudit.filterReasons)
          : "parser/filter drop"
        : "none",
    droppedSamples: [],
  };

  const fetchStage = {
    inputCount: 0,
    outputCount: fetchCount,
    droppedCount: fetchCount > 0 ? 0 : 0,
    dropReason: fetchCount > 0 ? "none" : "fetch returned 0",
    droppedSamples: [],
  };

  const normalizeInput = parsedProps;
  let normalizeOutput = normalizedProps != null ? filterPrizePicksProps(normalizedProps) : [];
  if (!normalizeOutput.length && normalizeInput.length) {
    const pool = buildMlbProjectionBoardPool(normalizeInput);
    normalizeOutput = filterPrizePicksProps(pool.boardProps);
  }
  const normalizeStage = buildStageDiff(normalizeInput, normalizeOutput, classifyNormalizeDrop);
  if (normalizeStage.dropReason === "none" && prizePicksResult?.pipelineAudit?.filterReasons) {
    normalizeStage.dropReason = summarizeDropReasons(prizePicksResult.pipelineAudit.filterReasons);
  }

  const projectedProps = filterProjectedPrizePicks(allDisplayProps.length ? allDisplayProps : normalizeOutput);
  const projectStage = buildStageDiff(
    normalizeOutput.length ? normalizeOutput : normalizeInput,
    projectedProps,
    classifyProjectDrop
  );

  const verifiedProps = filterVerifiedPrizePicks(allDisplayProps.length ? allDisplayProps : projectedProps);
  const verifyStage = buildStageDiff(
    projectedProps.length ? projectedProps : normalizeOutput,
    verifiedProps,
    classifyVerifyDrop
  );

  const tieredProps = filterTieredPrizePicks(allDisplayProps.length ? allDisplayProps : verifiedProps);
  const tierStage = buildStageDiff(
    verifiedProps.length ? verifiedProps : projectedProps,
    tieredProps,
    classifyTierDrop
  );

  const renderedProps = filterPrizePicksProps(acceptedPropsForRender);
  const renderInput = allDisplayProps.length ? allDisplayProps : tieredProps;
  const renderStage = buildStageDiff(renderInput, renderedProps, (prop) =>
    classifyRenderDrop(prop, { allowFallbackProps: allowFallbackRender })
  );

  const summary = {
    PP_FETCH: fetchCount,
    PP_PARSE: parseStage.outputCount,
    PP_NORMALIZE: normalizeStage.outputCount,
    PP_PROJECT: projectStage.outputCount,
    PP_VERIFY: verifyStage.outputCount,
    PP_TIER: tierStage.outputCount,
    PP_RENDER: renderStage.outputCount,
  };

  const blockingStage = identifyBlockingStage({
    fetchCount,
    stages: {
      parse: parseStage,
      normalize: normalizeStage,
      project: projectStage,
      verify: verifyStage,
      tier: tierStage,
      render: renderStage,
    },
  });

  return {
    summary,
    stages: {
      fetch: fetchStage,
      parse: parseStage,
      normalize: normalizeStage,
      project: projectStage,
      verify: verifyStage,
      tier: tierStage,
      render: renderStage,
    },
    blockingStage,
    updatedAt: new Date().toISOString(),
  };
}

function identifyBlockingStage({ fetchCount = 0, stages = {} } = {}) {
  if (fetchCount <= 0) {
    return { stage: "fetch", reason: "PrizePicks fetch returned 0 raw props" };
  }
  if (stages.render?.outputCount > 0) return null;

  const order = [
    ["parse", stages.parse, "PrizePicks parser returned 0 props"],
    ["normalize", stages.normalize, "normalization/board pool removed all PrizePicks props"],
    ["project", stages.project, "projection attachment removed all PrizePicks props"],
    ["verify", stages.verify, "verification removed all PrizePicks props"],
    ["tier", stages.tier, "tier assignment removed all PrizePicks props"],
    ["render", stages.render, "board render removed all PrizePicks props"],
  ];

  for (const [name, stage, fallbackReason] of order) {
    if (!stage) continue;
    if (stage.inputCount > 0 && stage.outputCount === 0) {
      return {
        stage: name,
        reason: stage.dropReason && stage.dropReason !== "none" ? stage.dropReason : fallbackReason,
        droppedSamples: stage.droppedSamples || [],
      };
    }
  }

  return {
    stage: "unknown",
    reason: "PrizePicks props fetched but none rendered — inspect stage logs",
  };
}

export function logPrizePicksPipelineAudit(audit = {}) {
  const summary = audit.summary || {};
  console.log("[PrizePicks Pipeline Audit] summary", summary);
  console.log(
    `[PP_PIPELINE] FETCH=${summary.PP_FETCH ?? 0} PARSE=${summary.PP_PARSE ?? 0} NORMALIZE=${summary.PP_NORMALIZE ?? 0} PROJECT=${summary.PP_PROJECT ?? 0} VERIFY=${summary.PP_VERIFY ?? 0} RENDER=${summary.PP_RENDER ?? 0}`
  );

  logPrizePicksStage("PP_FETCH", audit.stages?.fetch);
  logPrizePicksStage("PP_PARSE", audit.stages?.parse);
  logPrizePicksStage("PP_NORMALIZE", audit.stages?.normalize);
  logPrizePicksStage("PP_PROJECT", audit.stages?.project);
  logPrizePicksStage("PP_VERIFY", audit.stages?.verify);
  logPrizePicksStage("PP_TIER", audit.stages?.tier);
  logPrizePicksStage("PP_RENDER", audit.stages?.render);

  if (audit.blockingStage) {
    console.warn("[PrizePicks Pipeline Audit] blocking stage", audit.blockingStage);
  }

  if ((summary.PP_FETCH ?? 0) > 0 && (summary.PP_RENDER ?? 0) === 0 && audit.blockingStage) {
    console.error("[PrizePicks Pipeline Audit] fetched > 0 but rendered = 0", {
      blockingStage: audit.blockingStage.stage,
      exactDropReason: audit.blockingStage.reason,
      droppedSamples: audit.blockingStage.droppedSamples || [],
    });
  }

  return audit;
}

export function buildAndLogPrizePicksPipelineAudit(options = {}) {
  const audit = buildPrizePicksPipelineAudit(options);
  logPrizePicksPipelineAudit(audit);
  return audit;
}
