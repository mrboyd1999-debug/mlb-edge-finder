/**
 * Verified play ranking score — Probability * 0.5 + Confidence * 0.3 + Edge% * 0.2
 */

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function resolveRankingEdgePercent(prop = {}) {
  const direct = finite(prop.edgePercent, NaN);
  if (Number.isFinite(direct)) return Math.abs(direct);
  const edge = Math.abs(finite(prop.edge ?? prop.rawEdge, NaN));
  const line = finite(prop.line, NaN);
  if (!Number.isFinite(edge) || !Number.isFinite(line) || line <= 0) return 0;
  return Math.abs((edge / line) * 100);
}

export function computeVerifiedRankingScore(prop = {}) {
  const probability = finite(prop.probabilityScore ?? prop.verifiedProbability, 0);
  const confidence = finite(
    prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence,
    0
  );
  const edge = resolveRankingEdgePercent(prop);
  return probability * 0.5 + confidence * 0.3 + edge * 0.2;
}

export function compareVerifiedRankingPlays(a = {}, b = {}) {
  return computeVerifiedRankingScore(b) - computeVerifiedRankingScore(a);
}

export function computeWeightedBestPlayScore(prop = {}) {
  return computeVerifiedRankingScore(prop);
}

export function compareWeightedBestPlays(a = {}, b = {}) {
  return compareVerifiedRankingPlays(a, b);
}
