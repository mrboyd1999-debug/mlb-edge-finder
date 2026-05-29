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
import { compareVerifiedRankingPlays } from "./bestPlayRankingScore.js";

export const VERIFIED_TIER_A = { id: "A", minProbability: 65, minConfidence: 60, rank: 0 };
export const VERIFIED_TIER_B = { id: "B", minProbability: 60, minConfidence: 55, rank: 1 };
export const VERIFIED_TIER_C = { id: "C", minProbability: 55, minConfidence: 50, rank: 2 };

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
  return { probability, confidence };
}

export function classifyVerifiedTier(prop = {}) {
  const { probability, confidence } = resolveVerifiedMetrics(prop);
  if (!Number.isFinite(probability) || !Number.isFinite(confidence)) return null;
  if (probability >= VERIFIED_TIER_A.minProbability && confidence >= VERIFIED_TIER_A.minConfidence) {
    return VERIFIED_TIER_A.id;
  }
  if (probability >= VERIFIED_TIER_B.minProbability && confidence >= VERIFIED_TIER_B.minConfidence) {
    return VERIFIED_TIER_B.id;
  }
  if (probability >= VERIFIED_TIER_C.minProbability && confidence >= VERIFIED_TIER_C.minConfidence) {
    return VERIFIED_TIER_C.id;
  }
  return null;
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
  if (!Number.isFinite(probability) || probability < VERIFIED_TIER_C.minProbability) return false;
  if (!Number.isFinite(confidence) || confidence < VERIFIED_TIER_C.minConfidence) return false;
  return true;
}

export function auditVerificationFailure(prop = {}) {
  if (passesVerifiedTierFilter(prop)) return null;

  if (!passesMinimalBestPlaysFilter(prop)) return "failedProjection";
  if (resolvePropSport(prop) !== "MLB") return "failedProjection";
  if (!hasValidVerifiedProjection(prop)) return "failedProjection";

  const { probability, confidence } = resolveVerifiedMetrics(prop);

  if (!Number.isFinite(probability) || probability < VERIFIED_TIER_C.minProbability) {
    return "failedProbability";
  }
  if (!Number.isFinite(confidence) || confidence < VERIFIED_TIER_C.minConfidence) {
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
        probability: resolveVerifiedMetrics(prop).probability,
        confidence: resolveVerifiedMetrics(prop).confidence,
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

function tierRank(tierId) {
  if (tierId === "A") return 0;
  if (tierId === "B") return 1;
  if (tierId === "C") return 2;
  return 3;
}

export function compareVerifiedTierPlays(a = {}, b = {}) {
  const tierDiff = tierRank(a.verifiedTier) - tierRank(b.verifiedTier);
  if (tierDiff !== 0) return tierDiff;
  return compareVerifiedRankingPlays(a, b);
}

export function annotateVerifiedTier(prop = {}) {
  const tier = classifyVerifiedTier(prop);
  return {
    ...prop,
    verifiedTier: tier,
    verifiedTierLabel: tier ? `Tier ${tier}` : null,
    pickTierLabel: tier ? "Verified Play" : prop.pickTierLabel,
    verified: Boolean(tier),
    bestPlayPool: tier ? "verified" : prop.bestPlayPool,
  };
}

/**
 * Populate verified plays: Tier A first, then B, then C — never return empty when pool has candidates.
 */
export function selectVerifiedPlaysByTier(props = [], options = {}) {
  const max = options.max ?? VERIFIED_MAX_PLAYS;
  const min = options.min ?? VERIFIED_MIN_PLAYS;
  const sortFn = options.sortCompare ?? compareVerifiedTierPlays;

  const eligible = (props || [])
    .filter(passesVerifiedTierFilter)
    .map(annotateVerifiedTier)
    .sort(sortFn);

  const tierA = eligible.filter((p) => p.verifiedTier === "A");
  const tierB = eligible.filter((p) => p.verifiedTier === "B");
  const tierC = eligible.filter((p) => p.verifiedTier === "C");

  const seen = new Set();
  const picks = [];

  const pushUnique = (list) => {
    for (const prop of list) {
      if (picks.length >= max) break;
      const key = `${prop.playerName}|${prop.statType}|${prop.line}|${prop.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(prop);
    }
  };

  pushUnique(tierA);
  if (picks.length < min) pushUnique(tierB);
  if (picks.length < min) pushUnique(tierC);

  if (!picks.length && eligible.length) {
    pushUnique(eligible);
  }

  if (!picks.length && props.length) {
    const fallbackSort = options.fallbackSort;
    const fallbackPool = (props || []).filter(hasValidVerifiedProjection);
    if (fallbackSort) fallbackPool.sort(fallbackSort);
    pushUnique(
      fallbackPool.map((prop) =>
        annotateVerifiedTier({ ...prop, verifiedTier: VERIFIED_TIER_C.id, verifiedTierFallback: true })
      )
    );
  }

  return picks.slice(0, max);
}

export function selectTopByProbability(props = [], limit = BEST_PLAYS_ENGINE_SIZE) {
  const seen = new Set();
  const picks = [];
  const sorted = [...(props || [])].sort(
    (a, b) => Number(b.probabilityScore ?? b.verifiedProbability ?? 0) - Number(a.probabilityScore ?? a.verifiedProbability ?? 0)
  );
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
    picks.push(prop);
  }
  return picks;
}
