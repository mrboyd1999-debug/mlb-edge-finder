/**
 * Playability scoring — aligned with confidence, projection reliability, and data completeness.
 */

import { resolveHistoricalDataPresent } from "./tierHistoricalValidation.js";
import {
  resolveProjectionConfidenceLevel,
  hasPartialDataBadge,
} from "./boardQuality.js";

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

export function computeProjectionReliabilityComponent(prop = {}) {
  const level = resolveProjectionConfidenceLevel(prop);
  if (level === "HIGH") return 88;
  if (level === "MEDIUM") return 74;
  return 58;
}

export function computeDataCompletenessComponent(prop = {}) {
  if (hasPartialDataBadge(prop)) return 42;
  const historical = resolveHistoricalDataPresent(prop);
  let score = 52;
  if (historical.present) score += 18;
  if (historical.last5Present) score += 10;
  if (historical.last10Present) score += 10;
  if (historical.seasonPresent) score += 10;
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
  const sanityAudit = options.sanityAudit ?? prop.projectionSanityAudit ?? null;
  const confidence =
    finite(
      options.confidence ??
        prop.displayConfidenceScore ??
        prop.confidenceScore ??
        prop.confidence
    ) ?? NEUTRAL_PLAYABILITY_COMPONENT;

  const reliabilityComponent = computeProjectionReliabilityComponent(prop);
  const completenessComponent = computeDataCompletenessComponent(prop);
  const penaltyComponent = computePlayabilityPenaltyComponent(prop, sanityAudit);

  const weighted =
    confidence * 0.5 + reliabilityComponent * 0.25 + completenessComponent * 0.25 - penaltyComponent;

  return {
    probability: finite(options.probability ?? prop.probabilityScore ?? prop.verifiedProbability),
    confidence: round2(confidence),
    historicalComponent: round2(completenessComponent),
    trendComponent: round2(reliabilityComponent),
    projectionComponent: round2(reliabilityComponent),
    reliabilityComponent: round2(reliabilityComponent),
    completenessComponent: round2(completenessComponent),
    penaltyComponent: round2(penaltyComponent),
    weightedRaw: round2(weighted),
    finalPlayability: round2(clamp(weighted, 0, 100)),
  };
}

export function computePlayabilityScoreFromBreakdown(prop = {}, options = {}) {
  return computePlayabilityBreakdown(prop, options).finalPlayability;
}
