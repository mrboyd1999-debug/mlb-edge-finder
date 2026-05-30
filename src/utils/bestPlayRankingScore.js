/**
 * Top pick ranking — score, tier-aware selection, and ranking reasons.
 */

import { computePlayabilityScore } from "./propCalibration.js";

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export const NO_TIER_A_PLAYS_MESSAGE = "No Tier A Plays Today";

export function resolveRankingEdgePercent(prop = {}) {
  const direct = finite(prop.edgePercent, NaN);
  if (Number.isFinite(direct)) return Math.abs(direct);
  const edge = Math.abs(finite(prop.edge ?? prop.rawEdge, NaN));
  const line = finite(prop.line, NaN);
  if (!Number.isFinite(edge) || !Number.isFinite(line) || line <= 0) return 0;
  return Math.abs((edge / line) * 100);
}

export function resolveNormalizedEdgeScore(prop = {}) {
  return Math.min(resolveRankingEdgePercent(prop), 100);
}

export function resolvePlayabilityScore(prop = {}) {
  const existing = finite(prop.playabilityScore, NaN);
  if (Number.isFinite(existing)) return existing;
  const confidence = finite(
    prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence,
    50
  );
  return computePlayabilityScore(prop, confidence);
}

/** Top Pick Score = probability*0.4 + confidence*0.3 + playability*0.2 + edgeNorm*0.1 */
export function computeTopPickScore(prop = {}) {
  const probability = finite(prop.probabilityScore ?? prop.verifiedProbability, 0);
  const confidence = finite(
    prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence,
    0
  );
  const playability = resolvePlayabilityScore(prop);
  const edgeNorm = resolveNormalizedEdgeScore(prop);
  return probability * 0.4 + confidence * 0.3 + playability * 0.2 + edgeNorm * 0.1;
}

export const computeVerifiedRankingScore = computeTopPickScore;
export const computeWeightedBestPlayScore = computeTopPickScore;

export function compareTopPickScore(a = {}, b = {}) {
  return computeTopPickScore(b) - computeTopPickScore(a);
}

export const compareVerifiedRankingPlays = compareTopPickScore;
export const compareWeightedBestPlays = compareTopPickScore;

export function buildTopPickRankingReason(prop = {}, rank = 1) {
  const probability = Math.round(finite(prop.probabilityScore ?? prop.verifiedProbability, 0));
  const confidence = Math.round(
    finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence, 0)
  );
  const playability = Math.round(resolvePlayabilityScore(prop));
  const edge = Math.round(resolveRankingEdgePercent(prop));
  return `Rank #${rank} because: Probability: ${probability}% · Confidence: ${confidence}% · Playability: ${playability} · Edge: ${edge}%`;
}

export function annotateTopPickRankingFields(prop = {}, rank = null) {
  const score = computeTopPickScore(prop);
  const resolvedRank = rank ?? prop.topVerifiedRank ?? prop.topMlbPlayRank ?? 1;
  const rankingReason = buildTopPickRankingReason(prop, resolvedRank);
  return {
    ...prop,
    playabilityScore: resolvePlayabilityScore(prop),
    topPickScore: score,
    verifiedRankingScore: score,
    weightedBestPlayScore: score,
    rankingReason,
    topPickRankingReason: rankingReason,
    topVerifiedRank: prop.topVerifiedRank ?? resolvedRank,
  };
}

export function selectHighestTierAPlays(props = [], limit = 1) {
  return [...(props || [])]
    .filter((prop) => prop.verifiedTier === "A")
    .sort(compareTopPickScore)
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

export function selectTopVerifiedByScore(props = [], limit = 10) {
  return [...(props || [])]
    .sort(compareTopPickScore)
    .slice(0, limit)
    .map((prop, index) =>
      annotateTopPickRankingFields(
        {
          ...prop,
          topVerifiedRank: index + 1,
          bestPlayPool: prop.bestPlayPool || "top-verified",
        },
        index + 1
      )
    );
}
