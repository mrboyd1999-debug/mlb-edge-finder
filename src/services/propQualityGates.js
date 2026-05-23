import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { getPropVolatilityTier } from "./marketConfidenceModels.js";

export function isPositiveEdge(prop = {}) {
  const edge = Number(prop.edge);
  return Number.isFinite(edge) && edge > 0 && Boolean(prop.bestPick);
}

export const QUALITY_THRESHOLDS = {
  ACCEPTED_MIN_CONFIDENCE: 60,
  READY_MIN_CONFIDENCE: 65,
  TOP_PICK_MIN_CONFIDENCE: 68,
  ELITE_MIN_CONFIDENCE: 75,
  RESEARCH_MAX_CONFIDENCE: 54,
  MIN_MEANINGFUL_EDGE: 0.35,
  HIGH_VOLATILITY_NUM: 3.5,
  SEVERE_VOLATILITY_NUM: 4.25,
  MIN_EV_SCORE: 45,
};

export function confidenceValue(prop = {}) {
  return Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
}

export function edgeValue(prop = {}) {
  return Number(prop.edge ?? prop.modelSignal?.edge ?? 0);
}

export function hasVerifiedStats(prop = {}) {
  return Boolean(prop.hasVerifiedStats || prop.manualEnriched || prop.strongData || prop.verifiedHistory);
}

export function hasMatchupData(prop = {}) {
  if (Number.isFinite(Number(prop.opponentAllowed)) || Number.isFinite(Number(prop.opponentRank))) return true;
  if (prop.handednessMatchup || prop.matchupNote || prop.strikeoutTrend || prop.pitchCountTrend) return true;
  const rating = String(prop.matchupRating || "");
  if (/favorable|tough|playable|neutral|elite|plus|weakness/i.test(rating)) return true;
  if ((Number(prop.sampleSize) || 0) >= 8 && hasVerifiedStats(prop)) return true;
  return false;
}

export function hasNegativeEv(prop = {}) {
  const ev = Number(prop.expectedValue ?? prop.modelSignal?.expectedValue);
  if (Number.isFinite(ev) && ev <= 0) return true;
  const evScore = Number(prop.expectedValueScore ?? prop.modelSignal?.expectedValueScore);
  if (Number.isFinite(evScore) && evScore < QUALITY_THRESHOLDS.MIN_EV_SCORE) return true;
  return false;
}

export function hasPositiveEv(prop = {}) {
  return !hasNegativeEv(prop);
}

export function isStaleOrExpiredLine(prop = {}) {
  if (prop.freshnessTier === "EXPIRED") return true;
  if (prop.lineSourceBadge === "STALE" && prop.freshnessTier === "STALE_WARNING") return true;
  return false;
}

export function isResearchOnlyMarket(prop = {}) {
  return Boolean(prop.marketResearchOnly || prop.marketSupportTier === 2 || prop.noveltyMarket);
}

/** LOW | MEDIUM | HIGH — numeric volatility fallback when tier missing. */
export function getVolatilityLabel(prop = {}) {
  const tier = getPropVolatilityTier(prop);
  if (tier === "LOW" || tier === "MEDIUM" || tier === "HIGH") return tier;
  const vol = Number(prop.volatility ?? prop.volatilityScore);
  if (!Number.isFinite(vol)) return "MEDIUM";
  if (vol <= 2.25) return "LOW";
  if (vol <= 3.25) return "MEDIUM";
  return "HIGH";
}

export function volatilitySafetyScore(prop = {}) {
  const label = getVolatilityLabel(prop);
  if (label === "LOW") return 3;
  if (label === "MEDIUM") return 2;
  return 0;
}

export function lineStabilityScore(prop = {}) {
  const tag = String(prop.lineMovementTag || prop.lineMovement?.tag || "").toLowerCase();
  if (prop.lineMovement?.againstPick && tag === "steamed") return 0;
  if (tag === "volatile" || tag === "steamed") return 1;
  if (tag === "stable" || tag === "flat") return 3;
  if (prop.lineMovement?.supportsPick) return 3;
  return 2;
}

export function meetsAcceptedPropQuality(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (isResearchOnlyMarket(prop)) return false;
  if (isStaleOrExpiredLine(prop)) return false;
  if (confidenceValue(prop) < QUALITY_THRESHOLDS.ACCEPTED_MIN_CONFIDENCE) return false;
  if (!isPositiveEdge(prop)) return false;
  if (edgeValue(prop) < QUALITY_THRESHOLDS.MIN_MEANINGFUL_EDGE) return false;
  if (!hasVerifiedStats(prop)) return false;
  if (!hasMatchupData(prop)) return false;
  if (!hasPositiveEv(prop)) return false;

  const vol = Number(prop.volatility);
  if (Number.isFinite(vol) && vol >= QUALITY_THRESHOLDS.SEVERE_VOLATILITY_NUM) return false;
  if (getVolatilityLabel(prop) === "HIGH" && edgeValue(prop) < 0.85) return false;

  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (prop.lineMovement?.againstPick && movementTag === "steamed") {
    const delta = Math.abs(Number(prop.lineMovement?.delta ?? prop.lineMovement?.change ?? 0));
    if (delta >= 0.75) return false;
  }
  return true;
}

export function meetsReadyToBetQuality(prop = {}) {
  if (!meetsAcceptedPropQuality(prop)) return false;
  if (confidenceValue(prop) < QUALITY_THRESHOLDS.READY_MIN_CONFIDENCE) return false;
  if (getVolatilityLabel(prop) === "HIGH" && confidenceValue(prop) < 72) return false;
  return lineStabilityScore(prop) >= 1;
}

export function meetsTopPickQuality(prop = {}) {
  if (!meetsReadyToBetQuality(prop)) return false;
  if (confidenceValue(prop) < QUALITY_THRESHOLDS.TOP_PICK_MIN_CONFIDENCE) return false;
  if (lineStabilityScore(prop) < 2) return false;
  if (getVolatilityLabel(prop) === "HIGH") return false;
  return edgeValue(prop) >= 0.5;
}

/** Sort: confidence → edge → volatility safety → line stability. */
export function comparePropQuality(a = {}, b = {}) {
  const confDelta = confidenceValue(b) - confidenceValue(a);
  if (confDelta !== 0) return confDelta;
  const edgeDelta = edgeValue(b) - edgeValue(a);
  if (edgeDelta !== 0) return edgeDelta;
  const volDelta = volatilitySafetyScore(b) - volatilitySafetyScore(a);
  if (volDelta !== 0) return volDelta;
  return lineStabilityScore(b) - lineStabilityScore(a);
}

export function filterAcceptedQualityProps(props = []) {
  return (props || []).filter(Boolean).filter(meetsAcceptedPropQuality).sort(comparePropQuality);
}

export function filterReadyQualityProps(props = [], limit = 20) {
  return filterAcceptedQualityProps(props).filter(meetsReadyToBetQuality).slice(0, limit);
}

export function filterTopPickQualityProps(props = [], limit = 2) {
  const strict = (props || []).filter(Boolean).filter(meetsTopPickQuality).sort(comparePropQuality);
  if (strict.length >= limit) return strict.slice(0, limit);
  const relaxed = filterAcceptedQualityProps(props).filter(meetsReadyToBetQuality).sort(comparePropQuality);
  return relaxed.slice(0, limit);
}
