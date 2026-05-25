import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { DATA_STATUS, isFallbackDataStatus, PROJECTION_UNAVAILABLE_LABEL } from "./projectionBreakdown.js";
import { isMlbPitcherMarket } from "./mlbPitcherData.js";
import {
  computeDirectionalEdgeForSide,
  computeRawEdge,
  confidenceFromEdge,
  hitChanceFromVerifiedEdge,
  resolveRecommendedSide,
} from "./propSideEngine.js";

function normalizePick(pick = "over") {
  const key = String(pick || "over").toLowerCase();
  if (key === "under" || key === "less" || key === "lower") return "under";
  return "over";
}

/** Directional edge for recommended side (positive = supported). */
export function computePitcherEdge(projection, line, pick = "over") {
  const recommended = resolveRecommendedSide(projection, line) || normalizePick(pick);
  return computeDirectionalEdgeForSide(projection, line, recommended);
}

export function computePitcherHitChance({
  projection,
  line,
  edge = 0,
  volatility = { tier: "MEDIUM", score: 0.5 },
  confidence = 0,
  payoutType = "standard",
  isFallback = false,
}) {
  if (isFallback) return null;
  const rawEdge = computeRawEdge(projection, line);
  if (rawEdge == null) return null;
  return hitChanceFromVerifiedEdge({
    absEdge: Math.abs(rawEdge),
    rawEdge,
    volatility,
    confidence,
    payoutType,
  });
}

export function computePitcherConfidence({
  projection,
  line,
  marketKey = "",
  edge = 0,
  adjustedAbsEdge = null,
  volatility = { tier: "MEDIUM", score: 0.5 },
  payoutType = "standard",
  isFallback = false,
}) {
  if (isFallback) return 0;
  const rawEdge = computeRawEdge(projection, line);
  if (rawEdge == null) return 0;
  const absEdge = Number.isFinite(adjustedAbsEdge) ? adjustedAbsEdge : Math.abs(rawEdge);
  let score = confidenceFromEdge(absEdge, {
    volatility,
    payoutType,
    marketKey,
    isVerified: true,
  });
  if (marketKey === "earnedRuns") score = Math.max(0, score - 3);
  return score;
}

export function scorePitcherManualProp({
  projection,
  line,
  pick,
  statType,
  payoutType = "standard",
  volatility,
  projectionConfidence = 60,
  dataStatus = DATA_STATUS.UNAVAILABLE,
  adjustedAbsEdge = null,
}) {
  const marketKey = canonicalMarketKey(statType);
  const isFallback = isFallbackDataStatus(dataStatus);
  const recommendedSide = resolveRecommendedSide(projection, line);
  const edge = recommendedSide
    ? computeDirectionalEdgeForSide(projection, line, recommendedSide)
    : 0;
  const confidence = computePitcherConfidence({
    projection,
    line,
    marketKey,
    edge,
    adjustedAbsEdge,
    volatility,
    payoutType,
    isFallback,
  });
  const impliedHitChance = computePitcherHitChance({
    projection,
    line,
    edge,
    volatility,
    confidence,
    payoutType,
    isFallback,
  });

  return { edge, confidence, impliedHitChance, isFallback, recommendedSide };
}

export {
  scoreManualPropInput,
  rankManualPropScore,
  sortManualPropsByRank,
  selectManualTopPicksByRank,
  computeDirectionalEdge,
  computeImpliedHitChance,
  getManualStatVolatility,
  mergeManualPropScoring,
  manualScoringModeLabel,
} from "../utils/manualPropScoring.js";

export { scoreConfidenceFromSignals, getReadyToBetRejectReason } from "../services/pickScoring.js";
export { selectTop2Picks } from "../utils/displayPropScoring.js";
export { isMlbPitcherMarket } from "./mlbPitcherData.js";
