/** Realistic probability, playability tiers, and lean helpers for MLB props. */

import { computeStandardEdge, computeRelativeEdgePercent, computeStandardPropMetrics } from "./standardPropMetrics.js";
import { computeMlbPlayConfidence } from "./mlbPlayConfidence.js";
import { classifyVerifiedTier } from "./verifiedTierSystem.js";
import { resolveProjectionLeanDisplay, resolveProjectionLean } from "./pickDirectionAudit.js";
import { computeCalibratedProbability, resolveCalibrationHitRates, computeMatchupAdjustment } from "./probabilityCalibration.js";
import {
  formatValidatedEdgeDisplay,
  hasPartialDataFlags,
  PARTIAL_DATA_CONFIDENCE_PENALTY,
  classifyConfidenceTier,
  CONFIDENCE_CALIBRATION_MIN,
  CONFIDENCE_CALIBRATION_MAX,
} from "./boardQuality.js";

export const PICK_TIER_VERIFIED = "Verified Play";
export const PICK_TIER_RESEARCH = "Research Candidate";

const VERIFIED_MIN_CONFIDENCE = 50;
const VERIFIED_MIN_PROBABILITY = 45;
const VERIFIED_MIN_DATA_QUALITY = 50;
export const CONSERVATIVE_MIN_CONFIDENCE = 55;
export const CONSERVATIVE_MIN_PROBABILITY = 58;
const RESEARCH_MAX_RAW_CONFIDENCE = 50;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function resolveProjectionValue(prop = {}) {
  const proj = finiteOr(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(proj) || proj <= 0) return null;
  return proj;
}

export function resolveLeanFromEdge(edge, prop = {}) {
  const { projection, line } = {
    projection: finiteOr(prop?.projection ?? prop?.projectedValue, NaN),
    line: finiteOr(prop?.line, NaN),
  };
  if (Number.isFinite(projection) && Number.isFinite(line) && line > 0) {
    return resolveProjectionLeanDisplay(prop);
  }
  const e = Number(edge);
  if (!Number.isFinite(e) || Math.abs(e) < 0.01) return "Pass";
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

export function hasMissingMatchupData(prop = {}) {
  if (prop.matchupConfidence === "LOW") return false;
  return !prop.matchupNote && !prop.handednessMatchup && !String(prop.opponent || "").trim();
}

export function isLowMatchupProp(prop = {}) {
  if (prop.matchupConfidence === "HIGH" || prop.matchupConfidence === "MEDIUM" || prop.matchupConfidence === "FORM") {
    return false;
  }
  if (prop.formBaseline != null || prop.formConfidenceScore != null) return false;
  if (prop.matchupNote || prop.handednessMatchup) return false;
  return prop.matchupConfidence === "LOW" || (!prop.matchupNote && !prop.handednessMatchup);
}

export function hasMissingOpponentData(prop = {}) {
  const opponent = String(prop.opponent || "").trim();
  return (
    !opponent &&
    prop.opponentRank == null &&
    prop.opponentAllowed == null &&
    !prop.opponentContext
  );
}

export function hasMissingSportsbookComparison(prop = {}) {
  return !prop.sportsbookComparison && !Number(prop.sportsbookBooksCount || 0);
}

/** Apply weighted hit-rate blend capped at realistic MLB confidence. */
function normalizeHitRatePercent(value) {
  const num = finiteOr(value, NaN);
  if (!Number.isFinite(num)) return 50;
  if (num <= 1) return num * 100;
  return num;
}

function matchupScoreForConfidence(prop = {}) {
  const adj = computeMatchupAdjustment(prop);
  return clamp(50 + adj * 2, 50, 95);
}

export function computeAdjustedConfidence(prop = {}) {
  const hitRates = resolveCalibrationHitRates(prop);
  const recentHitRate = normalizeHitRatePercent(
    prop.last10HitRate ?? prop.recentHitRate ?? hitRates.last10HitRate ?? 50
  );
  const seasonHitRate = normalizeHitRatePercent(
    prop.seasonHitRate ?? prop.historicalHitRate ?? hitRates.seasonHitRate ?? 50
  );
  const projectionProbability = finiteOr(prop.probabilityScore ?? prop.verifiedProbability, 50);
  const matchupScore = matchupScoreForConfidence(prop);

  let confidence =
    recentHitRate * 0.4 +
    seasonHitRate * 0.3 +
    projectionProbability * 0.2 +
    matchupScore * 0.1;

  if (hasPartialDataFlags(prop)) {
    confidence -= PARTIAL_DATA_CONFIDENCE_PENALTY;
  }

  return clamp(
    Math.round(confidence * 10) / 10,
    CONFIDENCE_CALIBRATION_MIN,
    CONFIDENCE_CALIBRATION_MAX
  );
}

export function resolveTierProjectionValue(prop = {}) {
  if (prop.projectionUnavailable || prop.isFallbackProjection || prop.unverifiedGradeBlocked) return null;
  const source = String(prop.projectionSource || "").toLowerCase();
  if (/missing|fallback|estimate|manual-fallback|line-neutral|unavailable|stat-type-mismatch/.test(source)) {
    return null;
  }
  return resolveProjectionValue(prop);
}

/** Research tier when any supporting input is incomplete. */
export function isResearchCandidate(prop = {}, { confidence } = {}) {
  if (resolveTierProjectionValue(prop) == null) return true;
  const rawConf = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(rawConf) || rawConf < RESEARCH_MAX_RAW_CONFIDENCE) return true;
  const adjusted = confidence ?? computeAdjustedConfidence(prop);
  if (!Number.isFinite(adjusted) || adjusted <= 0) return true;
  if (hasMissingMatchupData(prop)) return true;
  if (hasMissingOpponentData(prop)) return true;
  if (hasMissingSportsbookComparison(prop)) return true;
  if (finiteOr(prop.dataQualityScore, 0) < VERIFIED_MIN_DATA_QUALITY && !isLowMatchupProp(prop)) return true;
  if (hasMajorResearchGaps(prop)) return true;
  if (prop.projectionUnavailable || prop.isFallbackProjection) return true;
  return false;
}

export function isVerifiedPlay(prop = {}, { probability, confidence } = {}) {
  if (isResearchCandidate(prop, { confidence })) return false;
  const prob = finiteOr(probability ?? prop.probabilityScore, NaN);
  const conf = finiteOr(confidence ?? prop.displayConfidenceScore ?? computeAdjustedConfidence(prop), NaN);
  const dq = finiteOr(prop.dataQualityScore, 0);
  return (
    prob >= VERIFIED_MIN_PROBABILITY &&
    conf >= VERIFIED_MIN_CONFIDENCE &&
    dq >= VERIFIED_MIN_DATA_QUALITY &&
    Number.isFinite(conf) &&
    resolveTierProjectionValue(prop) != null
  );
}

export function resolveDisplayConfidence(prop = {}, tier = PICK_TIER_RESEARCH, adjustedConfidence = null) {
  const raw = adjustedConfidence ?? computeAdjustedConfidence(prop) ?? finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(raw)) return null;
  if (tier === PICK_TIER_RESEARCH) return Math.min(Math.round(raw), 70);
  return Math.round(raw);
}

export { classifyConfidenceTier, classifyPropTier } from "./boardQuality.js";

export function formatEdgeDisplay(prop = {}) {
  return formatValidatedEdgeDisplay(prop);
}

export function resolveResearchReasons(prop = {}) {
  const reasons = [];
  if (!Number.isFinite(computeAdjustedConfidence(prop))) reasons.push("Confidence inputs missing");
  if (hasMissingMatchupData(prop)) reasons.push("Matchup data missing");
  if (hasMissingOpponentData(prop)) reasons.push("Opponent data missing");
  if (hasMissingSportsbookComparison(prop)) reasons.push("Sportsbook comparison missing");
  if (finiteOr(prop.dataQualityScore, 0) < VERIFIED_MIN_DATA_QUALITY) {
    reasons.push(`Data quality ${Math.round(finiteOr(prop.dataQualityScore, 0))}% below 75`);
  }
  if (hasMajorResearchGaps(prop)) reasons.push("Research gaps");
  if (prop.projectionUnavailable || prop.isFallbackProjection) reasons.push("Projection incomplete");
  return reasons;
}

function applyProbabilityCaps(probability, prop = {}, { verified = false } = {}) {
  void verified;
  const ceiling = 95;
  const floor = 50;
  let value = round1(probability);
  if (isResearchCandidate(prop) && !verified) {
    return clamp(value, floor, Math.min(ceiling, 95));
  }
  return clamp(value, floor, ceiling);
}

export function computeConservativeProbability(prop = {}, metrics = {}, options = {}) {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  if (projection == null || !Number.isFinite(line) || line <= 0) return null;

  const calibrated = computeCalibratedProbability(prop, metrics, {
    verified: options.verified ?? false,
  });
  if (calibrated?.probability == null) return null;

  return applyProbabilityCaps(calibrated.probability, prop, {
    verified: options.verified ?? false,
  });
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
      ...formatEdgeDisplay({}),
    };
  }

  const base = computeStandardPropMetrics({ projection, line });
  const edgeDisplay = formatEdgeDisplay({ ...prop, ...base, line });
  const adjustedConfidence = computeAdjustedConfidence(prop);
  const researchGap = isResearchCandidate(prop, { confidence: adjustedConfidence });
  const calibrated = computeCalibratedProbability(prop, base, { verified: !researchGap });
  const probabilityScore =
    calibrated?.probability != null
      ? applyProbabilityCaps(calibrated.probability, prop, { verified: !researchGap })
      : null;
  return {
    ...base,
    ...edgeDisplay,
    probabilityScore,
    probabilityCalibration: calibrated,
    adjustedConfidence,
    lean: resolveLeanFromEdge(base.edge, prop),
    projectionStatus: "ok",
  };
}

export function evaluateMlbPlayability(prop = {}, metrics = {}) {
  const projection = resolveTierProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  const adjustedConfidence = metrics.adjustedConfidence ?? computeAdjustedConfidence(prop);
  const rawConfidence = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);

  if (projection == null || !Number.isFinite(line) || line <= 0) {
    return {
      isDisplayPlayable: false,
      displayResearchOnly: true,
      bettingLabel: "Rejected",
      cardStatus: "rejected",
      whyNotPlayable: "Projection missing — automatic reject",
      pickTierLabel: PICK_TIER_RESEARCH,
      pickTierRank: 1,
      displayConfidenceScore: null,
      adjustedConfidence: null,
      researchReasons: ["Projection missing"],
      rejected: true,
    };
  }

  const lowRawConfidence = !Number.isFinite(rawConfidence) || rawConfidence < RESEARCH_MAX_RAW_CONFIDENCE;
  const researchGap =
    lowRawConfidence ||
    isResearchCandidate({ ...prop, projection, projectedValue: projection }, { confidence: adjustedConfidence });

  let probability =
    metrics.probabilityScore ??
    computeConservativeProbability(prop, metrics, { verified: !researchGap, confidence: adjustedConfidence });

  const verified = isVerifiedPlay(prop, { probability, confidence: adjustedConfidence });
  const lowMatchupResearch =
    isLowMatchupProp(prop) &&
    Number.isFinite(probability) &&
    probability >= CONSERVATIVE_MIN_PROBABILITY &&
    Number.isFinite(adjustedConfidence) &&
    adjustedConfidence >= CONSERVATIVE_MIN_CONFIDENCE;
  const playable = verified;
  const research = !playable && (lowMatchupResearch || researchGap);

  if (probability != null && metrics.probabilityScore == null) {
    probability = applyProbabilityCaps(probability, prop, { verified: playable });
  }

  const tier = playable ? PICK_TIER_VERIFIED : research ? PICK_TIER_RESEARCH : PICK_TIER_RESEARCH;
  const displayConfidenceScore = resolveDisplayConfidence(prop, tier, adjustedConfidence);
  const researchReasons = research ? resolveResearchReasons(prop) : [];

  const whyNotPlayable = playable
    ? ""
    : researchReasons.join(" · ") || "Does not meet verified play thresholds";

  return {
    isDisplayPlayable: playable,
    displayResearchOnly: !playable,
    bettingLabel: playable ? PICK_TIER_VERIFIED : PICK_TIER_RESEARCH,
    cardStatus: playable ? "playable" : research ? "research" : "research",
    pickTierLabel: playable ? PICK_TIER_VERIFIED : research ? PICK_TIER_RESEARCH : PICK_TIER_RESEARCH,
    pickTierRank: playable ? 0 : 1,
    whyNotPlayable,
    probabilityScore: probability,
    confidenceScore: displayConfidenceScore ?? adjustedConfidence,
    displayConfidenceScore,
    adjustedConfidence,
    researchReasons,
    edgeDisplay: formatEdgeDisplay({ ...prop, ...metrics, line }),
    rejected: false,
  };
}

export function resolvePickSortKey(prop = {}) {
  return {
    tier: prop.pickTierRank ?? (prop.pickTierLabel === PICK_TIER_VERIFIED ? 0 : 1),
    probability: Number(prop.probabilityScore ?? 0),
    confidence: Number(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence ?? 0),
    dataQuality: Number(prop.dataQualityScore ?? 0),
  };
}

export function comparePickRank(a = {}, b = {}) {
  const keyA = resolvePickSortKey(a);
  const keyB = resolvePickSortKey(b);
  if (keyA.tier !== keyB.tier) return keyA.tier - keyB.tier;
  if (keyB.probability !== keyA.probability) return keyB.probability - keyA.probability;
  if (keyB.confidence !== keyA.confidence) return keyB.confidence - keyA.confidence;
  return keyB.dataQuality - keyA.dataQuality;
}

export function qualifiesAsHighestProbabilityPick(prop = {}) {
  return isVerifiedHighestProbabilityPick(prop) && Boolean(prop.isHighestProbabilityPick);
}

function isVerifiedHighestProbabilityPick(prop = {}) {
  return prop.verifiedTier === "A" || classifyVerifiedTier(prop) === "A";
}

export function highestProbabilityLabel(prop = {}) {
  if (qualifiesAsHighestProbabilityPick(prop)) return "Highest Probability Pick";
  const tier = prop.verifiedTier || classifyVerifiedTier(prop);
  if (tier) return `Verified Play · Tier ${tier}`;
  return "Research Candidate";
}
