/** Realistic probability, playability, and lean helpers for MLB props. */

import { computeStandardEdge, computeStandardEdgePercent, computeStandardPropMetrics } from "./standardPropMetrics.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function resolveProjectionValue(prop = {}) {
  const proj = finiteOr(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(proj) || proj <= 0) return null;
  return proj;
}

export function resolveLeanFromEdge(edge) {
  const e = Number(edge);
  if (!Number.isFinite(e) || Math.abs(e) < 0.01) return "Watch";
  return e > 0 ? "Higher" : "Lower";
}

export function hasMajorResearchGaps(prop = {}) {
  const gaps = prop.researchGaps || prop.researchMissingBadge?.label;
  if (Array.isArray(gaps) && gaps.length) return true;
  if (prop.statsMissingBadge || prop.researchMissingBadge) return true;
  if (prop.lineOnlyData || prop.fallbackProfile || prop.sparseProfile) return true;
  if (prop.projectionUnavailable || prop.isFallbackProjection) return true;
  return false;
}

export function isConfidenceAvailable(prop = {}) {
  const score = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(score) || score <= 0) return false;
  const label = String(prop.confidenceLabel || prop.confidenceTier || prop.confidenceExplanation || "").toLowerCase();
  if (/unavailable|missing|unknown/.test(label)) return false;
  return true;
}

export function isDataQualityComplete(prop = {}) {
  return finiteOr(prop.dataQualityScore, 0) >= 70;
}

export function hasCompleteDataForEliteProbability(prop = {}) {
  const projection = resolveProjectionValue(prop);
  if (projection == null) return false;
  const sample = Number(prop.sampleSize || 0);
  const recent =
    Number.isFinite(Number(prop.recentHitRate)) ||
    Number.isFinite(Number(prop.last5HitRate)) ||
    Number.isFinite(Number(prop.last10HitRate));
  const opponent =
    prop.opponentRank != null ||
    prop.opponentAllowed != null ||
    Boolean(prop.matchupNote || prop.handednessMatchup);
  const books =
    Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0) >= 1 ||
    Boolean(prop.sportsbookComparison);
  const injury = prop.injuryRisk != null || prop.injury != null;
  return sample >= 5 && recent && opponent && books && injury && isConfidenceAvailable(prop);
}

function applyProbabilityCaps(probability, prop = {}, { playable = false } = {}) {
  let cap = hasCompleteDataForEliteProbability(prop) ? 85 : 78;
  if (!isConfidenceAvailable(prop)) cap = Math.min(cap, 60);
  if (!isDataQualityComplete(prop) || hasMajorResearchGaps(prop)) cap = Math.min(cap, 65);
  if (!playable) cap = Math.min(cap, 70);
  return clamp(Math.round(probability), 50, cap);
}

/**
 * Conservative probability with strict caps so UI never shows 95% without full data.
 */
export function computeConservativeProbability(prop = {}, metrics = {}, options = {}) {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  if (projection == null || !Number.isFinite(line) || line <= 0) return null;

  const edge = metrics.edge ?? computeStandardEdge(projection, line);
  const edgePercent = metrics.edgePercent ?? computeStandardEdgePercent(edge, line) ?? 0;
  const edgeStrength = Math.min(Math.abs(edgePercent) / 50, 1);
  let probability = 50 + edgeStrength * 25;

  const dq = finiteOr(prop.dataQualityScore, 50);
  if (dq >= 80) probability += 5;

  const lean = resolveLeanFromEdge(edge);
  const hit = finiteOr(prop.recentHitRate ?? prop.last5HitRate, NaN);
  if (Number.isFinite(hit)) {
    const supports =
      (lean === "Higher" && hit >= 0.55) || (lean === "Lower" && hit <= 0.45) || Math.abs(hit - 0.5) >= 0.08;
    if (supports) probability += 3;
  }

  if (!prop.opponentRank && !prop.opponentAllowed && !prop.matchupNote) probability -= 5;
  if (!prop.sportsbookComparison && !prop.sportsbookBooksCount) probability -= 5;

  const vol = finiteOr(prop.volatility, NaN);
  if (Number.isFinite(vol) && vol >= 3) probability -= 7;

  if (prop.isFallbackProjection || prop.fallbackProfile || prop.sparseProfile || prop.lineOnlyData) {
    probability -= 10;
  }

  return applyProbabilityCaps(probability, prop, options);
}

export function computeDisplayPropMetrics(prop = {}) {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  if (projection == null || !Number.isFinite(line) || line <= 0) {
    return {
      edge: null,
      edgePercent: null,
      probabilityScore: null,
      lean: "Watch",
      projectionStatus: "missing",
    };
  }

  const base = computeStandardPropMetrics({ projection, line });
  const probabilityScore = computeConservativeProbability(prop, base, {
    playable: Boolean(prop.isDisplayPlayable),
  });
  return {
    ...base,
    probabilityScore,
    lean: resolveLeanFromEdge(base.edge),
    projectionStatus: "ok",
  };
}

export function evaluateMlbPlayability(prop = {}, metrics = {}) {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  let probability = metrics.probabilityScore ?? computeConservativeProbability(prop, metrics);
  const dq = finiteOr(prop.dataQualityScore, 0);
  const confidence = finiteOr(prop.confidenceScore ?? prop.confidence, 0);
  const confidenceOk = isConfidenceAvailable(prop);

  if (projection == null || !Number.isFinite(line) || line <= 0) {
    return {
      isDisplayPlayable: false,
      displayResearchOnly: true,
      bettingLabel: "Projection unavailable",
      cardStatus: "unavailable",
      whyNotPlayable: "Projection unavailable",
      pickTierLabel: "Research Candidate",
    };
  }

  const majorGaps = hasMajorResearchGaps(prop);
  const sport = String(prop.sport || prop.league || "").toUpperCase();
  const mlbOnly = !sport || sport === "MLB" || sport.includes("BASEBALL");

  const playable =
    mlbOnly &&
    probability != null &&
    probability >= 60 &&
    confidenceOk &&
    confidence >= 65 &&
    dq >= 70 &&
    !majorGaps &&
    !prop.projectionUnavailable &&
    !prop.isFallbackProjection;

  if (!playable && probability != null) {
    probability = applyProbabilityCaps(probability, prop, { playable: false });
  } else if (playable && probability != null) {
    probability = applyProbabilityCaps(probability, prop, { playable: true });
  }

  const displayResearchOnly = !playable;
  const whyNotPlayable = playable
    ? ""
    : [
        !confidenceOk ? "Confidence unavailable" : "",
        confidenceOk && confidence < 65 ? `Confidence ${Math.round(confidence)}% below 65` : "",
        probability != null && !playable && probability <= 70 ? `Probability ${probability}% (research cap)` : "",
        dq < 70 ? `Data quality ${Math.round(dq)} below 70` : "",
        majorGaps ? "Research gaps present" : "",
        prop.projectionUnavailable ? "Projection unavailable" : "",
      ]
      .filter(Boolean)
      .join(" · ") || "Does not meet playable thresholds";

  return {
    isDisplayPlayable: playable,
    displayResearchOnly,
    bettingLabel: playable ? "Playable" : "Research Candidate",
    cardStatus: playable ? "playable" : "research",
    pickTierLabel: playable ? "Verified Play" : "Research Candidate",
    whyNotPlayable,
    probabilityScore: probability,
    confidenceScore: confidence,
  };
}

export function qualifiesAsHighestProbabilityPick(prop = {}) {
  return (
    Boolean(prop.isDisplayPlayable) &&
    Number(prop.probabilityScore ?? 0) >= 65 &&
    isConfidenceAvailable(prop) &&
    Number(prop.confidenceScore ?? prop.confidence ?? 0) >= 65 &&
    Number(prop.dataQualityScore ?? 0) >= 75 &&
    !hasMajorResearchGaps(prop)
  );
}

export function highestProbabilityLabel(prop = {}) {
  return qualifiesAsHighestProbabilityPick(prop) ? "Highest Probability Pick" : "Top Research Candidate";
}
