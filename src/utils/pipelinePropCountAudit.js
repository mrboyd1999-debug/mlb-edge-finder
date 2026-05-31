/**
 * Stage-by-stage prop count diagnostics — pinpoints pipeline drop-off.
 */

import { passesVerifiedBestPlaysFilter } from "./bestPlaysPipelineDebug.js";
import { countMergedProjections } from "./projectionCoverageAudit.js";
import {
  isBlockedNonMlbPipelineProp,
  resolveSupportedMlbMarketKey,
} from "./mlbAllowedMarkets.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { resolveHistoricalDataPresent } from "./tierHistoricalValidation.js";

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

export function createEmptyPipelineRejections() {
  return {
    nonMLB: 0,
    unsupportedSport: 0,
    unsupportedMarket: 0,
    missingPlayer: 0,
    missingLine: 0,
    missingMarket: 0,
    missingTeam: 0,
    badLine: 0,
    duplicate: 0,
    noProjectionFormula: 0,
    noHistoricalData: 0,
    noPlayerMatch: 0,
    providerTimeout: 0,
    parserFailed: 0,
    other: 0,
  };
}

export function countVerifiedFilterProps(props = []) {
  return (props || []).filter((prop) => passesVerifiedBestPlaysFilter(prop)).length;
}

function propDedupeKey(prop = {}) {
  return (
    String(prop.id || "").trim() ||
    `${String(prop.playerName || prop.player || "").trim()}|${String(prop.statType || prop.market || prop.propType || "").trim()}|${Number(prop.line)}|${String(prop.source || prop.platform || "").trim()}`
  );
}

function isValidPropLine(prop = {}) {
  const line = Number(prop.line);
  return Number.isFinite(line) && line > 0;
}

/**
 * Build projection board pool — only hard-drop non-MLB, missing player, bad line.
 * Unsupported markets stay on board with flags (Research Only path).
 */
export function buildMlbProjectionBoardPool(props = [], { seenIds = null } = {}) {
  const rejections = createEmptyPipelineRejections();
  const seen = seenIds instanceof Set ? seenIds : new Set();
  const afterDuplicateRemoval = [];
  const afterSportFilter = [];
  const afterPlayerNormalization = [];
  const afterLineValidation = [];
  const boardProps = [];
  const projectionCandidates = [];
  let unsupportedMarketKept = 0;

  for (const prop of props || []) {
    if (!prop) continue;

    const dedupeKey = propDedupeKey(prop);
    if (seen.has(dedupeKey)) {
      rejections.duplicate += 1;
      continue;
    }
    seen.add(dedupeKey);
    afterDuplicateRemoval.push(prop);

    if (isBlockedNonMlbPipelineProp(prop)) {
      rejections.nonMLB += 1;
      continue;
    }
    const sport = resolvePropSport(prop);
    if (sport && sport !== "MLB") {
      rejections.unsupportedSport += 1;
      continue;
    }
    if (sport !== "MLB") {
      rejections.nonMLB += 1;
      continue;
    }
    afterSportFilter.push(prop);

    const playerName = String(prop.playerName || prop.player || "").trim();
    if (!playerName) {
      rejections.missingPlayer += 1;
      continue;
    }
    afterPlayerNormalization.push(prop);

    if (!isValidPropLine(prop)) {
      const line = Number(prop.line);
      if (!Number.isFinite(line)) rejections.missingLine += 1;
      else rejections.badLine += 1;
      continue;
    }
    afterLineValidation.push(prop);

    const statType = String(prop.statType || prop.market || prop.propType || "").trim();
    const marketKey = resolveSupportedMlbMarketKey(prop);
    if (!statType) rejections.missingMarket += 1;
    if (!String(prop.team || "").trim()) rejections.missingTeam += 1;

    if (!marketKey) {
      rejections.unsupportedMarket += 1;
      unsupportedMarketKept += 1;
    }

    const enriched = {
      ...prop,
      playerName: prop.playerName || playerName,
      unsupportedMarketForProjection: !marketKey,
      displayResearchOnly: !marketKey ? true : Boolean(prop.displayResearchOnly),
      projectionMarketSupported: Boolean(marketKey),
    };
    boardProps.push(enriched);

    if (statType && isValidPropLine(enriched)) {
      projectionCandidates.push(enriched);
    }
  }

  const afterMarketFilter = boardProps.filter((prop) => prop.projectionMarketSupported);

  return {
    boardProps,
    afterSportFilter,
    afterMlbOnlyFilter: afterSportFilter,
    afterDuplicateRemoval,
    afterMarketFilter,
    afterPlayerNormalization,
    afterLineValidation,
    projectionCandidates,
    unsupportedMarketKept,
    rejections,
  };
}

/** @deprecated use buildMlbProjectionBoardPool for board sizing */
export function auditPipelineFilterStages(props = [], options = {}) {
  return buildMlbProjectionBoardPool(props, options);
}

export function countHistoricalAttachment(props = [], statsMap = null) {
  void statsMap;
  let attached = 0;
  let missing = 0;
  for (const prop of props || []) {
    const present = resolveHistoricalDataPresent(prop).present;
    if (present || prop?.historicalStatsAttached || prop?.hasGameLogs) attached += 1;
    else missing += 1;
  }
  return { attached, missing, total: (props || []).length };
}

export function evaluateCoverageWarning(audit = {}) {
  const combined = finiteCount(audit.combinedRaw);
  const board = finiteCount(audit.normalizedProps || audit.afterLineValidation);
  const projected = finiteCount(audit.projectedProps);
  const candidates = finiteCount(audit.projectionCandidates);
  const rejections = audit.rejections || {};
  const topRejection = Object.entries(rejections)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0];

  const issues = [];
  if (combined > 0 && combined < 500) {
    issues.push("Combined raw props under 500 — inspect PrizePicks/Underdog fetch or cache.");
  }
  if (combined >= 500 && board < 200) {
    issues.push("Board collapsed after normalization — inspect parser or sport filter.");
  }
  if (board >= 200 && candidates < 100) {
    issues.push("Projection eligibility under 100 — inspect line/player/statType validation.");
  }
  if (candidates >= 100 && projected < Math.min(400, Math.floor(candidates * 0.3))) {
    issues.push("Projection merge underfilled — inspect MLB Stats fetch cap and player matching.");
  }

  if (!issues.length) return null;

  return {
    message: "Coverage warning: projection board is underfilled",
    issues,
    topRejectionReason: topRejection ? `${topRejection[0]}: ${topRejection[1]}` : null,
    dropOffStage: audit.dropOffStage || null,
    dropOffDetail: audit.dropOffDetail || null,
  };
}

export function buildPipelinePropCountAudit({
  rawPrizePicks = 0,
  rawUnderdog = 0,
  combinedRaw = 0,
  afterCacheMerge = 0,
  normalizedProps = 0,
  afterSportFilter = 0,
  afterMlbOnlyFilter = 0,
  afterMarketFilter = 0,
  afterDuplicateRemoval = 0,
  afterPlayerNormalization = 0,
  afterLineValidation = 0,
  projectionCandidates = 0,
  projectedProps = 0,
  afterHistoricalAttachment = 0,
  verifiedProps = 0,
  displayedProps = 0,
  rejections = null,
  rawPropsFetched = 0,
  afterProjectionFilter = 0,
  afterProjectionMerge = 0,
  afterVerificationFilter = 0,
} = {}) {
  const rawPP = finiteCount(rawPrizePicks);
  const rawUD = finiteCount(rawUnderdog);
  const combined = finiteCount(combinedRaw || rawPropsFetched);
  const cacheMerge = finiteCount(afterCacheMerge || combined);
  const normalized = finiteCount(normalizedProps);
  const sport = finiteCount(afterSportFilter);
  const mlbOnly = finiteCount(afterMlbOnlyFilter || afterSportFilter);
  const dupes = finiteCount(afterDuplicateRemoval || normalized);
  const market = finiteCount(afterMarketFilter);
  const playerNorm = finiteCount(afterPlayerNormalization);
  const lineValid = finiteCount(afterLineValidation);
  const projCand = finiteCount(projectionCandidates || afterProjectionFilter);
  const projected = finiteCount(projectedProps || afterProjectionMerge);
  const historical = finiteCount(afterHistoricalAttachment);
  const verified = finiteCount(verifiedProps || afterVerificationFilter);
  const displayed = finiteCount(displayedProps);
  const rejectionMap = rejections || createEmptyPipelineRejections();

  const stages = [
    { key: "raw_prizepicks", label: "PrizePicks raw props", count: rawPP },
    { key: "raw_underdog", label: "Underdog raw props", count: rawUD },
    { key: "combined_raw", label: "Combined raw props", count: combined },
    { key: "cache_merge", label: "After cache merge", count: cacheMerge },
    { key: "normalized", label: "Normalized props", count: normalized },
    { key: "sport_filter", label: "After sport filter", count: sport },
    { key: "mlb_only_filter", label: "After MLB-only filter", count: mlbOnly },
    { key: "duplicate_removal", label: "After duplicate removal", count: dupes },
    { key: "market_filter", label: "After market filter (supported only)", count: market },
    { key: "player_normalization", label: "After player normalization", count: playerNorm },
    { key: "line_validation", label: "After line validation", count: lineValid },
    { key: "projection_eligibility", label: "After projection eligibility", count: projCand },
    { key: "projected", label: "Projected props", count: projected },
    { key: "historical_attachment", label: "After historical attachment", count: historical },
    { key: "verification", label: "Verified props", count: verified },
    { key: "displayed", label: "Top displayed plays", count: displayed },
  ];

  let dropOffStage = null;
  let dropOffDetail = "";

  for (let index = 1; index < stages.length; index += 1) {
    const prev = stages[index - 1];
    const next = stages[index];
    if (prev.count <= 0) continue;
    const lost = prev.count - next.count;
    const lossPct = lost / prev.count;
    if (lost > 0 && (lossPct >= 0.35 || (prev.count >= 200 && lost >= 100))) {
      dropOffStage = next.key;
      dropOffDetail = `${prev.label} ${prev.count} → ${next.label} ${next.count} (−${lost}, ${Math.round(lossPct * 100)}%)`;
      break;
    }
  }

  const audit = {
    stages,
    rawPrizePicks: rawPP,
    rawUnderdog: rawUD,
    combinedRaw: combined,
    rawPropsFetched: combined,
    afterCacheMerge: cacheMerge,
    normalizedProps: normalized,
    afterSportFilter: sport,
    afterMlbOnlyFilter: mlbOnly,
    afterDuplicateRemoval: dupes,
    afterMarketFilter: market,
    afterPlayerNormalization: playerNorm,
    afterLineValidation: lineValid,
    projectionCandidates: projCand,
    afterProjectionFilter: projCand,
    projectedProps: projected,
    afterProjectionMerge: projected,
    afterHistoricalAttachment: historical,
    verifiedProps: verified,
    afterVerificationFilter: verified,
    displayedProps: displayed,
    rejections: rejectionMap,
    dropOffStage,
    dropOffDetail,
    coverageWarning: null,
    updatedAt: new Date().toISOString(),
  };

  audit.coverageWarning = evaluateCoverageWarning(audit);
  return audit;
}

export function logPipelinePropCountAudit(audit = {}) {
  logPipelineCoverageAudit(audit);
  return audit;
}

export function logPipelineCoverageAudit(audit = {}) {
  console.log("[Pipeline] PrizePicks raw", audit.rawPrizePicks ?? 0);
  console.log("[Pipeline] Underdog raw", audit.rawUnderdog ?? 0);
  console.log("[Pipeline] Combined raw", audit.combinedRaw ?? audit.rawPropsFetched ?? 0);
  console.log("[Pipeline] After cache merge", audit.afterCacheMerge ?? audit.combinedRaw ?? 0);
  console.log("[Pipeline] After sport filter", audit.afterSportFilter ?? 0);
  console.log("[Pipeline] After market filter", audit.afterMarketFilter ?? 0);
  console.log("[Pipeline] After projection eligibility", audit.projectionCandidates ?? audit.afterProjectionFilter ?? 0);
  console.log("[Pipeline] Projected props", audit.projectedProps ?? audit.afterProjectionMerge ?? 0);
  console.log("[Pipeline] Verified props", audit.verifiedProps ?? audit.afterVerificationFilter ?? 0);

  if (audit.rejections && Object.values(audit.rejections).some((n) => Number(n) > 0)) {
    console.log("[Pipeline] Rejected by reason", audit.rejections);
  }
  if (audit.dropOffStage) {
    console.warn("[Pipeline] Primary drop-off:", audit.dropOffStage, audit.dropOffDetail || "");
  }
  if (audit.coverageWarning) {
    console.warn("[Pipeline]", audit.coverageWarning.message, audit.coverageWarning);
  }
  return audit;
}

export function summarizePipelinePropCounts(props = []) {
  return {
    withProjections: countMergedProjections(props),
    verified: countVerifiedFilterProps(props),
  };
}
