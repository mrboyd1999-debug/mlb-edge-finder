import { CONFIDENCE_THRESHOLDS } from "./confidenceEngine.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { getMlbQualityTierWeight } from "../utils/mlbOnlyMode.js";
import {
  comparePropQuality,
  confidenceValue,
  edgeValue,
  getVolatilityLabel,
  lineStabilityScore,
  meetsReadyToBetQuality,
  meetsTopPickQuality,
  volatilitySafetyScore,
} from "./propQualityGates.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasUsableProjection(prop = {}) {
  const projection = finiteNumber(prop.projectedValue ?? prop.projection);
  if (Number.isFinite(projection)) return true;
  if (prop.sportsbookComparison || prop.lineComparison) return true;
  if (prop.projectionSource && prop.projectionSource !== "missing") return true;
  if (prop.isQualificationAccepted) return true;
  return false;
}

function isPropVerified(prop = {}) {
  if (prop.verified === false || prop.sportsbookVerified === false) return false;
  return isVerifiedSportsbookProp(prop);
}

/** Only block Top Picks for true safety failures — not tier preferences. */
export function explainTopPickRejection(prop = {}) {
  if (!isPropVerified(prop)) return "unverified";
  if (!meetsReadyToBetQuality(prop)) return "below ready quality bar";
  if (prop.freshnessTier === "EXPIRED") return "stale";
  if (!hasUsableProjection(prop)) return "broken projection";
  if (getVolatilityLabel(prop) === "HIGH") return "high volatility";
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (prop.lineMovement?.againstPick && movementTag === "steamed") {
    const delta = Math.abs(Number(prop.lineMovement?.delta ?? prop.lineMovement?.change ?? 0));
    if (delta >= 0.75) return "catastrophic line movement";
  }
  return "";
}

export function isTopPickOutputEligible(prop = {}) {
  return explainTopPickRejection(prop) === "";
}

function volatilityPenalty(prop = {}) {
  const vol = finiteNumber(prop.volatility);
  if (!Number.isFinite(vol)) return 0;
  if (vol >= 4) return 10;
  if (vol >= 3.5) return 7;
  if (vol >= 3) return 4;
  if (vol >= 2.75) return 2;
  return 0;
}

function lineMovementPenalty(prop = {}) {
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (prop.lineMovement?.againstPick) return 6;
  if (movementTag === "steamed") return 5;
  if (movementTag === "volatile") return 3;
  return 0;
}

/** Output-only weighted score — used only for ranking accepted props. */
export function computeTopPickWeightedScore(prop = {}) {
  const existing = Number(prop.weightedScore ?? prop.topPickWeightedScore);
  if (Number.isFinite(existing) && existing > 0) return round(existing, 1);

  const confidence = confidenceValue(prop);
  const edge = edgeValue(prop);
  const marketReliability = Number(prop.marketReliabilityScore ?? 50);
  const projection = finiteNumber(prop.projectedValue ?? prop.projection);
  const line = finiteNumber(prop.line);
  let projectionStrength = 0;
  if (Number.isFinite(projection) && Number.isFinite(line) && line > 0) {
    projectionStrength = clamp((Math.abs(projection - line) / line) * 20, 0, 12);
  }

  const score =
    confidence +
    clamp(edgeValue(prop) * 6, 0, 18) +
    projectionStrength +
    (marketReliability - 50) * 0.12 +
    getMlbQualityTierWeight(prop) * 6 +
    volatilitySafetyScore(prop) * 2 +
    lineStabilityScore(prop) * 2 -
    volatilityPenalty(prop) -
    lineMovementPenalty(prop);

  return round(clamp(score, 0, 100), 1);
}

/** Elite > Strong > Playable — ranking preference only, never a hard gate. */
export function topPickConfidenceBand(prop = {}) {
  const confidence = confidenceValue(prop);
  if (confidence >= CONFIDENCE_THRESHOLDS.ELITE) return 3;
  if (confidence >= CONFIDENCE_THRESHOLDS.STRONG) return 2;
  if (confidence >= CONFIDENCE_THRESHOLDS.PLAYABLE) return 1;
  return 0;
}

function sortScore(prop = {}) {
  return computeTopPickWeightedScore(prop) || confidenceValue(prop);
}

function rankAcceptedProp(a = {}, b = {}) {
  const qualityDelta = comparePropQuality(a, b);
  if (qualityDelta !== 0) return qualityDelta;
  const bandDelta = topPickConfidenceBand(b) - topPickConfidenceBand(a);
  if (bandDelta !== 0) return bandDelta;
  return sortScore(b) - sortScore(a);
}

function annotateRenderedPick(prop = {}, fallback = false) {
  const weightedScore = computeTopPickWeightedScore(prop);
  return {
    ...prop,
    weightedScore,
    topPickWeightedScore: weightedScore,
    topPickConfidenceBand: topPickConfidenceBand(prop),
    topPickFallback: fallback,
  };
}

function selectFromBand(eligible = [], minBand = 0) {
  return [...eligible]
    .filter((prop) => topPickConfidenceBand(prop) >= minBand)
    .sort((a, b) => sortScore(b) - sortScore(a) || rankAcceptedProp(a, b));
}

/**
 * Final Top 2 render selection from already-accepted props.
 * Does NOT re-run qualification — only safety filters and tier-priority ranking.
 */
export function selectTopPicks(acceptedProps = [], limit = 2) {
  const pool = Array.isArray(acceptedProps) ? acceptedProps.filter(Boolean) : [];
  if (!pool.length) return [];

  const eligible = [];
  pool.forEach((prop) => {
    if (prop.verified === false || prop.sportsbookVerified === false) return;
    if (explainTopPickRejection(prop)) return;
    eligible.push(annotateRenderedPick(prop, false));
  });

  const strict = eligible.filter(meetsTopPickQuality).sort(rankAcceptedProp);
  if (strict.length) return strict.slice(0, limit);

  let ranked = selectFromBand(eligible, 3);
  if (!ranked.length) ranked = selectFromBand(eligible, 2);
  if (!ranked.length) ranked = selectFromBand(eligible, 1);
  if (!ranked.length) ranked = [...eligible].sort(rankAcceptedProp);

  let topPicks = ranked.slice(0, limit);
  if (!topPicks.length && pool.length) {
    topPicks = pool
      .filter((prop) => prop.verified !== false && prop.sportsbookVerified !== false && meetsReadyToBetQuality(prop))
      .map((prop) => annotateRenderedPick(prop, true))
      .sort(rankAcceptedProp)
      .slice(0, limit);
  }

  return topPicks;
}
