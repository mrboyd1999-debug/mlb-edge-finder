/**
 * Verified tier system — strict probability, confidence, playability, and sanity gates.
 */

import {
  passesMinimalBestPlaysFilter,
  resolveBestPlayStatSpecificProjection,
  sanitizeProjectionValue,
  VERIFIED_MIN_PROJECTION,
} from "./bestPlaysPipelineDebug.js";
import { passesMlbProjectionFormulaValidation } from "./mlbProjectionFormulaAudit.js";
import { hasMajorResearchGaps, isLowMatchupProp } from "./conservativeProjection.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import {
  annotateTopPickRankingFields,
  compareTopPickScore,
  compareVerifiedPlaysRank,
  computeTopPickScore,
  resolvePlayabilityScore,
  NO_TIER_A_PLAYS_MESSAGE,
  NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE,
  passesHeroOverallPlayGate,
  passesTopVerifiedPlaysGate,
} from "./bestPlayRankingScore.js";
import {
  TIER_A_MIN_SANITY_SCORE,
  TIER_B_MIN_SANITY_SCORE,
  TIER_C_MIN_SANITY_SCORE,
  capTierToMaximum,
  resolveHistoricalDataPresent,
  resolveHitRateValidationPresent,
  resolveMaximumTier,
} from "./tierHistoricalValidation.js";

export { NO_TIER_A_PLAYS_MESSAGE, NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE };
export {
  passesTopVerifiedPlaysGate,
  passesHeroOverallPlayGate,
  compareVerifiedPlaysRank,
  isResearchOnlyProp,
} from "./bestPlayRankingScore.js";

export const VERIFIED_TIER_A = {
  id: "A",
  minProbability: 65,
  minConfidence: 65,
  minPlayability: 65,
  minSanity: TIER_A_MIN_SANITY_SCORE,
  rank: 0,
};
export const VERIFIED_TIER_B = {
  id: "B",
  minProbability: 58,
  minPlayability: 45,
  minSanity: TIER_B_MIN_SANITY_SCORE,
  rank: 1,
};
export const VERIFIED_TIER_C = {
  id: "C",
  minSanity: TIER_C_MIN_SANITY_SCORE,
  rank: 2,
};
export const VERIFIED_TIER_D = {
  id: "D",
  minSanity: TIER_C_MIN_SANITY_SCORE,
  rank: 3,
  label: "Research",
};

export const VERIFIED_BASE_MIN_PROBABILITY = 45;
export const VERIFIED_BASE_MIN_CONFIDENCE = 50;
export const VERIFIED_MIN_DATA_QUALITY = 50;

export const VERIFIED_TIERS = [VERIFIED_TIER_A, VERIFIED_TIER_B, VERIFIED_TIER_C, VERIFIED_TIER_D];

export const VERIFIED_MIN_PLAYS = 5;
export const VERIFIED_MAX_PLAYS = 10;
export const VERIFIED_FALLBACK_MAX = 10;
export const VERIFIED_DISPLAY_MAX = 10;
export const BEST_PLAYS_ENGINE_SIZE = 5;
export const TOP_PICK_SCORE_AUDIT_SIZE = 20;

export const VERIFICATION_AUDIT_KEYS = [
  "failedProjection",
  "failedProbability",
  "failedConfidence",
  "failedMatchup",
  "failedDataQuality",
  "failedPlayability",
  "failedHistoricalData",
];

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveSanityScore(prop = {}) {
  return finite(prop.projectionSanityScore ?? prop.projectionSanityAudit?.sanityScore);
}

function qualifiesTierA({ probability, confidence, playability, sanity, historicalPresent, hitRateValidated, audit }) {
  if (!historicalPresent) return false;
  if (!hitRateValidated) return false;
  if (audit?.blocksTierA) return false;
  if (sanity == null || sanity < VERIFIED_TIER_A.minSanity) return false;
  return (
    probability >= VERIFIED_TIER_A.minProbability &&
    confidence >= VERIFIED_TIER_A.minConfidence &&
    playability >= VERIFIED_TIER_A.minPlayability
  );
}

function qualifiesTierB({ probability, playability, sanity, audit }) {
  if (audit?.sanityFail) return false;
  if (sanity != null && sanity < TIER_B_MIN_SANITY_SCORE) return false;
  return probability >= VERIFIED_TIER_B.minProbability && playability >= VERIFIED_TIER_B.minPlayability;
}

function qualifiesTierC({ sanity, audit }) {
  if (audit?.sanityFail) return false;
  if (sanity == null) return true;
  return sanity >= TIER_C_MIN_SANITY_SCORE;
}

export function resolveVerifiedMetrics(prop = {}) {
  const probability = Number(prop.probabilityScore ?? prop.verifiedProbability);
  const confidence = Number(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence);
  const playability = resolvePlayabilityScore(prop);
  const dataQuality = Number(prop.dataQualityScore);
  const sanity = resolveSanityScore(prop);
  const historical = resolveHistoricalDataPresent(prop);
  const hitRates = resolveHitRateValidationPresent(prop);
  return {
    probability,
    confidence,
    playability,
    dataQuality,
    sanity,
    historicalPresent: historical.present,
    historicalMissing: historical.missingLabels,
    hitRateValidated: hitRates.present,
    hitRateMissing: hitRates.missingLabels,
  };
}

export function passesTierAGates(prop = {}) {
  return classifyVerifiedTier(prop) === VERIFIED_TIER_A.id;
}

export function enforceVerifiedTierFields(prop = {}) {
  const playabilityScore = resolvePlayabilityScore(prop);
  const tier = classifyVerifiedTier({ ...prop, playabilityScore });
  const historical = resolveHistoricalDataPresent(prop);
  return {
    ...prop,
    playabilityScore,
    verifiedTier: tier,
    verifiedTierLabel: tier ? `Tier ${tier}` : null,
    historicalDataPresent: historical.present,
    hitRateValidated: resolveHitRateValidationPresent(prop).present,
  };
}

export function classifyVerifiedTier(prop = {}) {
  const { probability, confidence, playability, sanity } = resolveVerifiedMetrics(prop);
  const historical = resolveHistoricalDataPresent(prop);
  const hitRates = resolveHitRateValidationPresent(prop);
  const audit = prop.projectionSanityAudit || null;

  if (audit?.sanityFail) return null;
  if (!Number.isFinite(probability) || !Number.isFinite(confidence)) return null;
  if (probability < VERIFIED_BASE_MIN_PROBABILITY || confidence < VERIFIED_BASE_MIN_CONFIDENCE) {
    return null;
  }
  if (!Number.isFinite(playability)) return null;
  if (sanity != null && sanity < TIER_C_MIN_SANITY_SCORE) return null;

  let tier = null;

  if (qualifiesTierC({ sanity, audit })) {
    tier = VERIFIED_TIER_C.id;
  }

  if (qualifiesTierB({ probability, playability, sanity, audit })) {
    tier = VERIFIED_TIER_B.id;
  }

  if (
    qualifiesTierA({
      probability,
      confidence,
      playability,
      sanity,
      historicalPresent: historical.present,
      hitRateValidated: hitRates.present,
      audit,
    })
  ) {
    tier = VERIFIED_TIER_A.id;
  }

  const maximumTier = resolveMaximumTier({
    playability,
    sanityFail: audit?.sanityFail,
  });
  tier = capTierToMaximum(tier, maximumTier);
  if (!tier && qualifiesTierC({ sanity, audit })) {
    tier = VERIFIED_TIER_D.id;
  }
  return tier;
}

export function hasIncompleteSupportingData(prop = {}) {
  return (
    isLowMatchupProp(prop) ||
    hasMajorResearchGaps(prop) ||
    prop.projectionUnavailable ||
    prop.isFallbackProjection ||
    prop.unverifiedGradeBlocked
  );
}

export function hasValidVerifiedProjection(prop = {}) {
  const projection = resolveBestPlayStatSpecificProjection(prop);
  if (projection == null || projection <= VERIFIED_MIN_PROJECTION) return false;
  if (prop.projectionUnavailable || prop.unverifiedGradeBlocked || prop.isFallbackProjection) return false;
  if (prop.projectionFormulaError || prop.projectionFormulaValid === false) return false;
  if (!passesMlbProjectionFormulaValidation(prop)) return false;
  return true;
}

export function passesVerifiedTierFilter(prop = {}) {
  if (!passesMinimalBestPlaysFilter(prop)) return false;
  if (resolvePropSport(prop) !== "MLB") return false;
  if (!hasValidVerifiedProjection(prop)) return false;
  return classifyVerifiedTier(prop) != null;
}

export function passesResearchTierFilter(prop = {}) {
  if (passesVerifiedTierFilter(prop)) return false;
  if (!passesMinimalBestPlaysFilter(prop)) return false;
  if (resolvePropSport(prop) !== "MLB") return false;
  if (!hasValidVerifiedProjection(prop)) return false;
  if (!hasIncompleteSupportingData(prop)) return false;

  const { probability, confidence } = resolveVerifiedMetrics(prop);
  if (!Number.isFinite(probability) || probability < VERIFIED_BASE_MIN_PROBABILITY) return false;
  if (!Number.isFinite(confidence) || confidence < VERIFIED_BASE_MIN_CONFIDENCE) return false;
  return true;
}

export function explainVerificationRejection(prop = {}) {
  if (!passesMinimalBestPlaysFilter(prop)) return "missing player, line, or stat type";
  if (resolvePropSport(prop) !== "MLB") return "non-MLB sport";
  if (!hasValidVerifiedProjection(prop)) return "missing or invalid stat-specific projection";
  if (prop.projectionFormulaError || prop.projectionFormulaValid === false) {
    return prop.projectionFormulaErrorReason || "projection formula validation failed";
  }

  const { probability, confidence, playability, dataQuality, sanity, historicalPresent, historicalMissing, hitRateValidated, hitRateMissing } =
    resolveVerifiedMetrics(prop);

  if (!Number.isFinite(probability)) return "probability missing";
  if (probability < VERIFIED_BASE_MIN_PROBABILITY) {
    return `probability ${Math.round(probability)}% below Tier C minimum ${VERIFIED_BASE_MIN_PROBABILITY}%`;
  }
  if (!Number.isFinite(confidence)) return "confidence missing";
  if (confidence < VERIFIED_BASE_MIN_CONFIDENCE) {
    return `confidence ${Math.round(confidence)}% below Tier C minimum ${VERIFIED_BASE_MIN_CONFIDENCE}%`;
  }
  if (!Number.isFinite(playability)) return "playability score unavailable";
  if (prop.projectionSanityAudit?.sanityFail || prop.projectionSanityFail) {
    return "projection sanity blocked";
  }
  if (sanity != null && sanity < TIER_C_MIN_SANITY_SCORE) {
    return `sanity ${sanity} below Tier C minimum ${TIER_C_MIN_SANITY_SCORE}`;
  }
  if (playability < 40) return `playability ${Math.round(playability)}% caps tier at C (max)`;
  if (playability < VERIFIED_TIER_B.minPlayability) {
    return `playability ${Math.round(playability)}% below Tier B minimum ${VERIFIED_TIER_B.minPlayability}% (max tier B)`;
  }
  if (!historicalPresent) {
    return `historical data incomplete (${(historicalMissing ?? []).join(", ") || "Last5/Last10/Season"}) — Tier A blocked, informational only`;
  }
  if (!hitRateValidated) {
    return `hit-rate validation missing (${(hitRateMissing ?? []).join(", ") || "Last5/Last10/Season"}) — Tier A blocked`;
  }
  if (Number.isFinite(dataQuality) && dataQuality < VERIFIED_MIN_DATA_QUALITY) {
    return `data quality ${Math.round(dataQuality)}% below ${VERIFIED_MIN_DATA_QUALITY}%`;
  }
  if (hasIncompleteSupportingData(prop)) return "incomplete matchup or supporting data";
  if (probability < VERIFIED_TIER_B.minProbability) {
    return `probability ${Math.round(probability)}% below Tier B minimum ${VERIFIED_TIER_B.minProbability}%`;
  }
  if (
    probability < VERIFIED_TIER_A.minProbability ||
    confidence < VERIFIED_TIER_A.minConfidence ||
    playability < VERIFIED_TIER_A.minPlayability
  ) {
    return `below Tier A thresholds (prob ${VERIFIED_TIER_A.minProbability}% / conf ${VERIFIED_TIER_A.minConfidence}% / play ${VERIFIED_TIER_A.minPlayability}%)`;
  }
  if (sanity == null || sanity < VERIFIED_TIER_A.minSanity) {
    return `sanity ${sanity ?? "—"} below Tier A minimum ${VERIFIED_TIER_A.minSanity}`;
  }
  return "eligible under current tier rules";
}

export function auditVerificationFailure(prop = {}) {
  if (passesVerifiedTierFilter(prop)) return null;

  if (!passesMinimalBestPlaysFilter(prop)) return "failedProjection";
  if (resolvePropSport(prop) !== "MLB") return "failedProjection";
  if (!hasValidVerifiedProjection(prop)) return "failedProjection";

  const { probability, confidence, playability, dataQuality, sanity } = resolveVerifiedMetrics(prop);

  if (!Number.isFinite(probability) || probability < VERIFIED_BASE_MIN_PROBABILITY) {
    return "failedProbability";
  }
  if (!Number.isFinite(confidence) || confidence < VERIFIED_BASE_MIN_CONFIDENCE) {
    return "failedConfidence";
  }
  if (
    !Number.isFinite(playability) ||
    playability < VERIFIED_TIER_B.minPlayability ||
    prop.projectionSanityAudit?.sanityFail ||
    prop.projectionSanityFail ||
    (sanity != null && sanity < TIER_C_MIN_SANITY_SCORE)
  ) {
    return "failedPlayability";
  }
  if (Number.isFinite(dataQuality) && dataQuality < VERIFIED_MIN_DATA_QUALITY) {
    return "failedDataQuality";
  }
  if (hasIncompleteSupportingData(prop)) return "failedMatchup";

  return "failedProbability";
}

function emptyBreakdown() {
  return {
    failedProjection: 0,
    failedProbability: 0,
    failedConfidence: 0,
    failedMatchup: 0,
    failedDataQuality: 0,
    failedPlayability: 0,
    failedHistoricalData: 0,
  };
}

export function summarizeVerificationAudit(props = []) {
  const breakdown = emptyBreakdown();
  const samples = [];
  const regressionReasons = {};

  for (const prop of props || []) {
    if (passesVerifiedTierFilter(prop)) continue;
    const reason = auditVerificationFailure(prop) || "failedProbability";
    const detail = explainVerificationRejection(prop);
    breakdown[reason] = (breakdown[reason] || 0) + 1;
    regressionReasons[detail] = (regressionReasons[detail] || 0) + 1;
    if (samples.length < 20) {
      samples.push({
        player: prop.playerName || prop.player,
        stat: prop.statType || prop.market,
        reason,
        detail,
        ...resolveVerifiedMetrics(prop),
        tier: classifyVerifiedTier(prop),
      });
    }
  }

  breakdown.failedDataQuality = (props || []).filter((prop) => {
    const { dataQuality } = resolveVerifiedMetrics(prop);
    return Number.isFinite(dataQuality) && dataQuality < VERIFIED_MIN_DATA_QUALITY;
  }).length;

  return {
    breakdown,
    samples,
    regressionReasons,
    totalFailures:
      breakdown.failedProjection +
      breakdown.failedProbability +
      breakdown.failedConfidence +
      breakdown.failedMatchup +
      breakdown.failedPlayability +
      breakdown.failedHistoricalData,
  };
}

export function logVerificationAudit(props = []) {
  const audit = summarizeVerificationAudit(props);
  console.info("[MLB Pipeline] verification confidence audit", audit);
  return audit;
}

export function logTopPickScoreAudit(props = [], limit = TOP_PICK_SCORE_AUDIT_SIZE) {
  const rows = [...(props || [])]
    .filter((prop) => hasValidVerifiedProjection(prop) || resolveBestPlayStatSpecificProjection(prop))
    .map((prop) => {
      const annotated = annotateTopPickRankingFields(prop);
      return {
        player: annotated.playerName || annotated.player,
        stat: annotated.statType || annotated.market,
        probability: Math.round(Number(annotated.probabilityScore ?? 0)),
        confidence: Math.round(
          Number(annotated.displayConfidenceScore ?? annotated.confidenceScore ?? 0)
        ),
        playability: Math.round(Number(annotated.playabilityScore ?? 0)),
        sanity: annotated.projectionSanityScore ?? annotated.projectionSanityAudit?.sanityScore ?? "—",
        score: Number(annotated.topPickScore ?? computeTopPickScore(annotated)).toFixed(1),
        tier: classifyVerifiedTier(annotated),
        rejection: explainVerificationRejection(annotated),
      };
    })
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, limit);

  console.info("[MLB Pipeline] top pick score audit (top 20)", rows);
  return rows;
}

export function logVerificationRegressionAudit(props = []) {
  const audit = summarizeVerificationAudit(props);
  const projected = (props || []).filter((prop) => {
    const projection = resolveBestPlayStatSpecificProjection(prop);
    return projection != null && projection > 0;
  });
  const wouldPassOldProbConf = projected.filter((prop) => {
    const { probability, confidence } = resolveVerifiedMetrics(prop);
    return (
      Number.isFinite(probability) &&
      Number.isFinite(confidence) &&
      probability >= VERIFIED_BASE_MIN_PROBABILITY &&
      confidence >= VERIFIED_BASE_MIN_CONFIDENCE
    );
  }).length;
  const currentlyVerified = projected.filter(passesVerifiedTierFilter).length;

  console.info("[MLB Pipeline] verification regression audit", {
    projected: projected.length,
    currentlyVerified,
    tierFloorProbability: VERIFIED_BASE_MIN_PROBABILITY,
    tierFloorConfidence: VERIFIED_BASE_MIN_CONFIDENCE,
    wouldPassProbConfFloor: wouldPassOldProbConf,
    removedByStrictPlayabilityGate: audit.regressionReasons,
    failureBreakdown: audit.breakdown,
    sampleRejections: audit.samples.slice(0, 12),
  });

  return {
    projected: projected.length,
    currentlyVerified,
    wouldPassProbConfFloor: wouldPassOldProbConf,
    regressionReasons: audit.regressionReasons,
    failureBreakdown: audit.breakdown,
    samples: audit.samples,
  };
}

export function compareVerifiedTierPlays(a = {}, b = {}) {
  return compareVerifiedPlaysRank(a, b);
}

export function annotateVerifiedTier(prop = {}) {
  return annotateTopPickRankingFields(
    enforceVerifiedTierFields({
      ...prop,
      pickTierLabel: classifyVerifiedTier(prop) ? "Verified Play" : prop.pickTierLabel,
      verified: Boolean(classifyVerifiedTier(prop)),
      bestPlayPool: classifyVerifiedTier(prop) ? "verified" : prop.bestPlayPool,
    })
  );
}

export function selectVerifiedPlaysByTier(props = [], options = {}) {
  const max = options.max ?? VERIFIED_MAX_PLAYS;
  const eligible = (props || [])
    .filter(passesVerifiedTierFilter)
    .map(annotateVerifiedTier)
    .sort(compareVerifiedPlaysRank);

  const preferred = eligible.filter((prop) => ["A", "B", "C", "D"].includes(prop.verifiedTier));
  const pool = preferred.length ? preferred : eligible;
  return pool.slice(0, max);
}

export function countVerifiedTierDistribution(props = []) {
  const counts = { tierA: 0, tierB: 0, tierC: 0, tierD: 0, unclassified: 0 };
  for (const prop of props || []) {
    const tier = prop.verifiedTier || classifyVerifiedTier(prop);
    if (tier === "A") counts.tierA += 1;
    else if (tier === "B") counts.tierB += 1;
    else if (tier === "C") counts.tierC += 1;
    else if (tier === "D") counts.tierD += 1;
    else counts.unclassified += 1;
  }
  return counts;
}

export function selectVerifiedPlaysWithFallback(props = [], options = {}) {
  const picks = selectVerifiedPlaysByTier(props, options);
  if (picks.length) return { picks, usedFallback: false };

  const fallback = [...(props || [])]
    .filter((prop) => {
      const projection = resolveBestPlayStatSpecificProjection(prop);
      if (projection == null || projection <= 0) return false;
      const { probability, confidence } = resolveVerifiedMetrics(prop);
      return (
        Number.isFinite(probability) &&
        Number.isFinite(confidence) &&
        probability >= VERIFIED_BASE_MIN_PROBABILITY &&
        confidence >= VERIFIED_BASE_MIN_CONFIDENCE
      );
    })
    .map(annotateVerifiedTier)
    .sort(compareVerifiedPlaysRank)
    .slice(0, options.max ?? VERIFIED_MAX_PLAYS);

  return { picks: fallback, usedFallback: fallback.length > 0 };
}

export function selectHeroOverallPlay(props = [], limit = 1) {
  return [...(props || [])]
    .filter(passesHeroOverallPlayGate)
    .map((prop) => enforceVerifiedTierFields(prop))
    .sort(compareVerifiedPlaysRank)
    .slice(0, limit)
    .map((prop, index) =>
      annotateTopPickRankingFields(
        {
          ...prop,
          topVerifiedRank: index + 1,
          isHighestProbabilityPick: true,
          bestPlayPool: "highest-probability",
        },
        index + 1
      )
    );
}

/** @deprecated Use selectHeroOverallPlay — hero gates replaced Tier-A-only selection. */
export function selectHighestTierAPlays(props = [], limit = 1) {
  return selectHeroOverallPlay(props, limit);
}

export function selectTopByProbability(props = [], limit = BEST_PLAYS_ENGINE_SIZE) {
  const seen = new Set();
  const picks = [];
  const sorted = [...(props || [])].map(annotateTopPickRankingFields).sort(compareTopPickScore);
  for (const prop of sorted) {
    if (picks.length >= limit) break;
    const key = `${prop.playerName}|${prop.statType}|${prop.line}|${prop.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(prop);
  }
  return picks;
}

export function selectTopByEdge(props = [], limit = BEST_PLAYS_ENGINE_SIZE, resolveEdge = () => 0) {
  const seen = new Set();
  const picks = [];
  const sorted = [...(props || [])].sort((a, b) => resolveEdge(b) - resolveEdge(a));
  for (const prop of sorted) {
    if (picks.length >= limit) break;
    const key = `${prop.playerName}|${prop.statType}|${prop.line}|${prop.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(annotateTopPickRankingFields(prop));
  }
  return picks;
}
