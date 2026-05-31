/**
 * Projection pipeline coverage audit — counts at each rejection stage.
 */

import { resolvePropSport } from "./mlbOnlyMode.js";
import {
  filterMlbPipelineSportProps,
  filterMlbPipelineSupportedMarkets,
  isBlockedNonMlbPipelineProp,
} from "./mlbAllowedMarkets.js";
import { findPlayerHistoricalProfile } from "./playerNames.js";
import { resolveHistoricalDataPresent } from "./tierHistoricalValidation.js";

export const PROJECTION_COVERAGE_TARGET = 0.7;

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function resolveStageCount(value = 0) {
  if (Array.isArray(value)) return finiteCount(value.length);
  return finiteCount(value);
}

export function countMergedProjections(props = []) {
  return (props || []).filter((prop) => {
    const projection = Number(prop?.projection ?? prop?.projectedValue);
    return Number.isFinite(projection) && projection > 0;
  }).length;
}

export function summarizeHistoricalMatchCounts(props = [], statsMap = null) {
  let historicalMatches = 0;
  let historicalMissing = 0;

  for (const prop of props || []) {
    if (prop?.historicalCoverage === true || prop?.hasGameLogs || prop?.hasVerifiedStats) {
      historicalMatches += 1;
      continue;
    }

    const profile =
      statsMap instanceof Map ? findPlayerHistoricalProfile(statsMap, prop) : null;
    const enriched = profile ? { ...prop, ...profile } : prop;
    if (resolveHistoricalDataPresent(enriched).present) {
      historicalMatches += 1;
    } else {
      historicalMissing += 1;
    }
  }

  return { historicalMatches, historicalMissing };
}

/**
 * @param {object} params
 * @param {number} params.rawPropCount
 * @param {object[]} params.normalizedProps
 * @param {object[]} params.sportFilteredProps
 * @param {object[]} params.marketFilteredProps
 * @param {object[]} params.projectedProps
 * @param {Map|null} params.statsMap
 * @param {number} [params.matchedPlayers]
 * @param {number} [params.gameLogsFound]
 */
export function buildProjectionCoverageAudit({
  rawPropCount = 0,
  normalizedProps = [],
  sportFilteredProps = [],
  marketFilteredProps = [],
  projectedProps = [],
  statsMap = null,
  matchedPlayers = 0,
  gameLogsFound = 0,
} = {}) {
  const raw = resolveStageCount(rawPropCount);
  const normalized = resolveStageCount(normalizedProps);
  const afterSportFilter = resolveStageCount(sportFilteredProps);
  const afterMarketFilter = resolveStageCount(marketFilteredProps);
  const projected = Array.isArray(projectedProps)
    ? countMergedProjections(projectedProps)
    : resolveStageCount(projectedProps);
  const supported = afterSportFilter;
  const coverageBase = normalized > 0 ? normalized : afterSportFilter;
  const projectionCoveragePercent =
    coverageBase > 0 ? Math.round((projected / coverageBase) * 1000) / 10 : 0;
  const { historicalMatches, historicalMissing } = summarizeHistoricalMatchCounts(
    projectedProps,
    statsMap
  );

  const firstRejectionStage =
    raw === 0
      ? "fetch"
      : normalized === 0
        ? "normalize"
        : afterSportFilter === 0
          ? "sport_filter"
          : projected === 0
            ? "projection_generation"
            : projectionCoveragePercent < PROJECTION_COVERAGE_TARGET * 100
              ? "low_projection_coverage"
              : null;

  return {
    rawProps: raw,
    normalizedProps: normalized,
    supportedProps: supported,
    afterSportFilter,
    afterMarketFilter,
    matchedPlayers: finiteCount(matchedPlayers),
    gameLogsFound: finiteCount(gameLogsFound),
    projectedProps: projected,
    historicalMatches,
    historicalMissing,
    projectionCoveragePercent,
    meetsCoverageTarget: projectionCoveragePercent >= PROJECTION_COVERAGE_TARGET * 100,
    firstRejectionStage,
    updatedAt: new Date().toISOString(),
  };
}

export function logProjectionCoverageAudit(audit = {}) {
  console.log("raw props", audit.rawProps ?? 0);
  console.log("normalized props", audit.normalizedProps ?? 0);
  console.log("supported props", audit.supportedProps ?? audit.afterSportFilter ?? 0);
  console.log("projected props", audit.projectedProps ?? 0);
  console.log("AFTER SPORT FILTER", audit.afterSportFilter ?? 0);
  console.log("AFTER MARKET FILTER", audit.afterMarketFilter ?? 0);
  console.log("AFTER PLAYER MATCH", audit.matchedPlayers ?? 0);
  console.log("AFTER PROJECTION GENERATION", audit.projectedProps ?? 0);
  console.log("Historical Matches", audit.historicalMatches ?? 0);
  console.log("Historical Missing", audit.historicalMissing ?? 0);
  console.log("Projection Coverage %", audit.projectionCoveragePercent ?? 0);
  if (audit.firstRejectionStage) {
    console.log("First rejection point", audit.firstRejectionStage);
  }
  return audit;
}

/** MLB props eligible for projection generation — sport clean + valid line; markets do not block. */
export function isMlbProjectionGenerationCandidate(prop = {}) {
  if (!prop || prop.isDemoData) return false;
  if (isBlockedNonMlbPipelineProp(prop)) return false;
  if (resolvePropSport(prop) !== "MLB") return false;
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return false;
  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  return Boolean(String(prop.playerName || prop.player || "").trim() && statType);
}

export function filterMlbProjectionGenerationCandidates(props = []) {
  return (props || []).filter(isMlbProjectionGenerationCandidate);
}
