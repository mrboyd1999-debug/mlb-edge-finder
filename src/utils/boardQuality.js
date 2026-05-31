/**
 * Phase 6 board quality — diversity, edge display, projection confidence, section builders.
 */

import { computeRelativeEdgePercent } from "./standardPropMetrics.js";
import { resolveRankingEdgePercent, computeTopPickScore } from "./bestPlayRankingScore.js";

export const MAX_PLAYER_PROPS_IN_TOP_LIST = 2;
export const TOP_SECTION_LIMIT = 5;
export const MAX_DISPLAY_EDGE_PERCENT = 40;

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function playerKey(prop = {}) {
  return String(prop.playerName || prop.player || "")
    .trim()
    .toLowerCase();
}

export function marketKey(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "")
    .trim()
    .toLowerCase();
}

export function buildPlayerMarketKey(prop = {}) {
  return `${playerKey(prop)}|${marketKey(prop)}`;
}

/** Keep highest-scoring prop per player + market type. */
export function dedupeByPlayerMarketBestScore(props = [], scoreFn = computeTopPickScore) {
  const best = new Map();
  for (const prop of props || []) {
    const key = buildPlayerMarketKey(prop);
    if (!key || key === "|") continue;
    const score = Number(scoreFn(prop)) || 0;
    const prev = best.get(key);
    if (!prev || score > (Number(scoreFn(prev)) || 0)) {
      best.set(key, prop);
    }
  }
  return [...best.values()];
}

/** Max N props per player in ranked lists (e.g. Top 10 allows 2 Juan Soto markets). */
export function applyPlayerDiversityFilter(
  props = [],
  { limit = 10, maxPerPlayer = MAX_PLAYER_PROPS_IN_TOP_LIST } = {}
) {
  const counts = new Map();
  const out = [];
  for (const prop of props || []) {
    if (out.length >= limit) break;
    const key = playerKey(prop);
    if (!key) continue;
    const used = counts.get(key) || 0;
    if (used >= maxPerPlayer) continue;
    counts.set(key, used + 1);
    out.push(prop);
  }
  return out;
}

export function computeValidatedEdgePercent(prop = {}) {
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(line) || line <= 0) return null;
  if (Number.isFinite(projection)) {
    return ((projection - line) / line) * 100;
  }
  const edge = finite(prop.edge, NaN);
  if (Number.isFinite(edge)) {
    return (edge / line) * 100;
  }
  return computeRelativeEdgePercent(edge, line);
}

export function formatValidatedEdgeDisplay(prop = {}) {
  const pct = computeValidatedEdgePercent(prop);
  if (pct == null || !Number.isFinite(pct)) {
    return {
      rawEdgeLabel: "—",
      displayEdgeLabel: "—",
      relativeEdgeLabel: "—",
      edgePercent: null,
      edgeCapped: false,
    };
  }
  const sign = pct > 0 ? "+" : pct < 0 ? "" : "";
  const absPct = Math.abs(pct);
  const edgeCapped = absPct > MAX_DISPLAY_EDGE_PERCENT;
  const capped = Math.max(0, Math.min(absPct, MAX_DISPLAY_EDGE_PERCENT));
  const displayEdgeLabel = edgeCapped ? "40%+" : `${sign}${Math.round(capped)}%`;
  const rawEdge = finite(prop.edge, NaN);
  const rawEdgeLabel =
    Number.isFinite(rawEdge) && rawEdge !== 0
      ? `${rawEdge > 0 ? "+" : ""}${Math.round(rawEdge * 10) / 10}`
      : displayEdgeLabel;
  return {
    rawEdgeLabel,
    displayEdgeLabel,
    relativeEdgeLabel: displayEdgeLabel,
    edgePercent: pct,
    edgeCapped,
  };
}

export function resolveProjectionConfidenceLevel(prop = {}) {
  const hasMlbStats = Boolean(
    prop.historicalStatsAttached ||
      prop.hasGameLogs ||
      prop.historicalDataPresent ||
      Number(prop.gameLogCount) >= 3
  );
  const hasSportsDataIo = Boolean(
    /sportsdata/i.test(String(prop.projectionSource || "")) ||
      prop.sportsDataGames != null ||
      prop.sportsDataRawStat != null ||
      prop.sportsDataPropLabel
  );
  const hasStatsApi = Boolean(
    prop.hasVerifiedStats ||
      prop.statsProfile ||
      prop.historicalCoverage === true ||
      Number(prop.sampleSize) >= 5
  );

  const available = [hasMlbStats, hasSportsDataIo, hasStatsApi].filter(Boolean).length;
  if (available >= 3) return "HIGH";
  if (available === 2) return "MEDIUM";
  return "LOW";
}

export function attachBoardQualityFields(prop = {}) {
  const edgeLabels = formatValidatedEdgeDisplay(prop);
  return {
    ...prop,
    ...edgeLabels,
    rawEdgeLabel: edgeLabels.rawEdgeLabel,
    displayEdgeLabel: edgeLabels.displayEdgeLabel,
    edgePercent: edgeLabels.edgePercent ?? prop.edgePercent,
    projectionConfidenceLevel: resolveProjectionConfidenceLevel(prop),
  };
}

export function resolveRecommendedSide(prop = {}) {
  const side = String(prop.recommendedSide || prop.lean || prop.pick || prop.side || "").toUpperCase();
  if (side.includes("UNDER") || side.includes("LESS")) return "UNDER";
  if (side.includes("OVER") || side.includes("MORE")) return "OVER";
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  const line = finite(prop.line, NaN);
  if (Number.isFinite(projection) && Number.isFinite(line) && projection !== line) {
    return projection > line ? "OVER" : "UNDER";
  }
  return "PASS";
}

function compareSafestPlays(a = {}, b = {}) {
  const probA = finite(a.probabilityScore ?? a.verifiedProbability, 0);
  const probB = finite(b.probabilityScore ?? b.verifiedProbability, 0);
  if (probB !== probA) return probB - probA;
  const confA = finite(a.displayConfidenceScore ?? a.confidenceScore ?? a.confidence, 0);
  const confB = finite(b.displayConfidenceScore ?? b.confidenceScore ?? b.confidence, 0);
  return confB - confA;
}

function compareHighestEdgePlays(a = {}, b = {}) {
  return resolveRankingEdgePercent(b) - resolveRankingEdgePercent(a);
}

function compareValueSidePlays(a = {}, b = {}) {
  return (
    compareHighestEdgePlays(a, b) ||
    finite(b.probabilityScore ?? b.verifiedProbability, 0) -
      finite(a.probabilityScore ?? a.verifiedProbability, 0)
  );
}

export function buildTopSectionPicks(pool = [], { compareFn, side = "", limit = TOP_SECTION_LIMIT } = {}) {
  let rows = [...pool];
  if (side === "UNDER" || side === "OVER") {
    rows = rows.filter((prop) => resolveRecommendedSide(prop) === side);
  }
  return applyPlayerDiversityFilter(rows.sort(compareFn), {
    limit,
    maxPerPlayer: MAX_PLAYER_PROPS_IN_TOP_LIST,
  });
}

export const compareSafestPlaysRank = compareSafestPlays;
export const compareHighestEdgePlaysRank = compareHighestEdgePlays;
export const compareValueSidePlaysRank = compareValueSidePlays;
