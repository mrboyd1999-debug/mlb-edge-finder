import { CONFIDENCE_THRESHOLDS } from "./confidenceEngine.js";
import { getMlbQualityTierWeight } from "../utils/mlbOnlyMode.js";

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

function confidenceValue(prop = {}) {
  return Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
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
  const edge = Number(prop.edge || 0);
  const marketReliability = Number(prop.marketReliabilityScore ?? 50);
  const projection = finiteNumber(prop.projectedValue ?? prop.projection);
  const line = finiteNumber(prop.line);
  let projectionStrength = 0;
  if (Number.isFinite(projection) && Number.isFinite(line) && line > 0) {
    projectionStrength = clamp((Math.abs(projection - line) / line) * 20, 0, 12);
  }

  const score =
    confidence +
    clamp(edge * 6, 0, 18) +
    projectionStrength +
    (marketReliability - 50) * 0.12 +
    getMlbQualityTierWeight(prop) * 6 -
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

function rankAcceptedProp(a = {}, b = {}) {
  const bandDelta = topPickConfidenceBand(b) - topPickConfidenceBand(a);
  if (bandDelta !== 0) return bandDelta;
  const scoreDelta = computeTopPickWeightedScore(b) - computeTopPickWeightedScore(a);
  if (scoreDelta !== 0) return scoreDelta;
  return confidenceValue(b) - confidenceValue(a) || Number(b.edge || 0) - Number(a.edge || 0);
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

/**
 * Final Top 2 render selection from already-accepted props.
 * Does NOT re-run qualification, volatility, verification, stale, or projection gates.
 */
export function selectTopPicks(acceptedProps = [], limit = 2) {
  const pool = Array.isArray(acceptedProps) ? acceptedProps.filter(Boolean) : [];
  const rejectionReasons = [];

  if (!pool.length) {
    rejectionReasons.push({ reason: "accepted props pool is empty" });
    console.log("ACCEPTED PROPS", pool);
    console.log("TOP PICK CANDIDATES", []);
    console.log("FINAL RENDER PICKS", []);
    console.log("WHY TOP PICKS FAILED", rejectionReasons);
    return [];
  }

  const topCandidates = pool.map((prop) => annotateRenderedPick(prop, false)).sort(rankAcceptedProp);
  let finalRenderedPicks = topCandidates.slice(0, limit);

  if (!finalRenderedPicks.length) {
    finalRenderedPicks = pool
      .map((prop) => annotateRenderedPick(prop, true))
      .sort(rankAcceptedProp)
      .slice(0, limit);
    rejectionReasons.push({ reason: "used direct accepted-prop fallback slice" });
  }

  console.log("ACCEPTED PROPS", pool);
  console.log("TOP PICK CANDIDATES", topCandidates.slice(0, Math.max(limit, 5)));
  console.log("FINAL RENDER PICKS", finalRenderedPicks);
  console.log("WHY TOP PICKS FAILED", rejectionReasons);

  return finalRenderedPicks;
}

/** @deprecated diagnostics only — accepted props should not be re-gated at render time. */
export function explainTopPickRejection() {
  return "";
}

export function isTopPickOutputEligible() {
  return true;
}
