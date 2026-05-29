/**
 * Phase 3 verified tier system — probability/confidence/playability gates for Verified Plays.
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
  resolvePlayabilityScore,
  selectHighestTierAPlays,
  NO_TIER_A_PLAYS_MESSAGE,
} from "./bestPlayRankingScore.js";

export { NO_TIER_A_PLAYS_MESSAGE };

export const VERIFIED_TIER_A = {
  id: "A",
  minProbability: 65,
  minConfidence: 70,
  minPlayability: 65,
  rank: 0,
};
export const VERIFIED_TIER_B = {
  id: "B",
  minConfidence: 60,
  minPlayability: 50,
  rank: 1,
};
export const VERIFIED_TIER_C = { id: "C", rank: 2 };

export const VERIFIED_BASE_MIN_PROBABILITY = 55;
export const VERIFIED_BASE_MIN_CONFIDENCE = 50;

export const VERIFIED_TIERS = [VERIFIED_TIER_A, VERIFIED_TIER_B, VERIFIED_TIER_C];

export const VERIFIED_MIN_PLAYS = 5;
export const VERIFIED_MAX_PLAYS = 15;
export const BEST_PLAYS_ENGINE_SIZE = 5;

export const VERIFICATION_AUDIT_KEYS = [
  "failedProjection",
  "failedProbability",
  "failedConfidence",
  "failedMatchup",
];

export function resolveVerifiedMetrics(prop = {}) {
  const probability = Number(prop.probabilityScore ?? prop.verifiedProbability);
  const confidence = Number(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence);
  const playability = resolvePlayabilityScore(prop);
  return { probability, confidence, playability };
}

export function classifyVerifiedTier(prop = {}) {
  const { probability, confidence, playability } = resolveVerifiedMetrics(prop);
  if (!Number.isFinite(probability) || !Number.isFinite(confidence) || !Number.isFinite(playability)) {
    return null;
  }
  if (probability < VERIFIED_BASE_MIN_PROBABILITY || confidence < VERIFIED_BASE_MIN_CONFIDENCE) {
    return null;
  }

  if (
    probability >= VERIFIED_TIER_A.minProbability &&
    confidence >= VERIFIED_TIER_A.minConfidence &&
    playability >= VERIFIED_TIER_A.minPlayability
  ) {
    return VERIFIED_TIER_A.id;
  }
  if (confidence >= VERIFIED_TIER_B.minConfidence && playability >= VERIFIED_TIER_B.minPlayability) {
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

export function auditVerificationFailure(prop = {}) {
  if (passesVerifiedTierFilter(prop)) return null;

  if (!passesMinimalBestPlaysFilter(prop)) return "failedProjection";
  if (resolvePropSport(prop) !== "MLB") return "failedProjection";
  if (!hasValidVerifiedProjection(prop)) return "failedProjection";

  const { probability, confidence, playability } = resolveVerifiedMetrics(prop);

  if (!Number.isFinite(probability) || probability < VERIFIED_BASE_MIN_PROBABILITY) {
    return "failedProbability";
  }
  if (!Number.isFinite(confidence) || confidence < VERIFIED_BASE_MIN_CONFIDENCE) {
    return "failedConfidence";
  }
  if (!Number.isFinite(playability) || playability < VERIFIED_TIER_B.minPlayability) {
    return "failedConfidence";
  }
  if (hasIncompleteSupportingData(prop)) return "failedMatchup";

  return "failedProbability";
}

export function summarizeVerificationAudit(props = []) {
  const breakdown = {
    failedProjection: 0,
    failedProbability: 0,
    failedConfidence: 0,
    failedMatchup: 0,
  };
  const samples = [];

  for (const prop of props || []) {
    if (passesVerifiedTierFilter(prop)) continue;
    const reason = auditVerificationFailure(prop) || "failedProbability";
    breakdown[reason] = (breakdown[reason] || 0) + 1;
    if (samples.length < 12) {
      samples.push({
        player: prop.playerName || prop.player,
        stat: prop.statType || prop.market,
        reason,
        ...resolveVerifiedMetrics(prop),
      });
    }
  }

  return { breakdown, samples, totalFailures: Object.values(breakdown).reduce((a, b) => a + b, 0) };
}

export function logVerificationAudit(props = []) {
  const audit = summarizeVerificationAudit(props);
  console.info("[MLB Pipeline] verification confidence audit", audit);
  return audit;
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

export { selectHighestTierAPlays };

export function selectTopByProbability(props = [], limit = BEST_PLAYS_ENGINE_SIZE) {
  const seen = new Set();
  const picks = [];
  const sorted = [...(props || [])]
    .map(annotateTopPickRankingFields)
    .sort(compareTopPickScore);
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
