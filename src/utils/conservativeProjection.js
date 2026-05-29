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
  return sample >= 5 && recent && opponent && books && injury;
}

/**
 * Conservative probability (50–78 typical, up to 85 only with complete data).
 */
export function computeConservativeProbability(prop = {}, metrics = {}) {
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

  const maxCap = hasCompleteDataForEliteProbability(prop) ? 85 : 78;
  return clamp(Math.round(probability), 50, maxCap);
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
  const probabilityScore = computeConservativeProbability(prop, base);
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
  const probability = metrics.probabilityScore ?? computeConservativeProbability(prop, metrics);
  const dq = finiteOr(prop.dataQualityScore, 0);
  const confidence = finiteOr(prop.confidenceScore ?? prop.confidence, 0);

  if (projection == null || !Number.isFinite(line) || line <= 0) {
    return {
      isDisplayPlayable: false,
      displayResearchOnly: true,
      bettingLabel: "Projection unavailable",
      cardStatus: "unavailable",
      whyNotPlayable: "Projection unavailable",
    };
  }

  const majorGaps = hasMajorResearchGaps(prop);
  const sport = String(prop.sport || prop.league || "").toUpperCase();
  const mlbOnly = !sport || sport === "MLB" || sport.includes("BASEBALL");
  const playable =
    mlbOnly &&
    probability != null &&
    probability >= 60 &&
    dq >= 70 &&
    !majorGaps &&
    !prop.projectionUnavailable &&
    !prop.isFallbackProjection;

  const displayResearchOnly = !playable;
  const whyNotPlayable = playable
    ? ""
    : [
        probability != null && probability < 60 ? `Probability ${probability}% below 60` : "",
        dq < 70 ? `Data quality ${Math.round(dq)} below 70` : "",
        majorGaps ? "Research gaps present" : "",
        prop.projectionUnavailable ? "Projection unavailable" : "",
      ]
      .filter(Boolean)
      .join(" · ") || "Does not meet playable thresholds";

  return {
    isDisplayPlayable: playable,
    displayResearchOnly,
    bettingLabel: playable ? "Playable" : "Research only",
    cardStatus: playable ? "playable" : "research",
    whyNotPlayable,
    probabilityScore: probability,
    confidenceScore: confidence,
  };
}

export function qualifiesAsHighestProbabilityPick(prop = {}) {
  return (
    Boolean(prop.isDisplayPlayable) &&
    Number(prop.probabilityScore ?? 0) >= 65 &&
    Number(prop.confidenceScore ?? prop.confidence ?? 0) >= 65 &&
    Number(prop.dataQualityScore ?? 0) >= 75 &&
    !hasMajorResearchGaps(prop)
  );
}

export function highestProbabilityLabel(prop = {}) {
  return qualifiesAsHighestProbabilityPick(prop) ? "Highest Probability Pick" : "Top Research Candidate";
}
