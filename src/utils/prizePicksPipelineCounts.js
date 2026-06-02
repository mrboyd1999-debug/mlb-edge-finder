/**
 * Single source of truth for PrizePicks pipeline stage counts.
 * Used by live feed probe, provider status, and diagnostics panels.
 */

import {
  auditPrizePicksParseStages,
  countPrizePicksRawRecords,
  validatePrizePicksNormalizedProp,
} from "./prizepicksParse.js";
import { LIVE_STAGE_LABELS } from "./liveFeedFailureAnalysis.js";
import { resolveExactFailureReason } from "./liveFeedFailureAnalysis.js";
import { getPrizePicksUsableCount } from "./providerCounts.js";
import { resolvePrizePicksPropCounts } from "./providerStatus.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function countUsableFromProps(props = []) {
  return (props || []).filter((prop) => validatePrizePicksNormalizedProp(prop)).length;
}

/** Resolve stage counts from payload + optional normalized props list. */
export function resolvePrizePicksPipelineStages({
  payload = null,
  normalizedProps = null,
  prizePicksResult = null,
  prizePicksProps = null,
  pipelinePropCountAudit = null,
  debugInfo = null,
  feedHealthContext = null,
  httpStatus = null,
  lastError = "",
  usedCache = false,
  liveFetchFailed = false,
} = {}) {
  const parseAudit = payload ? auditPrizePicksParseStages(payload) : { raw: 0, parsed: 0, failureReason: "", blocked: false };
  const propsList = Array.isArray(normalizedProps)
    ? normalizedProps
    : Array.isArray(prizePicksProps)
      ? prizePicksProps
      : Array.isArray(prizePicksResult?.props)
        ? prizePicksResult.props
        : [];

  const ppCounts = resolvePrizePicksPropCounts({
    prizePicksResult,
    prizePicksProps: propsList,
    pipelinePropCountAudit,
    debugInfo,
    feedHealthContext,
  });

  const normalizedFromProps = propsList.filter((prop) => validatePrizePicksNormalizedProp(prop)).length;
  const normalized = Math.max(
    normalizedFromProps,
    finite(prizePicksResult?.debug?.propsAfterParsing),
    finite(ppCounts.usablePrizePicksProps),
    finite(ppCounts.parsedPrizePicksProps)
  );
  const parsed = Math.max(
    parseAudit.parsed,
    finite(ppCounts.parsedPrizePicksProps),
    finite(prizePicksResult?.pipelineAudit?.fetched),
    finite(prizePicksResult?.debug?.propsAfterParsing),
    propsList.length
  );
  const raw = Math.max(
    parseAudit.raw,
    countPrizePicksRawRecords(payload),
    finite(ppCounts.rawPrizePicksProps),
    finite(prizePicksResult?.debug?.rawPropsLoaded),
    finite(prizePicksResult?.pipelineAudit?.fetched),
    parsed
  );
  const usable = Math.max(
    normalizedFromProps,
    countUsableFromProps(propsList),
    getPrizePicksUsableCount({
      prizePicksProps: propsList,
      prizePicksResult,
      ppCounts,
      pipelinePropCountAudit,
      debugInfo,
      audit: {
        prizepicksParsed: parsed,
        prizepicksUsable: normalized,
        prizepicksFetched: raw,
      },
    }),
    finite(ppCounts.usablePrizePicksProps)
  );

  let failureReason = parseAudit.failureReason || "";
  if (parseAudit.blocked) {
    failureReason = parseAudit.failureReason;
  } else if (raw > 0 && parsed === 0) {
    failureReason =
      failureReason ||
      "Parser failure — projection rows present but line_score/stat_type/player linkage missing";
  } else if (parsed > 0 && normalized === 0) {
    failureReason = "Normalization failure — parsed rows missing playerName/statType/line/team/league";
  } else if (normalized > 0 && usable === 0) {
    failureReason = "Filter failure — normalized props removed by sport/market filters";
  } else if (raw === 0 && !failureReason) {
    failureReason = lastError || "Fetch returned empty projections array";
  }

  const exactFailure = resolveExactFailureReason({
    httpStatus,
    lastError: failureReason || lastError,
    fetched: raw,
    parsed,
    normalized,
    filtered: usable,
    usedCache,
    liveFetchFailed,
  });

  const stages = {
    [LIVE_STAGE_LABELS.FETCHED]: raw,
    [LIVE_STAGE_LABELS.PARSED]: parsed,
    [LIVE_STAGE_LABELS.NORMALIZED]: normalized,
    [LIVE_STAGE_LABELS.FILTERED]: usable,
  };

  return {
    raw,
    parsed,
    normalized,
    usable,
    merged: usable,
    failureReason,
    exactFailure,
    stages,
    blocked: Boolean(parseAudit.blocked),
    sample: propsList.slice(0, 3).map((prop) => ({
      playerName: prop.playerName || prop.player,
      statType: prop.statType || prop.market,
      line: prop.line,
      team: prop.team,
      league: prop.league || prop.sport,
    })),
  };
}

export function logPrizePicksPipelineStages(tag = "PP_PIPELINE", stages = {}) {
  console.log(`[${tag}]`, {
    raw: stages.raw ?? 0,
    parsed: stages.parsed ?? 0,
    normalized: stages.normalized ?? 0,
    usable: stages.usable ?? 0,
    merged: stages.merged ?? stages.usable ?? 0,
    failureReason: stages.failureReason || "none",
  });
  if (stages.stages) {
    console.log(`[${tag}] stages`, stages.stages);
  }
  if (stages.sample?.length) {
    console.log(`[${tag}] sample`, stages.sample);
  }
}
