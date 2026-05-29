/**
 * Phase 3 verified tier system — probability/confidence gates for Verified Plays.
 */

import {
  passesMinimalBestPlaysFilter,
  resolveBestPlayStatSpecificProjection,
  VERIFIED_MIN_PROJECTION,
} from "./bestPlaysPipelineDebug.js";
import { hasMajorResearchGaps, isLowMatchupProp } from "./conservativeProjection.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import {
  annotateTopPickRankingFields,
  compareTopPickScore,
  computeTopPickScore,
  resolvePlayabilityScore,
  selectHighestTierAPlays,
  NO_TIER_A_PLAYS_MESSAGE,
} from "./bestPlayRankingScore.js";

export { NO_TIER_A_PLAYS_MESSAGE };

/** Temporary stabilization thresholds — playability used in score only, not tier gates. */
export const VERIFIED_TIER_A = {
  id: "A",
  minProbability: 65,
  minConfidence: 60,
  rank: 0,
};
export const VERIFIED_TIER_B = {
  id: "B",
  minProbability: 60,
  minConfidence: 55,
  rank: 1,
};
export const VERIFIED_TIER_C = {
  id: "C",
  minProbability: 55,
  minConfidence: 50,
  rank: 2,
};

export const VERIFIED_BASE_MIN_PROBABILITY = VERIFIED_TIER_C.minProbability;
export const VERIFIED_BASE_MIN_CONFIDENCE = VERIFIED_TIER_C.minConfidence;
export const VERIFIED_MIN_DATA_QUALITY = 50;

export const VERIFIED_TIERS = [VERIFIED_TIER_A, VERIFIED_TIER_B, VERIFIED_TIER_C];

export const VERIFIED_MIN_PLAYS = 5;
export const VERIFIED_MAX_PLAYS = 15;
export const VERIFIED_FALLBACK_MAX = 10;
export const BEST_PLAYS_ENGINE_SIZE = 5;
export const TOP_PICK_SCORE_AUDIT_SIZE = 20;

export const VERIFICATION_AUDIT_KEYS = [
  "failedProjection",
  "failedProbability",
  "failedConfidence",
  "failedMatchup",
  "failedDataQuality",
];

export function resolveVerifiedMetrics(prop = {}) {
  const probability = Number(prop.probabilityScore ?? prop.verifiedProbability);
  const confidence = Number(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence);
  const playability = resolvePlayabilityScore(prop);
  const dataQuality = Number(prop.dataQualityScore);
  return { probability, confidence, playability, dataQuality };
}

export function classifyVerifiedTier(prop = {}) {
  const { probability, confidence } = resolveVerifiedMetrics(prop);
  if (!Number.isFinite(probability) || !Number.isFinite(confidence)) return null;
  if (probability < VERIFIED_BASE_MIN_PROBABILITY || confidence < VERIFIED_BASE_MIN_CONFIDENCE) {
    return null;
  }

  if (probability >= VERIFIED_TIER_A.minProbability && confidence >= VERIFIED_TIER_A.minConfidence) {
    return VERIFIED_TIER_A.id;
  }
  if (probability >= VERIFIED_TIER_B.minProbability && confidence >= VERIFIED_TIER_B.minConfidence) {
    return VERIFIED_TIER_B.id;
  }
  return VERIFIED_TIER_C.id;
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
  return true;
}

/** Strong enough to recommend — tier A/B/C with valid stat-specific projection. */
export function passesVerifiedTierFilter(prop = {}) {
  if (!passesMinimalBestPlaysFilter(prop)) return false;
  if (resolvePropSport(prop) !== "MLB") return false;
  if (!hasValidVerifiedProjection(prop)) return false;
  return classifyVerifiedTier(prop) != null;
}

/** Missing matchup or incomplete supporting data — not tier-qualified verified. */
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

  const { probability, confidence, playability, dataQuality } = resolveVerifiedMetrics(prop);

  if (!Number.isFinite(probability)) return "probability missing";
  if (probability < VERIFIED_BASE_MIN_PROBABILITY) {
    return `probability ${Math.round(probability)}% below Tier C minimum ${VERIFIED_BASE_MIN_PROBABILITY}%`;
  }
  if (!Number.isFinite(confidence)) return "confidence missing";
  if (confidence < VERIFIED_BASE_MIN_CONFIDENCE) {
    return `confidence ${Math.round(confidence)}% below Tier C minimum ${VERIFIED_BASE_MIN_CONFIDENCE}%`;
  }
  if (Number.isFinite(dataQuality) && dataQuality < VERIFIED_MIN_DATA_QUALITY) {
    return `data quality ${Math.round(dataQuality)}% below ${VERIFIED_MIN_DATA_QUALITY}%`;
  }
  if (hasIncompleteSupportingData(prop)) return "incomplete matchup or supporting data";
  if (!Number.isFinite(playability)) return "playability score unavailable (not a tier gate)";
  if (playability < 50) {
    return `strict playability gate would reject (${Math.round(playability)} < 50) — tier uses prob/conf only`;
  }
  return "eligible under current prob/conf tiers";
}

export function auditVerificationFailure(prop = {}) {
  if (passesVerifiedTierFilter(prop)) return null;

  if (!passesMinimalBestPlaysFilter(prop)) return "failedProjection";
  if (resolvePropSport(prop) !== "MLB") return "failedProjection";
  if (!hasValidVerifiedProjection(prop)) return "failedProjection";

  const { probability, confidence, dataQuality } = resolveVerifiedMetrics(prop);

  if (!Number.isFinite(probability) || probability < VERIFIED_BASE_MIN_PROBABILITY) {
    return "failedProbability";
  }
  if (!Number.isFinite(confidence) || confidence < VERIFIED_BASE_MIN_CONFIDENCE) {
    return "failedConfidence";
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
      breakdown.failedMatchup,
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
  return compareTopPickScore(a, b);
}

export function annotateVerifiedTier(prop = {}) {
  const tier = classifyVerifiedTier(prop);
  return annotateTopPickRankingFields({
    ...prop,
    verifiedTier: tier,
    verifiedTierLabel: tier ? `Tier ${tier}` : null,
    pickTierLabel: tier ? "Verified Play" : prop.pickTierLabel,
    verified: Boolean(tier),
    bestPlayPool: tier ? "verified" : prop.bestPlayPool,
  });
}

/** Verified plays sorted by top pick score descending. */
export function selectVerifiedPlaysByTier(props = [], options = {}) {
  const max = options.max ?? VERIFIED_MAX_PLAYS;
  const eligible = (props || [])
    .filter(passesVerifiedTierFilter)
    .map(annotateVerifiedTier)
    .sort(compareTopPickScore);

  return eligible.slice(0, max);
}

/** Never return empty — promote top projected props by score when tier filter yields zero. */
export function selectVerifiedPlaysWithFallback(props = [], options = {}) {
  const max = options.max ?? VERIFIED_MAX_PLAYS;
  const fallbackMax = options.fallbackMax ?? VERIFIED_FALLBACK_MAX;
  let picks = selectVerifiedPlaysByTier(props, { max });
  let usedFallback = false;

  if (!picks.length && (props || []).length) {
    picks = [...props]
      .filter(
        (prop) =>
          passesMinimalBestPlaysFilter(prop) &&
          resolvePropSport(prop) === "MLB" &&
          hasValidVerifiedProjection(prop)
      )
      .map((prop) =>
        annotateTopPickRankingFields(
          annotateVerifiedTier({
            ...prop,
            verifiedTier: classifyVerifiedTier(prop) || VERIFIED_TIER_C.id,
            verifiedTierFallback: true,
            verified: true,
            pickTierLabel: "Verified Play",
            bestPlayPool: "verified",
          })
        )
      )
      .sort(compareTopPickScore)
      .slice(0, fallbackMax);
    usedFallback = picks.length > 0;
    if (usedFallback) {
      console.info("[MLB Pipeline] verified fallback promoted top projected props", {
        count: picks.length,
      });
    }
  }

  return { picks, usedFallback };
}

export { selectHighestTierAPlays };

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
