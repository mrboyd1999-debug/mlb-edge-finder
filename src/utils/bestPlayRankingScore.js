/**
 * Top pick ranking — score, tier-aware selection, and ranking reasons.
 */

import { computePlayabilityScore } from "./propCalibration.js";

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export const NO_TIER_A_PLAYS_MESSAGE = "No Tier A Plays Today";
export const NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE = "No high-quality verified plays yet";

export const TOP_VERIFIED_MIN_PLAYABILITY = 45;
export const TOP_VERIFIED_MIN_CONFIDENCE = 50;
export const HERO_MIN_PROBABILITY = 60;
export const HERO_MIN_CONFIDENCE = 60;
export const HERO_MIN_PLAYABILITY = 60;
export const HERO_MIN_SANITY = 65;

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
  const breakdown = prop.playabilityBreakdown ?? prop.playabilityAudit;
  if (breakdown?.weightedRaw != null && Number.isFinite(Number(breakdown.weightedRaw))) {
    return Number(breakdown.weightedRaw);
  }
  if (breakdown?.finalPlayability != null && Number.isFinite(Number(breakdown.finalPlayability))) {
    return Number(breakdown.finalPlayability);
  }
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
  const score = probability * 0.4 + confidence * 0.3 + playability * 0.2 + edgeNorm * 0.1;
  return Math.round(score * 100) / 100;
}

export const computeVerifiedRankingScore = computeTopPickScore;
export const computeWeightedBestPlayScore = computeTopPickScore;

export function compareTopPickScore(a = {}, b = {}) {
  return computeTopPickScore(b) - computeTopPickScore(a);
}

export function resolveSanityScore(prop = {}) {
  const num = Number(prop.projectionSanityScore ?? prop.projectionSanityAudit?.sanityScore);
  return Number.isFinite(num) ? num : null;
}

export function isResearchOnlyProp(prop = {}) {
  if (prop.verifiedTierFallback || prop.verifiedFallbackPick) return true;
  const label = String(prop.pickTierLabel || prop.bettingLabel || "").trim();
  if (/research only/i.test(label)) return true;
  if (prop.bestPlayPool === "research") return true;
  if (prop.projectionSanityAudit?.sanityFail || prop.projectionSanityFail) return true;
  if (prop.projectionFormulaError || prop.projectionFormulaValid === false) return true;
  return Boolean(prop.displayResearchOnly && !prop.verifiedTier);
}

export function passesTopVerifiedPlaysGate(prop = {}) {
  if (isResearchOnlyProp(prop)) return false;
  if (prop.projectionFormulaError || prop.projectionFormulaValid === false) return false;
  const confidence = finite(
    prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence,
    NaN
  );
  const playability = resolvePlayabilityScore(prop);
  if (!Number.isFinite(playability) || playability < TOP_VERIFIED_MIN_PLAYABILITY) return false;
  if (!Number.isFinite(confidence) || confidence < TOP_VERIFIED_MIN_CONFIDENCE) return false;
  return true;
}

export function passesHeroOverallPlayGate(prop = {}) {
  if (!passesTopVerifiedPlaysGate(prop)) return false;

  const probability = finite(prop.probabilityScore ?? prop.verifiedProbability, NaN);
  const confidence = finite(
    prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence,
    NaN
  );
  const playability = resolvePlayabilityScore(prop);
  const sanity = resolveSanityScore(prop);
  const audit = prop.projectionSanityAudit;

  if (audit?.sanityFail || prop.projectionSanityFail) return false;
  if (!Number.isFinite(probability) || probability < HERO_MIN_PROBABILITY) return false;
  if (!Number.isFinite(confidence) || confidence < HERO_MIN_CONFIDENCE) return false;
  if (!Number.isFinite(playability) || playability < HERO_MIN_PLAYABILITY) return false;
  if (sanity == null || sanity < HERO_MIN_SANITY) return false;
  return true;
}

/** Top Verified sort: playability → confidence → probability → edge */
export function compareVerifiedPlaysRank(a = {}, b = {}) {
  const playA = resolvePlayabilityScore(a);
  const playB = resolvePlayabilityScore(b);
  if (playB !== playA) return playB - playA;

  const confA = finite(a.displayConfidenceScore ?? a.confidenceScore ?? a.confidence, 0);
  const confB = finite(b.displayConfidenceScore ?? b.confidenceScore ?? b.confidence, 0);
  if (confB !== confA) return confB - confA;

  const probA = finite(a.probabilityScore ?? a.verifiedProbability, 0);
  const probB = finite(b.probabilityScore ?? b.verifiedProbability, 0);
  if (probB !== probA) return probB - probA;

  const edgeA = resolveRankingEdgePercent(a);
  const edgeB = resolveRankingEdgePercent(b);
  if (edgeB !== edgeA) return edgeB - edgeA;

  const scoreA = computeTopPickScore(a);
  const scoreB = computeTopPickScore(b);
  if (scoreB !== scoreA) return scoreB - scoreA;

  const projA = finite(a.projection ?? a.projectedValue, 0);
  const projB = finite(b.projection ?? b.projectedValue, 0);
  if (projB !== projA) return projB - projA;

  return String(a.playerName || a.player || "").localeCompare(String(b.playerName || b.player || ""));
}

export const compareVerifiedRankingPlays = compareVerifiedPlaysRank;
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
  const playabilityScore = resolvePlayabilityScore(prop);
  const score = computeTopPickScore({ ...prop, playabilityScore });
  const resolvedRank = rank ?? prop.topVerifiedRank ?? prop.topMlbPlayRank ?? 1;
  const rankingReason = buildTopPickRankingReason({ ...prop, playabilityScore }, resolvedRank);
  return {
    ...prop,
    playabilityScore,
    topPickScore: score,
    verifiedRankingScore: score,
    weightedBestPlayScore: score,
    rankingReason,
    topPickRankingReason: rankingReason,
    topVerifiedRank: prop.topVerifiedRank ?? resolvedRank,
  };
}

function passesRelaxedVerifiedDisplayGate(prop = {}) {
  if (isResearchOnlyProp(prop)) return false;
  if (prop.projectionFormulaError || prop.projectionFormulaValid === false) return false;
  const probability = finite(prop.probabilityScore ?? prop.verifiedProbability, NaN);
  const confidence = finite(
    prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence,
    NaN
  );
  const playability = resolvePlayabilityScore(prop);
  return (
    Number.isFinite(probability) &&
    Number.isFinite(confidence) &&
    probability >= 45 &&
    confidence >= TOP_VERIFIED_MIN_CONFIDENCE &&
    Number.isFinite(playability)
  );
}

export function selectTopVerifiedByScore(props = [], limit = 10) {
  const strict = [...(props || [])].filter(passesTopVerifiedPlaysGate).sort(compareVerifiedPlaysRank);
  const pool = strict.length
    ? strict
    : [...(props || [])].filter(passesRelaxedVerifiedDisplayGate).sort(compareVerifiedPlaysRank);
  return pool
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
