/**
 * Playability scoring — neutral weights for missing history, component breakdown audit.
 */

import { resolveHistoricalDataPresent } from "./tierHistoricalValidation.js";
import { resolveBestPlayEdgePercent } from "./bestPlaysPipelineDebug.js";

export const NEUTRAL_PLAYABILITY_COMPONENT = 50;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

/** Missing historical data → neutral 50, not 0. */
export function computeHistoricalPlayabilityComponent(prop = {}) {
  const historical = resolveHistoricalDataPresent(prop);
  if (!historical.present) return NEUTRAL_PLAYABILITY_COMPONENT;

  let score = NEUTRAL_PLAYABILITY_COMPONENT;
  const seasonHit = finite(prop.seasonHitRate ?? prop.historicalHitRate);
  const last10Hit = finite(prop.last10HitRate ?? prop.recentHitRate);
  const last5Hit = finite(prop.last5HitRate);

  if (seasonHit != null) score += (seasonHit - 0.5) * 28;
  if (last10Hit != null) score += (last10Hit - 0.5) * 18;
  if (last5Hit != null) score += (last5Hit - 0.5) * 14;

  return round2(clamp(score, 30, 92));
}

/** Missing Last5/Last10 → neutral 50 with no negative penalty. */
export function computeTrendPlayabilityComponent(prop = {}) {
  const historical = resolveHistoricalDataPresent(prop);
  if (!historical.last5Present && !historical.last10Present) {
    return NEUTRAL_PLAYABILITY_COMPONENT;
  }

  const line = finite(prop.line);
  if (!line || line <= 0) return NEUTRAL_PLAYABILITY_COMPONENT;

  let score = NEUTRAL_PLAYABILITY_COMPONENT;
  const last5 = finite(prop.last5Average ?? prop.recentForm);
  const last10 = finite(prop.last10Average);
  const projection = finite(prop.projection ?? prop.projectedValue);
  const leanOver = projection != null ? projection >= line : (last5 ?? last10 ?? line) >= line;

  if (historical.last5Present && last5 != null) {
    const favor = leanOver ? last5 - line : line - last5;
    score += Math.max(-8, Math.min(8, favor * 4));
  }
  if (historical.last10Present && last10 != null) {
    const favor = leanOver ? last10 - line : line - last10;
    score += Math.max(-6, Math.min(6, favor * 3));
  }

  return round2(clamp(score, 35, 88));
}

export function computeProjectionPlayabilityComponent(prop = {}, metrics = {}) {
  const edge = finite(metrics.edge ?? prop.edge);
  const edgePercent = finite(metrics.edgePercent ?? prop.edgePercent);
  const line = finite(prop.line);
  let score = NEUTRAL_PLAYABILITY_COMPONENT;

  if (edgePercent != null) {
    score += Math.min(22, Math.abs(edgePercent) * 0.85);
  } else if (edge != null && line > 0) {
    score += Math.min(18, Math.abs(edge / line) * 50);
  }

  const edgePctFromResolver = resolveBestPlayEdgePercent({ ...prop, ...metrics });
  if (edgePercent == null && edgePctFromResolver > 0) {
    score += Math.min(16, edgePctFromResolver * 0.75);
  }

  const probability = finite(metrics.probabilityScore ?? prop.probabilityScore ?? prop.verifiedProbability);
  if (probability != null) score += (probability - 50) * 0.22;

  const projection = finite(metrics.projection ?? prop.projection ?? prop.projectedValue);
  if (projection != null && line != null && line > 0) {
    score += Math.min(12, (Math.abs(projection - line) / line) * 35);
  }

  return round2(clamp(score, 35, 92));
}

/** Sanity/risk penalties only — never penalize missing history or missing L5/L10. */
export function computePlayabilityPenaltyComponent(prop = {}, sanityAudit = null) {
  const audit = sanityAudit || prop.projectionSanityAudit;
  let penalty = 0;

  if (audit?.sanityFail) penalty += 18;
  else if (audit?.projectionMismatch) penalty += 12;
  else if (audit?.isOutlier) penalty += 8;
  else if (audit?.sanityScore != null && audit.sanityScore < 65) penalty += 6;

  if (String(prop.riskLevel || "").toUpperCase() === "HIGH") penalty += 6;

  return round2(clamp(penalty, 0, 35));
}

export function computePlayabilityBreakdown(prop = {}, options = {}) {
  const metrics = options.metrics || {};
  const sanityAudit = options.sanityAudit ?? prop.projectionSanityAudit ?? null;
  const probability =
    finite(options.probability ?? prop.probabilityScore ?? prop.verifiedProbability) ??
    NEUTRAL_PLAYABILITY_COMPONENT;
  const confidence =
    finite(
      options.confidence ??
        prop.displayConfidenceScore ??
        prop.confidenceScore ??
        prop.confidence
    ) ?? NEUTRAL_PLAYABILITY_COMPONENT;

  const historicalComponent = computeHistoricalPlayabilityComponent(prop);
  const trendComponent = computeTrendPlayabilityComponent(prop);
  const projectionComponent = computeProjectionPlayabilityComponent(prop, metrics);
  const penaltyComponent = computePlayabilityPenaltyComponent(prop, sanityAudit);

  const weighted =
    probability * 0.22 +
    confidence * 0.22 +
    historicalComponent * 0.18 +
    trendComponent * 0.14 +
    projectionComponent * 0.24 -
    penaltyComponent;

  return {
    probability: round2(probability),
    confidence: round2(confidence),
    historicalComponent: round2(historicalComponent),
    trendComponent: round2(trendComponent),
    projectionComponent: round2(projectionComponent),
    penaltyComponent: round2(penaltyComponent),
    weightedRaw: round2(weighted),
    finalPlayability: round2(clamp(weighted, 0, 100)),
  };
}

export function computePlayabilityScoreFromBreakdown(prop = {}, options = {}) {
  return computePlayabilityBreakdown(prop, options).finalPlayability;
}
