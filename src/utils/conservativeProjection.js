/** Realistic probability, playability tiers, and lean helpers for MLB props. */

import { computeStandardEdge, computeStandardEdgePercent, computeStandardPropMetrics } from "./standardPropMetrics.js";

export const PICK_TIER_VERIFIED = "Verified Play";
export const PICK_TIER_RESEARCH = "Research Candidate";

const VERIFIED_MIN_CONFIDENCE = 75;
const VERIFIED_MIN_PROBABILITY = 65;
const VERIFIED_MIN_DATA_QUALITY = 75;

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

/** Research tier when any supporting input is incomplete. */
export function isResearchCandidate(prop = {}) {
  if (resolveProjectionValue(prop) == null) return true;
  if (!isConfidenceAvailable(prop)) return true;
  if (hasMissingMatchupData(prop)) return true;
  if (hasMissingOpponentData(prop)) return true;
  if (finiteOr(prop.dataQualityScore, 0) < VERIFIED_MIN_DATA_QUALITY) return true;
  if (hasMajorResearchGaps(prop)) return true;
  if (prop.projectionUnavailable || prop.isFallbackProjection) return true;
  return false;
}

export function isVerifiedPlay(prop = {}, { probability, confidence } = {}) {
  if (isResearchCandidate(prop)) return false;
  const prob = finiteOr(probability ?? prop.probabilityScore, NaN);
  const conf = finiteOr(confidence ?? prop.confidenceScore ?? prop.confidence, NaN);
  return (
    prob >= VERIFIED_MIN_PROBABILITY &&
    conf >= VERIFIED_MIN_CONFIDENCE &&
    isConfidenceAvailable(prop)
  );
}

export function resolveDisplayConfidence(prop = {}, tier = PICK_TIER_RESEARCH) {
  const raw = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
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
  if (!isConfidenceAvailable(prop)) reasons.push("Confidence inputs missing");
  if (hasMissingMatchupData(prop)) reasons.push("Matchup data missing");
  if (hasMissingOpponentData(prop)) reasons.push("Opponent data missing");
  if (finiteOr(prop.dataQualityScore, 0) < VERIFIED_MIN_DATA_QUALITY) {
    reasons.push(`Data quality ${Math.round(finiteOr(prop.dataQualityScore, 0))}% below 75`);
  }
  if (hasMajorResearchGaps(prop)) reasons.push("Research gaps");
  if (prop.projectionUnavailable || prop.isFallbackProjection) reasons.push("Projection incomplete");
  return reasons;
}

function applyProbabilityCaps(probability, prop = {}, { verified = false } = {}) {
  let cap = 78;
  if (verified) cap = 85;
  if (!isConfidenceAvailable(prop)) cap = Math.min(cap, 60);
  if (isResearchCandidate(prop)) cap = Math.min(cap, 70);
  else if (finiteOr(prop.dataQualityScore, 0) < VERIFIED_MIN_DATA_QUALITY) cap = Math.min(cap, 65);
  return clamp(Math.round(probability), 50, cap);
}

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

  if (hasMissingOpponentData(prop)) probability -= 5;
  if (hasMissingMatchupData(prop)) probability -= 3;
  if (!prop.sportsbookComparison && !prop.sportsbookBooksCount) probability -= 5;

  const vol = finiteOr(prop.volatility, NaN);
  if (Number.isFinite(vol) && vol >= 3) probability -= 7;

  if (prop.isFallbackProjection || prop.fallbackProfile || prop.sparseProfile || prop.lineOnlyData) {
    probability -= 10;
  }

  const verified = options.verified ?? isVerifiedPlay(prop, { probability });
  return applyProbabilityCaps(probability, prop, { verified });
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
  const probabilityScore = computeConservativeProbability(prop, base, {
    verified: false,
  });
  return {
    ...base,
    ...edgeDisplay,
    probabilityScore,
    lean: resolveLeanFromEdge(base.edge),
    projectionStatus: "ok",
  };
}

export function evaluateMlbPlayability(prop = {}, metrics = {}) {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  const rawConfidence = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);

  if (projection == null || !Number.isFinite(line) || line <= 0) {
    return {
      isDisplayPlayable: false,
      displayResearchOnly: true,
      bettingLabel: "Projection unavailable",
      cardStatus: "unavailable",
      whyNotPlayable: "Projection unavailable",
      pickTierLabel: PICK_TIER_RESEARCH,
      pickTierRank: 1,
      displayConfidenceScore: null,
      researchReasons: ["Projection missing"],
    };
  }

  const research = isResearchCandidate(prop);
  const tier = research ? PICK_TIER_RESEARCH : PICK_TIER_VERIFIED;
  let probability =
    metrics.probabilityScore ?? computeConservativeProbability(prop, metrics, { verified: !research });

  const verified = isVerifiedPlay(prop, { probability, confidence: rawConfidence });
  const playable = verified;

  if (probability != null) {
    probability = applyProbabilityCaps(probability, prop, { verified: playable });
  }

  const displayConfidenceScore = resolveDisplayConfidence(prop, tier);
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
    confidenceScore: displayConfidenceScore ?? rawConfidence,
    displayConfidenceScore,
    researchReasons,
    edgeDisplay: formatEdgeDisplay({ ...prop, ...metrics, line }),
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
  return isVerifiedPlay(prop, {
    probability: prop.probabilityScore,
    confidence: prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence,
  });
}

export function highestProbabilityLabel(prop = {}) {
  return qualifiesAsHighestProbabilityPick(prop) ? "Highest Probability Pick" : "Top Research Candidate";
}
