/**
 * Phase 6/7 board quality — diversity, edge display, projection confidence, section builders.
 */

import { dataQualityBadge } from "../services/dataQuality.js";

export const MAX_PLAYER_PROPS_IN_TOP_LIST = 2;
export const TOP_SECTION_LIMIT = 5;
export const MAX_DISPLAY_EDGE_PERCENT = 40;
export const PARTIAL_DATA_CONFIDENCE_PENALTY = 10;
export const TOP_FIVE_MIN_CONFIDENCE = 70;
export const SAFEST_MIN_CONFIDENCE = 75;
export const SAFEST_MIN_PLAYABILITY = 70;
export const SAFEST_MIN_SANITY = 80;
export const SAFEST_MIN_PROBABILITY = 70;
export const VALUE_UNDER_MIN_CONFIDENCE = 65;
export const VALUE_UNDER_MIN_PLAYABILITY = 60;
export const SAFEST_FALLBACK_NOTICE =
  "No full-data safest plays yet. Showing best available Tier A/B.";

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function defaultPickScore(prop = {}) {
  return Number(prop.topPickScore ?? prop.verifiedRankingScore ?? prop.weightedBestPlayScore ?? 0);
}

/** Keep highest-scoring prop per player + market type. */
export function dedupeByPlayerMarketBestScore(props = [], scoreFn = defaultPickScore) {
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
  if (!Number.isFinite(projection) || projection <= 0) return null;
  if (!Number.isFinite(line)) return null;
  return ((projection - line) / projection) * 100;
}

export function clampValidatedEdgePercent(edgePercent) {
  const pct = finite(edgePercent, NaN);
  if (!Number.isFinite(pct)) return null;
  return clamp(pct, 0, MAX_DISPLAY_EDGE_PERCENT);
}

export function formatValidatedEdgeDisplay(prop = {}) {
  const rawPct = computeValidatedEdgePercent(prop);
  if (rawPct == null || !Number.isFinite(rawPct)) {
    return {
      rawEdgeLabel: "—",
      displayEdgeLabel: "—",
      relativeEdgeLabel: "—",
      edgePercent: null,
      edgeCapped: false,
    };
  }
  const absPct = Math.abs(rawPct);
  const edgeCapped = absPct > MAX_DISPLAY_EDGE_PERCENT;
  const capped = clampValidatedEdgePercent(absPct);
  const sign = rawPct > 0 ? "+" : rawPct < 0 ? "" : "";
  const displayEdgeLabel = edgeCapped ? "40%+" : `${sign}${Math.round(capped ?? 0)}%`;
  const rawEdge = finite(prop.edge, NaN);
  const rawEdgeLabel =
    Number.isFinite(rawEdge) && rawEdge !== 0
      ? `${rawEdge > 0 ? "+" : ""}${Math.round(rawEdge * 10) / 10}`
      : displayEdgeLabel;
  return {
    rawEdgeLabel,
    displayEdgeLabel,
    relativeEdgeLabel: displayEdgeLabel,
    edgePercent: rawPct,
    edgeCapped,
  };
}

export function hasMlbStatsApiData(prop = {}) {
  return Boolean(
    prop.hasVerifiedStats ||
      prop.statsProfile ||
      prop.historicalCoverage === true ||
      Number(prop.sampleSize) >= 5 ||
      prop.historicalStatsAttached ||
      prop.hasGameLogs ||
      prop.historicalDataPresent
  );
}

export function hasSportsDataIoData(prop = {}) {
  return Boolean(
    /sportsdata/i.test(String(prop.projectionSource || "")) ||
      prop.sportsDataGames != null ||
      prop.sportsDataRawStat != null ||
      prop.sportsDataPropLabel
  );
}

export function hasPartialDataBadge(prop = {}) {
  const badge = prop.dataQualityBadge || dataQualityBadge(prop);
  return /partial data/i.test(String(badge?.label || prop.dataQualityLabel || ""));
}

export function passesFullDataBestPlayRequirements(prop = {}) {
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(projection) || projection <= 0) return false;
  if (!hasMlbStatsApiData(prop)) return false;
  if (!hasSportsDataIoData(prop)) return false;
  if (hasPartialDataBadge(prop)) return false;
  return true;
}

export function classifyConfidenceTier(confidence) {
  const conf = finite(confidence, NaN);
  if (!Number.isFinite(conf)) return "D";
  if (conf >= 80) return "A";
  if (conf >= 70) return "B";
  if (conf >= 60) return "C";
  return "D";
}

export function resolvePropConfidence(prop = {}) {
  return finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence, NaN);
}

export function resolvePropPlayability(prop = {}) {
  return finite(prop.playabilityScore ?? prop.playabilityBreakdown?.finalPlayability, NaN);
}

export function resolvePropSanity(prop = {}) {
  return finite(prop.projectionSanityScore ?? prop.projectionSanityAudit?.sanityScore, NaN);
}

export function resolvePropProbability(prop = {}) {
  return finite(prop.probabilityScore ?? prop.verifiedProbability, NaN);
}

export function resolveProjectionGap(prop = {}) {
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(line) || !Number.isFinite(projection)) return 0;
  return line - projection;
}

export function passesTopFiveBestPlayGate(prop = {}) {
  const confidence = resolvePropConfidence(prop);
  const tier = classifyConfidenceTier(confidence);
  if (tier === "C" || tier === "D") return false;
  return passesFullDataBestPlayRequirements(prop);
}

export function passesSafestPlayGate(prop = {}) {
  if (!passesFullDataBestPlayRequirements(prop)) return false;
  const confidence = resolvePropConfidence(prop);
  const tier = classifyConfidenceTier(confidence);
  if (tier === "C" || tier === "D") return false;
  if (confidence < SAFEST_MIN_CONFIDENCE) return false;
  if (resolvePropPlayability(prop) < SAFEST_MIN_PLAYABILITY) return false;
  if (resolvePropSanity(prop) < SAFEST_MIN_SANITY) return false;
  if (resolvePropProbability(prop) < SAFEST_MIN_PROBABILITY) return false;
  return true;
}

export function passesValueUnderGate(prop = {}) {
  const lean = String(prop.lean || prop.pick || prop.side || "").toLowerCase();
  const side = resolveRecommendedSide(prop);
  const isUnder = side === "UNDER" || /under|less|lower/.test(lean);
  if (!isUnder) return false;
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(line) || !Number.isFinite(projection) || projection >= line) return false;
  if (resolvePropConfidence(prop) < VALUE_UNDER_MIN_CONFIDENCE) return false;
  if (resolvePropPlayability(prop) < VALUE_UNDER_MIN_PLAYABILITY) return false;
  return true;
}

function compareNumericDesc(a = {}, b = {}, resolver = () => 0) {
  return resolver(b) - resolver(a);
}

export function compareSafestPlaysRank(a = {}, b = {}) {
  return (
    compareNumericDesc(a, b, resolvePropConfidence) ||
    compareNumericDesc(a, b, resolvePropProbability) ||
    compareNumericDesc(a, b, resolvePropPlayability) ||
    compareNumericDesc(a, b, resolvePropSanity) ||
    compareHighestEdgePlays(a, b)
  );
}

export function compareValueUndersRank(a = {}, b = {}) {
  return (
    compareNumericDesc(a, b, resolvePropConfidence) ||
    compareNumericDesc(a, b, resolveProjectionGap) ||
    compareNumericDesc(a, b, resolvePropProbability) ||
    compareNumericDesc(a, b, resolvePropPlayability)
  );
}

export function buildSafestPlaysSection(pool = [], { limit = TOP_SECTION_LIMIT } = {}) {
  const strictPool = dedupeByPlayerMarketBestScore(pool);
  const strictPicks = buildTopSectionPicks(strictPool, {
    compareFn: compareSafestPlaysRank,
    limit,
    filterFn: passesSafestPlayGate,
  });
  if (strictPicks.length >= limit) {
    return { picks: strictPicks, fallbackNotice: "", usedFallback: false };
  }
  const fallbackPicks = buildTopSectionPicks(strictPool, {
    compareFn: compareSafestPlaysRank,
    limit,
    filterFn: passesTopFiveBestPlayGate,
  });
  return {
    picks: fallbackPicks,
    usedFallback: strictPicks.length < limit,
    fallbackNotice: strictPicks.length < limit ? SAFEST_FALLBACK_NOTICE : "",
  };
}

export function buildValueUndersSection(pool = [], { limit = TOP_SECTION_LIMIT } = {}) {
  const picks = buildTopSectionPicks(dedupeByPlayerMarketBestScore(pool), {
    compareFn: compareValueUndersRank,
    side: "UNDER",
    limit,
    filterFn: passesValueUnderGate,
  });
  return { picks, fallbackNotice: "", usedFallback: false };
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

function compareHighestEdgePlays(a = {}, b = {}) {
  const edgeA = Math.abs(computeValidatedEdgePercent(a) ?? 0);
  const edgeB = Math.abs(computeValidatedEdgePercent(b) ?? 0);
  return edgeB - edgeA;
}

function compareValueSidePlays(a = {}, b = {}) {
  return (
    compareHighestEdgePlays(a, b) ||
    finite(b.probabilityScore ?? b.verifiedProbability, 0) -
      finite(a.probabilityScore ?? a.verifiedProbability, 0)
  );
}

export function buildTopSectionPicks(
  pool = [],
  { compareFn, side = "", limit = TOP_SECTION_LIMIT, filterFn = null } = {}
) {
  let rows = [...pool];
  if (filterFn) rows = rows.filter(filterFn);
  if (side === "UNDER" || side === "OVER") {
    rows = rows.filter((prop) => resolveRecommendedSide(prop) === side);
  }
  return applyPlayerDiversityFilter(rows.sort(compareFn), {
    limit,
    maxPerPlayer: MAX_PLAYER_PROPS_IN_TOP_LIST,
  });
}

export const compareHighestEdgePlaysRank = compareHighestEdgePlays;
export const compareValueSidePlaysRank = compareValueSidePlays;
