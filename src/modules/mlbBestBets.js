import { isManualPropPlayable, selectManualTopPicksByRank } from "../utils/manualPropScoring.js";
import { isVerifiedRecommendableProp } from "./propSideEngine.js";

export const MLB_BEST_BET_MIN_EDGE = 0.35;
export const MLB_BEST_BET_MIN_CONFIDENCE = 58;
export const MLB_BEST_PLAYS_LIMIT = 2;
export const MLB_STRONG_LEANS_LIMIT = 6;

export function isMlbSportProp(prop = {}) {
  return String(prop.sport || prop.league || "").toUpperCase() === "MLB";
}

function normalizeSide(prop = {}) {
  const side = String(prop.bestPick || prop.side || prop.pick || prop.recommendedSide || "").toLowerCase();
  if (side.includes("over")) return "over";
  if (side.includes("under")) return "under";
  return "";
}

export function rankMlbVerifiedPropScore(prop = {}) {
  if (!isVerifiedRecommendableProp(prop)) return -1_000_000;
  const conf = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const edge = Math.abs(Number(prop.edge ?? 0));
  const edgePct = Number(prop.edgePercent ?? 0);
  const vol = Number(prop.manualVolatilityScore ?? prop.volatilityScore ?? 0.5);
  const completeness = Number(prop.dataCompleteness ?? prop.dataQualityScore ?? 50);
  const consistency = Number(
    prop.consistencyScore ?? prop.profile?.consistencyScore ?? prop.manualVolatilityScore != null ? (1 - vol) * 100 : 50
  );
  return conf * 100 + edge * 40 + edgePct * 2 + completeness * 0.5 + consistency * 0.4 - vol * 30;
}

export function sortMlbVerifiedProps(props = []) {
  return [...(props || [])].sort((a, b) => {
    const scoreDiff = rankMlbVerifiedPropScore(b) - rankMlbVerifiedPropScore(a);
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    const volDiff =
      Number(a.manualVolatilityScore ?? a.volatilityScore ?? 0.5) -
      Number(b.manualVolatilityScore ?? b.volatilityScore ?? 0.5);
    if (volDiff !== 0) return volDiff;
    return Number(b.confidenceScore ?? b.confidence ?? 0) - Number(a.confidenceScore ?? a.confidence ?? 0);
  });
}

export function annotateMlbRankedProp(prop = {}, rank = 1) {
  const side = normalizeSide(prop);
  const reasons = (prop.modelReasons || [])
    .concat(prop.whyThisPick ? [prop.whyThisPick] : [])
    .filter(Boolean)
    .slice(0, 3);
  return {
    ...prop,
    topMlbPlayRank: rank,
    modelPick: prop.modelPick || prop.modelSide || (side ? side.toUpperCase() : null),
    modelReasons: reasons,
    reason: reasons.join(" · ") || prop.analyticsReason || prop.whyThisPick || "",
  };
}

export function filterMlbRecommendableProps(props = []) {
  return (props || []).filter((prop) => {
    if (!isMlbSportProp(prop)) return false;
    if (!isVerifiedRecommendableProp(prop)) return false;
    const side = normalizeSide(prop);
    return side === "over" || side === "under";
  });
}

/** Top 2 verified MLB best plays. */
export function selectMlbVerifiedBestBets(props = [], limit = MLB_BEST_PLAYS_LIMIT) {
  const pool = filterMlbRecommendableProps(props).filter(isManualPropPlayable);
  return selectManualTopPicksByRank(pool, limit).map((prop, idx) => annotateMlbRankedProp(prop, idx + 1));
}

/** Next 6 verified strong leans after best plays. */
export function selectMlbStrongLeans(props = [], limit = MLB_STRONG_LEANS_LIMIT) {
  const best = selectMlbVerifiedBestBets(props, MLB_BEST_PLAYS_LIMIT);
  const bestKeys = new Set(best.map((prop) => prop.id || `${prop.playerName}|${prop.statType}|${prop.line}`));
  const pool = filterMlbRecommendableProps(props)
    .filter(isManualPropPlayable)
    .filter((prop) => !bestKeys.has(prop.id || `${prop.playerName}|${prop.statType}|${prop.line}`));
  return sortMlbVerifiedProps(pool)
    .slice(0, limit)
    .map((prop, idx) => annotateMlbRankedProp(prop, idx + 1));
}

export function resolveMlbRankedBoards(props = []) {
  const bestPlays = selectMlbVerifiedBestBets(props, MLB_BEST_PLAYS_LIMIT);
  const strongLeans = selectMlbStrongLeans(props, MLB_STRONG_LEANS_LIMIT);
  return { bestPlays, strongLeans };
}
