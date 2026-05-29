/** Realistic probability, playability tiers, and lean helpers for MLB props. */

import { computeStandardEdge, computeStandardEdgePercent, computeStandardPropMetrics } from "./standardPropMetrics.js";

export const PICK_TIER_VERIFIED = "Verified Play";
export const PICK_TIER_RESEARCH = "Research Candidate";

const VERIFIED_MIN_CONFIDENCE = 65;
const VERIFIED_MIN_PROBABILITY = 60;
const VERIFIED_MIN_DATA_QUALITY = 75;
const RESEARCH_MAX_RAW_CONFIDENCE = 50;
const RESEARCH_MAX_PROBABILITY = 70;
const ELITE_DATA_QUALITY = 85;

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

export function hasMissingMatchupData(prop = {}) {
  return !prop.matchupNote && !prop.handednessMatchup;
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

/** Apply research-gap penalties to raw confidence before tiering. */
export function computeAdjustedConfidence(prop = {}) {
  const base = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(base)) return null;
  let adjusted = base;
  if (hasMissingMatchupData(prop)) adjusted -= 10;
  if (hasMissingOpponentData(prop)) adjusted -= 10;
  if (hasMissingSportsbookComparison(prop)) adjusted -= 10;
  return clamp(Math.round(adjusted), 0, 100);
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
  if (finiteOr(prop.dataQualityScore, 0) < VERIFIED_MIN_DATA_QUALITY) return true;
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

export function formatEdgeDisplay(prop = {}) {
  const line = finiteOr(prop.line, NaN);
  const raw = finiteOr(prop.edge, NaN);
  if (!Number.isFinite(raw) || !Number.isFinite(line) || line <= 0) {
    return { rawEdgeLabel: "—", displayEdgeLabel: "—", edgeCapped: false };
  }
  const displayPct = finiteOr(prop.edgePercent, computeStandardEdgePercent(raw, line));
  const rawPct = Math.round((raw / line) * 100);
  const capped = Math.abs(rawPct) > 50;
  const rawEdgeLabel = `${raw > 0 ? "+" : ""}${round1(raw)}`;
  const displayEdgeLabel = Number.isFinite(displayPct)
    ? capped
      ? `${displayPct > 0 ? "+" : ""}${displayPct}% (capped)`
      : `${displayPct > 0 ? "+" : ""}${displayPct}%`
    : "—";
  return { rawEdgeLabel, displayEdgeLabel, edgeCapped: capped };
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

function canExceedConfidencePlusTen(prop = {}, { verified = false } = {}) {
  return (
    verified &&
    finiteOr(prop.dataQualityScore, 0) >= ELITE_DATA_QUALITY &&
    !hasMajorResearchGaps(prop) &&
    !hasMissingMatchupData(prop) &&
    !hasMissingOpponentData(prop) &&
    !hasMissingSportsbookComparison(prop)
  );
}

function applyProbabilityCaps(probability, prop = {}, { verified = false, confidence = null } = {}) {
  const conf = finiteOr(confidence ?? prop.displayConfidenceScore ?? computeAdjustedConfidence(prop), NaN);
  let cap = verified ? 85 : RESEARCH_MAX_PROBABILITY;

  if (!canExceedConfidencePlusTen(prop, { verified }) && Number.isFinite(conf)) {
    cap = Math.min(cap, conf + 10);
  }

  if (!verified) {
    cap = Math.min(cap, RESEARCH_MAX_PROBABILITY);
  }

  if (!Number.isFinite(conf)) cap = Math.min(cap, 60);
  if (isResearchCandidate(prop, { confidence: conf })) cap = Math.min(cap, RESEARCH_MAX_PROBABILITY);

  return clamp(Math.round(probability), 50, cap);
}

export function computeConservativeProbability(prop = {}, metrics = {}, options = {}) {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  if (projection == null || !Number.isFinite(line) || line <= 0) return null;

  const adjustedConfidence = options.confidence ?? computeAdjustedConfidence(prop);
  const edge = metrics.edge ?? computeStandardEdge(projection, line);
  const edgePercent = metrics.edgePercent ?? computeStandardEdgePercent(edge, line) ?? 0;
  const edgeStrength = Math.min(Math.abs(edgePercent) / 50, 1);
  let probability = 50 + edgeStrength * 20;

  const dq = finiteOr(prop.dataQualityScore, 50);
  if (dq >= 80) probability += 3;

  const lean = resolveLeanFromEdge(edge);
  const hit = finiteOr(prop.recentHitRate ?? prop.last5HitRate, NaN);
  if (Number.isFinite(hit)) {
    const supports =
      (lean === "Higher" && hit >= 0.55) || (lean === "Lower" && hit <= 0.45) || Math.abs(hit - 0.5) >= 0.08;
    if (supports) probability += 2;
  }

  if (hasMissingOpponentData(prop)) probability -= 5;
  if (hasMissingMatchupData(prop)) probability -= 5;
  if (hasMissingSportsbookComparison(prop)) probability -= 5;

  const vol = finiteOr(prop.volatility, NaN);
  if (Number.isFinite(vol) && vol >= 3) probability -= 5;

  if (prop.isFallbackProjection || prop.fallbackProfile || prop.sparseProfile || prop.lineOnlyData) {
    probability -= 10;
  }

  const verified = options.verified ?? false;
  return applyProbabilityCaps(probability, prop, { verified, confidence: adjustedConfidence });
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
  const probabilityScore = computeConservativeProbability(prop, base, {
    verified: false,
    confidence: adjustedConfidence,
  });
  return {
    ...base,
    ...edgeDisplay,
    probabilityScore,
    adjustedConfidence,
    lean: resolveLeanFromEdge(base.edge),
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
  const research =
    lowRawConfidence ||
    isResearchCandidate({ ...prop, projection, projectedValue: projection }, { confidence: adjustedConfidence });

  let probability =
    metrics.probabilityScore ??
    computeConservativeProbability(prop, metrics, { verified: !research, confidence: adjustedConfidence });

  const verified = isVerifiedPlay(prop, { probability, confidence: adjustedConfidence });
  const playable = verified;

  if (probability != null) {
    probability = applyProbabilityCaps(probability, prop, {
      verified: playable,
      confidence: adjustedConfidence,
    });
  }

  const tier = playable ? PICK_TIER_VERIFIED : PICK_TIER_RESEARCH;
  const displayConfidenceScore = resolveDisplayConfidence(prop, tier, adjustedConfidence);
  const researchReasons = research ? resolveResearchReasons(prop) : [];

  const whyNotPlayable = playable
    ? ""
    : researchReasons.join(" · ") || "Does not meet verified play thresholds";

  return {
    isDisplayPlayable: playable,
    displayResearchOnly: !playable,
    bettingLabel: playable ? PICK_TIER_VERIFIED : PICK_TIER_RESEARCH,
    cardStatus: playable ? "playable" : "research",
    pickTierLabel: playable ? PICK_TIER_VERIFIED : PICK_TIER_RESEARCH,
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
  return prop.pickTierLabel === PICK_TIER_VERIFIED && isVerifiedPlay(prop);
}

export function highestProbabilityLabel(prop = {}) {
  return qualifiesAsHighestProbabilityPick(prop) ? "Highest Probability Pick" : "Top Research Candidate";
}
