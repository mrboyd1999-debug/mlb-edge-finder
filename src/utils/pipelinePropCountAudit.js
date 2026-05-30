/**
 * Stage-by-stage prop count diagnostics — pinpoints pipeline drop-off.
 */

import { passesVerifiedBestPlaysFilter } from "./bestPlaysPipelineDebug.js";
import { countMergedProjections, isMlbProjectionGenerationCandidate } from "./projectionCoverageAudit.js";
import {
  isBlockedNonMlbPipelineProp,
  isSupportedMlbMarket,
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
    unsupportedMarket: 0,
    missingPlayer: 0,
    missingLine: 0,
    missingMarket: 0,
    duplicate: 0,
    noProjectionFormula: 0,
    noHistoricalData: 0,
    other: 0,
  };
}

export function countVerifiedFilterProps(props = []) {
  return (props || []).filter((prop) => passesVerifiedBestPlaysFilter(prop)).length;
}

/** Count rejections at each MLB pipeline gate without silently dropping props. */
export function auditPipelineFilterStages(props = [], { seenIds = null } = {}) {
  const rejections = createEmptyPipelineRejections();
  const seen = seenIds instanceof Set ? seenIds : new Set();
  const afterSportFilter = [];
  const afterMlbOnlyFilter = [];
  const afterMarketFilter = [];
  const afterPlayerNormalization = [];
  const projectionCandidates = [];

  for (const prop of props || []) {
    if (!prop) continue;

    const id = String(prop.id || "").trim();
    if (id && seen.has(id)) {
      rejections.duplicate += 1;
      continue;
    }
    if (id) seen.add(id);

    if (isBlockedNonMlbPipelineProp(prop) || resolvePropSport(prop) !== "MLB") {
      rejections.nonMLB += 1;
      continue;
    }
    afterSportFilter.push(prop);
    afterMlbOnlyFilter.push(prop);

    if (!isSupportedMlbMarket(prop)) {
      rejections.unsupportedMarket += 1;
      continue;
    }
    afterMarketFilter.push(prop);

    const playerName = String(prop.playerName || prop.player || "").trim();
    if (!playerName) {
      rejections.missingPlayer += 1;
      continue;
    }
    afterPlayerNormalization.push(prop);

    if (!isMlbProjectionGenerationCandidate(prop)) {
      const line = Number(prop.line);
      const statType = String(prop.statType || prop.market || prop.propType || "").trim();
      if (!Number.isFinite(line) || line <= 0) rejections.missingLine += 1;
      else if (!statType) rejections.missingMarket += 1;
      else rejections.other += 1;
      continue;
    }
    projectionCandidates.push(prop);
  }

  return {
    afterSportFilter,
    afterMlbOnlyFilter,
    afterMarketFilter,
    afterPlayerNormalization,
    projectionCandidates,
    rejections,
  };
}

export function countHistoricalAttachment(props = [], statsMap = null) {
  let attached = 0;
  let missing = 0;
  for (const prop of props || []) {
    const present = resolveHistoricalDataPresent(prop).present;
    if (present || prop?.historicalStatsAttached || prop?.hasGameLogs) attached += 1;
    else missing += 1;
  }
  return { attached, missing, total: (props || []).length };
}

export function buildPipelinePropCountAudit({
  rawPrizePicks = 0,
  rawUnderdog = 0,
  combinedRaw = 0,
  normalizedProps = 0,
  afterSportFilter = 0,
  afterMlbOnlyFilter = 0,
  afterMarketFilter = 0,
  afterPlayerNormalization = 0,
  projectionCandidates = 0,
  projectedProps = 0,
  afterHistoricalAttachment = 0,
  verifiedProps = 0,
  displayedProps = 0,
  rejections = null,
  // legacy aliases
  rawPropsFetched = 0,
  afterProjectionFilter = 0,
  afterProjectionMerge = 0,
  afterVerificationFilter = 0,
} = {}) {
  const rawPP = finiteCount(rawPrizePicks);
  const rawUD = finiteCount(rawUnderdog);
  const combined = finiteCount(combinedRaw || rawPropsFetched);
  const sport = finiteCount(afterSportFilter);
  const mlbOnly = finiteCount(afterMlbOnlyFilter || afterSportFilter);
  const market = finiteCount(afterMarketFilter);
  const playerNorm = finiteCount(afterPlayerNormalization || afterMarketFilter);
  const projCand = finiteCount(projectionCandidates || afterProjectionFilter);
  const projected = finiteCount(projectedProps || afterProjectionMerge);
  const historical = finiteCount(afterHistoricalAttachment || projected);
  const verified = finiteCount(verifiedProps || afterVerificationFilter);
  const displayed = finiteCount(displayedProps);

  const stages = [
    { key: "raw_prizepicks", label: "Raw PrizePicks", count: rawPP },
    { key: "raw_underdog", label: "Raw Underdog", count: rawUD },
    { key: "combined_raw", label: "Combined raw props", count: combined },
    { key: "normalized", label: "Normalized props", count: finiteCount(normalizedProps) },
    { key: "sport_filter", label: "After sport filter", count: sport },
    { key: "mlb_only_filter", label: "After MLB-only filter", count: mlbOnly },
    { key: "market_filter", label: "After market filter", count: market },
    { key: "player_normalization", label: "After player normalization", count: playerNorm },
    { key: "projection_eligibility", label: "After projection eligibility", count: projCand },
    { key: "projected", label: "Projected props", count: projected },
    { key: "historical_attachment", label: "After historical attachment", count: historical },
    { key: "verification", label: "After verification", count: verified },
    { key: "displayed", label: "Final displayed plays", count: displayed },
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

  return {
    stages,
    rawPrizePicks: rawPP,
    rawUnderdog: rawUD,
    combinedRaw: combined,
    rawPropsFetched: combined,
    normalizedProps: finiteCount(normalizedProps),
    afterSportFilter: sport,
    afterMlbOnlyFilter: mlbOnly,
    afterMarketFilter: market,
    afterPlayerNormalization: playerNorm,
    projectionCandidates: projCand,
    afterProjectionFilter: projCand,
    projectedProps: projected,
    afterProjectionMerge: projected,
    afterHistoricalAttachment: historical,
    verifiedProps: verified,
    afterVerificationFilter: verified,
    displayedProps: displayed,
    rejections: rejections || createEmptyPipelineRejections(),
    dropOffStage,
    dropOffDetail,
    updatedAt: new Date().toISOString(),
  };
}

export function logPipelinePropCountAudit(audit = {}) {
  const header = "[Pipeline Prop Counts]";
  console.info(header, {
    rawPrizePicks: audit.rawPrizePicks ?? 0,
    rawUnderdog: audit.rawUnderdog ?? 0,
    combinedRaw: audit.combinedRaw ?? audit.rawPropsFetched ?? 0,
    normalizedProps: audit.normalizedProps ?? 0,
    afterSportFilter: audit.afterSportFilter ?? 0,
    afterMlbOnlyFilter: audit.afterMlbOnlyFilter ?? 0,
    afterMarketFilter: audit.afterMarketFilter ?? 0,
    afterPlayerNormalization: audit.afterPlayerNormalization ?? 0,
    projectionCandidates: audit.projectionCandidates ?? audit.afterProjectionFilter ?? 0,
    projectedProps: audit.projectedProps ?? audit.afterProjectionMerge ?? 0,
    afterHistoricalAttachment: audit.afterHistoricalAttachment ?? 0,
    verifiedProps: audit.verifiedProps ?? audit.afterVerificationFilter ?? 0,
    displayedProps: audit.displayedProps ?? 0,
    dropOffStage: audit.dropOffStage || null,
    rejections: audit.rejections || {},
  });
  console.info(`${header} rawPrizePicks:`, audit.rawPrizePicks ?? 0);
  console.info(`${header} rawUnderdog:`, audit.rawUnderdog ?? 0);
  console.info(`${header} combinedRaw:`, audit.combinedRaw ?? audit.rawPropsFetched ?? 0);
  console.info(`${header} normalizedProps:`, audit.normalizedProps ?? 0);
  console.info(`${header} afterSportFilter:`, audit.afterSportFilter ?? 0);
  console.info(`${header} afterMlbOnlyFilter:`, audit.afterMlbOnlyFilter ?? 0);
  console.info(`${header} afterMarketFilter:`, audit.afterMarketFilter ?? 0);
  console.info(`${header} afterPlayerNormalization:`, audit.afterPlayerNormalization ?? 0);
  console.info(`${header} projectionCandidates:`, audit.projectionCandidates ?? audit.afterProjectionFilter ?? 0);
  console.info(`${header} projectedProps:`, audit.projectedProps ?? audit.afterProjectionMerge ?? 0);
  console.info(`${header} afterHistoricalAttachment:`, audit.afterHistoricalAttachment ?? 0);
  console.info(`${header} verifiedProps:`, audit.verifiedProps ?? audit.afterVerificationFilter ?? 0);
  console.info(`${header} displayedProps:`, audit.displayedProps ?? 0);
  if (audit.rejections && Object.values(audit.rejections).some((n) => Number(n) > 0)) {
    console.info(`${header} rejections:`, audit.rejections);
  }
  if (audit.dropOffStage) {
    console.warn(`${header} Primary drop-off at "${audit.dropOffStage}":`, audit.dropOffDetail || "");
  }
  return audit;
}

export function summarizePipelinePropCounts(props = []) {
  return {
    withProjections: countMergedProjections(props),
    verified: countVerifiedFilterProps(props),
  };
}
