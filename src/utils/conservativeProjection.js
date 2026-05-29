/** Realistic probability, playability tiers, and lean helpers for MLB props. */

import { computeStandardEdge, computeStandardEdgePercent, computeStandardPropMetrics } from "./standardPropMetrics.js";
import { computeStatSpecificProbability } from "./mlbStatProbability.js";
import { computeMlbPlayConfidence } from "./mlbPlayConfidence.js";
import { classifyVerifiedTier } from "./verifiedTierSystem.js";
import { resolveProjectionLeanDisplay, resolveProjectionLean } from "./pickDirectionAudit.js";

export const PICK_TIER_VERIFIED = "Verified Play";
export const PICK_TIER_RESEARCH = "Research Candidate";

const VERIFIED_MIN_CONFIDENCE = 50;
const VERIFIED_MIN_PROBABILITY = 55;
const VERIFIED_MIN_DATA_QUALITY = 50;
export const CONSERVATIVE_MIN_CONFIDENCE = 55;
export const CONSERVATIVE_MIN_PROBABILITY = 58;
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

/** Apply research-gap penalties to raw confidence before tiering. */
export function computeAdjustedConfidence(prop = {}) {
  const projection = resolveProjectionValue(prop);
  const modelConfidence = computeMlbPlayConfidence(prop, projection);
  const base = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  let adjusted = Number.isFinite(base) ? Math.round(base * 0.35 + modelConfidence * 0.65) : modelConfidence;
  if (isLowMatchupProp(prop)) adjusted -= 3;
  else if (hasMissingMatchupData(prop)) adjusted -= 10;
  if (hasMissingOpponentData(prop)) adjusted -= 6;
  if (hasMissingSportsbookComparison(prop)) adjusted -= 4;
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

export function formatEdgeDisplay(prop = {}) {
  const line = finiteOr(prop.line, NaN);
  const raw = finiteOr(prop.edge, NaN);
  if (!Number.isFinite(raw) || !Number.isFinite(line) || line <= 0) {
    return { rawEdgeLabel: "—", displayEdgeLabel: "—", edgeCapped: false };
  }
  const displayPct = finiteOr(prop.edgePercent, computeStandardEdgePercent(raw, line));
  const rawEdgeLabel = `${raw > 0 ? "+" : ""}${round1(raw)}`;
  const displayEdgeLabel = Number.isFinite(displayPct)
    ? `${displayPct > 0 ? "+" : ""}${displayPct}%`
    : "—";
  return { rawEdgeLabel, displayEdgeLabel, edgeCapped: false };
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

function applyProbabilityCaps(probability, prop = {}, { verified = false, confidence = null, edgePercent = null } = {}) {
  const conf = finiteOr(confidence ?? prop.displayConfidenceScore ?? computeAdjustedConfidence(prop), NaN);
  const edgePct = Math.abs(finiteOr(edgePercent ?? prop.edgePercent, 0));
  let cap = verified ? 92 : RESEARCH_MAX_PROBABILITY;

  if (edgePct >= 60) cap = Math.max(cap, 90);
  else if (edgePct >= 40) cap = Math.max(cap, 85);
  else if (edgePct >= 25) cap = Math.max(cap, 80);
  else if (edgePct >= 15) cap = Math.max(cap, 76);

  if (!canExceedConfidencePlusTen(prop, { verified }) && Number.isFinite(conf)) {
    const confBonus = verified
      ? edgePct >= 40
        ? 28
        : edgePct >= 20
          ? 22
          : edgePct >= 12
            ? 18
            : 15
      : edgePct >= 40
        ? 22
        : edgePct >= 20
          ? 15
          : 10;
    const confCap = conf + confBonus;
    cap = Math.min(cap, confCap);
  }

  if (!verified) {
    cap = Math.min(cap, RESEARCH_MAX_PROBABILITY);
  }

  if (!Number.isFinite(conf)) cap = Math.min(cap, 60);
  if (isResearchCandidate(prop, { confidence: conf }) && edgePct < 25) {
    cap = Math.min(cap, RESEARCH_MAX_PROBABILITY);
  }

  return clamp(round1(probability), 50, cap);
}

export function computeConservativeProbability(prop = {}, metrics = {}, options = {}) {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  if (projection == null || !Number.isFinite(line) || line <= 0) return null;

  const adjustedConfidence = options.confidence ?? computeAdjustedConfidence(prop);
  const edge = metrics.edge ?? computeStandardEdge(projection, line);
  const edgePercent = metrics.edgePercent ?? computeStandardEdgePercent(edge, line) ?? 0;
  const edgeStrength = Math.min(Math.abs(edgePercent) / 35, 1);

  const statSpecific = computeStatSpecificProbability(prop, projection, line);
  let probability =
    statSpecific ??
    50 + edgeStrength * 38;

  const dq = finiteOr(prop.dataQualityScore, 50);
  if (dq >= 80) probability += 3;

  const lean = resolveLeanFromEdge(edge, prop);
  const hit = finiteOr(prop.recentHitRate ?? prop.last5HitRate, NaN);
  if (Number.isFinite(hit)) {
    const supports =
      (lean === "Higher" && hit >= 0.55) || (lean === "Lower" && hit <= 0.45) || Math.abs(hit - 0.5) >= 0.08;
    if (supports) probability += 2;
  }

  if (hasMissingOpponentData(prop)) probability -= 5;
  if (isLowMatchupProp(prop)) probability -= 2;
  else if (hasMissingMatchupData(prop)) probability -= 5;
  if (hasMissingSportsbookComparison(prop)) probability -= 3;

  const vol = finiteOr(prop.volatility, NaN);
  if (Number.isFinite(vol) && vol >= 3) probability -= 5;

  if (prop.isFallbackProjection || prop.fallbackProfile || prop.sparseProfile || prop.lineOnlyData) {
    probability -= 10;
  }

  const verified = options.verified ?? false;
  return applyProbabilityCaps(probability, prop, {
    verified,
    confidence: adjustedConfidence,
    edgePercent,
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
  const probabilityScore = computeConservativeProbability(prop, base, {
    verified: false,
    confidence: adjustedConfidence,
  });
  return {
    ...base,
    ...edgeDisplay,
    probabilityScore,
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

  if (probability != null) {
    probability = applyProbabilityCaps(probability, prop, {
      verified: playable,
      confidence: adjustedConfidence,
      edgePercent: metrics.edgePercent ?? prop.edgePercent,
    });
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
