import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { DATA_STATUS } from "./projectionBreakdown.js";
import { isMlbPitcherMarket } from "./mlbPitcherData.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function normalizePayout(payoutType = "standard") {
  const key = String(payoutType || "standard").toLowerCase();
  if (key === "goblin") return "goblin";
  if (key === "demon") return "demon";
  return "standard";
}

function normalizePick(pick = "over") {
  const key = String(pick || "over").toLowerCase();
  if (key === "under" || key === "less" || key === "lower") return "under";
  return "over";
}

/** OVER: projection - line. UNDER: line - projection. */
export function computePitcherEdge(projection, line, pick = "over") {
  const proj = Number(projection);
  const numericLine = Number(line);
  const side = normalizePick(pick);
  if (!Number.isFinite(proj) || !Number.isFinite(numericLine)) return 0;
  return side === "over" ? round(proj - numericLine, 2) : round(numericLine - proj, 2);
}

export function computePitcherHitChance({
  edge = 0,
  volatility = { tier: "MEDIUM", score: 0.5 },
  confidence = 0,
  payoutType = "standard",
  isFallback = false,
}) {
  const payout = normalizePayout(payoutType);
  const numericEdge = Number(edge) || 0;
  const favorableEdge = Math.max(numericEdge, 0);

  let pct = 50 + favorableEdge * 7.5 + Number(confidence) * 0.32;

  if (volatility.tier === "LOW") pct += 5;
  else if (volatility.tier === "MEDIUM") pct += 1;
  else if (volatility.tier === "HIGH") pct -= 6;

  if (payout === "goblin") pct += 4;
  if (payout === "demon") pct -= 9;

  if (numericEdge >= 1.0) pct += 4;
  else if (numericEdge >= 0.7) pct += 2;
  if (numericEdge < 0) pct += numericEdge * 9;

  if (isFallback) return Math.round(clamp(pct, 35, 65));
  return Math.round(clamp(pct, 38, 88));
}

export function computePitcherConfidence({
  marketKey = "",
  edge = 0,
  volatility = { tier: "MEDIUM", score: 0.5 },
  payoutType = "standard",
  projectionConfidence = 60,
  isFallback = false,
}) {
  const payout = normalizePayout(payoutType);
  let min;
  let max;
  if (payout === "goblin") {
    min = 72;
    max = 85;
  } else if (payout === "demon") {
    min = 45;
    max = 60;
  } else {
    min = 58;
    max = 72;
  }

  let score = min + (Math.max(0, Math.min(100, projectionConfidence)) / 100) * (max - min);

  const favorableEdge = Math.max(Number(edge) || 0, 0);
  if (favorableEdge >= 1.5) score += 7;
  else if (favorableEdge >= 1.0) score += 5;
  else if (favorableEdge >= 0.7) score += 4;
  else if (favorableEdge >= 0.4) score += 2;
  else if (favorableEdge <= 0.25) score -= 5;
  if (Number(edge) < 0) score -= 12;

  if (volatility.tier === "LOW") score += 5;
  else if (volatility.tier === "HIGH") score -= 7;

  if (marketKey === "strikeouts" && favorableEdge >= 0.7) score += 5;
  if (marketKey === "strikeouts" && favorableEdge >= 1.0) score += 2;
  if (marketKey === "outs" && favorableEdge >= 0.5) score += 2;
  if (marketKey === "earnedRuns") score -= 3;

  if (payout === "demon") score = Math.min(score, max);
  if (payout === "goblin" && favorableEdge <= 0) score = Math.min(score, 74);

  if (isFallback) score = Math.min(score, 62);

  if (Number(edge) < 0) {
    const negativeCap = payout === "goblin" ? 56 : payout === "demon" ? 50 : 52;
    return Math.round(clamp(Math.min(score, negativeCap), 38, negativeCap));
  }

  const floor = payout === "goblin" ? 72 : payout === "demon" ? 45 : 58;
  const ceiling = payout === "goblin" ? 85 : payout === "demon" ? 60 : 72;
  return Math.round(clamp(score, floor, ceiling));
}

export function scorePitcherManualProp({
  projection,
  line,
  pick,
  statType,
  payoutType = "standard",
  volatility,
  projectionConfidence = 60,
  dataStatus = DATA_STATUS.FALLBACK,
}) {
  const marketKey = canonicalMarketKey(statType);
  const edge = computePitcherEdge(projection, line, pick);
  const isFallback = dataStatus === DATA_STATUS.FALLBACK;
  const confidence = computePitcherConfidence({
    marketKey,
    edge,
    volatility,
    payoutType,
    projectionConfidence,
    isFallback,
  });
  const impliedHitChance = computePitcherHitChance({
    edge,
    volatility,
    confidence,
    payoutType,
    isFallback,
  });

  return { edge, confidence, impliedHitChance, isFallback };
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
