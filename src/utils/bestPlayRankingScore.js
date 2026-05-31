/**
 * Top pick ranking — score, tier-aware selection, and ranking reasons.
 */

import { computePlayabilityScore } from "./propCalibration.js";
import { isBlockedNonMlbPipelineProp, isSupportedMlbMarket } from "./mlbAllowedMarkets.js";
import { PENALTY_AGGRESSIVE_RISK, PENALTY_OUTLIER } from "./probabilityCalibration.js";

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export const RANKING_PENALTY_OUTLIER = 20;
export const RANKING_PENALTY_MISSING_SEASON = 15;
export const RANKING_PENALTY_SMALL_SAMPLE = 10;
export const LOW_CONFIDENCE_MAX_RANK = 5;
export const LOW_CONFIDENCE_EXCLUDE_TOP = 3;
export const STABLE_VS_OUTLIER_PROB_WINDOW = 10;

export function resolveBestPlayRankingFlags(prop = {}) {
  const audit = prop.projectionSanityAudit || {};
  const validation = prop.projectionValidation || audit.marketValidation || {};
  const projectionConfidence = String(
    prop.projectionValidationConfidence ||
      validation.projectionConfidence ||
      audit.projectionValidationConfidence ||
      ""
  ).toUpperCase();
  const projectionRisk = String(
    prop.projectionRisk || validation.projectionRisk || audit.projectionRisk || ""
  ).toUpperCase();
  const outlierDetected = Boolean(
    prop.projectionOutlierDetected ||
      validation.outlierDetected ||
      audit.projectionOutlierDetected ||
      audit.outlierWarning ||
      prop.projectionOutlierWarning
  );

  return {
    projectionConfidence,
    projectionRisk,
    outlierDetected,
    projectionConfidenceLow: projectionConfidence === "LOW",
    projectionRiskAggressive: projectionRisk === "AGGRESSIVE",
  };
}

export function resolveSeasonDataAvailable(prop = {}) {
  const breakdown = prop.probabilityCalibration?.breakdown;
  if (breakdown?.seasonRateValid != null) return Boolean(breakdown.seasonRateValid);
  const hitRates = prop.probabilityCalibration?.hitRates;
  if (hitRates?.seasonRateValid != null) return Boolean(hitRates.seasonRateValid);
  if (prop.probabilityAudit?.calibration?.breakdown?.seasonRateValid != null) {
    return Boolean(prop.probabilityAudit.calibration.breakdown.seasonRateValid);
  }
  const seasonRate = finite(prop.seasonHitRate, NaN);
  const seasonGames = finite(prop.seasonGamesPlayed ?? prop.seasonGames ?? prop.sportsDataGames, NaN);
  return Number.isFinite(seasonRate) && Number.isFinite(seasonGames) && seasonGames >= 20;
}

export function resolveRankingSampleGames(prop = {}) {
  return (
    finite(prop.probabilityCalibration?.hitRates?.last10Games, NaN) ||
    finite(prop.games ?? prop.sampleSize ?? prop.gamesPlayed ?? prop.gameLogCount, NaN) ||
    null
  );
}

export function isStableFullDataPlayer(prop = {}) {
  const flags = resolveBestPlayRankingFlags(prop);
  return (
    !flags.outlierDetected &&
    !flags.projectionConfidenceLow &&
    resolveSeasonDataAvailable(prop)
  );
}

export function isOutlierRankingPlayer(prop = {}) {
  const flags = resolveBestPlayRankingFlags(prop);
  return (
    flags.outlierDetected ||
    flags.projectionConfidenceLow ||
    !resolveSeasonDataAvailable(prop)
  );
}

export function computeBestPlayRankingPenalties(prop = {}) {
  const flags = resolveBestPlayRankingFlags(prop);
  const seasonAvailable = resolveSeasonDataAvailable(prop);
  const sampleGames = resolveRankingSampleGames(prop);
  const outlierPenalty = flags.outlierDetected ? RANKING_PENALTY_OUTLIER : 0;
  const aggressiveRiskPenalty = flags.projectionRiskAggressive ? PENALTY_AGGRESSIVE_RISK : 0;
  const missingSeasonPenalty = seasonAvailable ? 0 : RANKING_PENALTY_MISSING_SEASON;
  const sampleSizePenalty =
    sampleGames != null && sampleGames < 20 ? RANKING_PENALTY_SMALL_SAMPLE : 0;

  return {
    ...flags,
    seasonAvailable,
    sampleGames,
    outlierPenalty,
    aggressiveRiskPenalty,
    missingSeasonPenalty,
    sampleSizePenalty,
    probabilityOutlierPenalty: flags.outlierDetected ? PENALTY_OUTLIER : 0,
    probabilityAggressivePenalty: flags.projectionRiskAggressive ? PENALTY_AGGRESSIVE_RISK : 0,
    totalPenalty: outlierPenalty + aggressiveRiskPenalty + missingSeasonPenalty + sampleSizePenalty,
  };
}

/** Ranking Score = probability + confidence + playability - outlier - aggressive risk penalties. */
export function computeBestPlayRankingScore(prop = {}) {
  const probability = finite(prop.probabilityScore ?? prop.verifiedProbability, 0);
  const confidence = finite(
    prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence,
    0
  );
  const playability = resolvePlayabilityScore(prop);
  const penalties = computeBestPlayRankingPenalties(prop);
  const baseScore = round1(probability + confidence + playability);
  const rankingScore = round1(
    baseScore -
      penalties.outlierPenalty -
      penalties.aggressiveRiskPenalty -
      penalties.missingSeasonPenalty -
      penalties.sampleSizePenalty
  );

  return {
    rankingScore,
    baseScore,
    probability,
    confidence,
    playability,
    penalties,
  };
}

export const NO_TIER_A_PLAYS_MESSAGE = "No Tier A Plays Today";
export const NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE = "No high-quality verified plays yet";

export const TOP_VERIFIED_MIN_PLAYABILITY = 45;
export const TOP_VERIFIED_MIN_CONFIDENCE = 50;
export const HERO_MIN_PROBABILITY = 60;
export const HERO_MIN_CONFIDENCE = 60;
export const HERO_MIN_PLAYABILITY = 60;
export const HERO_MIN_SANITY = 65;

import {
  computeValidatedEdgePercent,
  clampValidatedEdgePercent,
  isFullDataProp,
  classifyPropTier,
} from "./boardQuality.js";

const TIER_SORT_ORDER = { A: 0, B: 1, "Review Needed": 2, C: 3, D: 4 };

function compareBestPlaysTierRank(a = {}, b = {}) {
  const tierA = TIER_SORT_ORDER[classifyPropTier(a)] ?? 4;
  const tierB = TIER_SORT_ORDER[classifyPropTier(b)] ?? 4;
  return tierA - tierB;
}

export function resolveRankingEdgePercent(prop = {}) {
  const direct = finite(prop.edgePercent, NaN);
  const computed = Number.isFinite(direct)
    ? direct
    : computeValidatedEdgePercent(prop);
  if (!Number.isFinite(computed)) return 0;
  return clampValidatedEdgePercent(Math.abs(computed)) ?? 0;
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
  if (isBlockedNonMlbPipelineProp(prop) || !isSupportedMlbMarket(prop)) return false;
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
  if (!isFullDataProp(prop)) return false;
  return classifyPropTier(prop) === "A";
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

function compareStableVsOutlierPriority(a = {}, b = {}) {
  const stableA = isStableFullDataPlayer(a);
  const stableB = isStableFullDataPlayer(b);
  const outlierA = isOutlierRankingPlayer(a);
  const outlierB = isOutlierRankingPlayer(b);
  const probA = finite(a.probabilityScore ?? a.verifiedProbability, 0);
  const probB = finite(b.probabilityScore ?? b.verifiedProbability, 0);
  if (Math.abs(probA - probB) > STABLE_VS_OUTLIER_PROB_WINDOW) return 0;
  if (stableA && outlierB) return -1;
  if (stableB && outlierA) return 1;
  return 0;
}

/** Best Plays: ranking score with stable-data priority and validation penalties. */
export function compareBestPlaysRank(a = {}, b = {}) {
  const stableCmp = compareStableVsOutlierPriority(a, b);
  if (stableCmp !== 0) return stableCmp;

  const scoreA = finite(a.bestPlayRankingScore ?? computeBestPlayRankingScore(a).rankingScore, 0);
  const scoreB = finite(b.bestPlayRankingScore ?? computeBestPlayRankingScore(b).rankingScore, 0);
  if (scoreB !== scoreA) return scoreB - scoreA;

  const tierCmp = compareBestPlaysTierRank(a, b);
  if (tierCmp !== 0) return tierCmp;

  const probA = finite(a.probabilityScore ?? a.verifiedProbability, 0);
  const probB = finite(b.probabilityScore ?? b.verifiedProbability, 0);
  if (probB !== probA) return probB - probA;

  const confA = finite(a.displayConfidenceScore ?? a.confidenceScore ?? a.confidence, 0);
  const confB = finite(b.displayConfidenceScore ?? b.confidenceScore ?? b.confidence, 0);
  if (confB !== confA) return confB - confA;

  const edgeA = resolveRankingEdgePercent(a);
  const edgeB = resolveRankingEdgePercent(b);
  if (edgeB !== edgeA) return edgeB - edgeA;

  return String(a.playerName || a.player || "").localeCompare(String(b.playerName || b.player || ""));
}

export function applyBestPlayRankConstraints(sorted = [], { limit = null } = {}) {
  const byScore = [...(sorted || [])].sort(compareBestPlaysRank);
  const target = limit ?? byScore.length;
  const stable = byScore.filter((prop) => !resolveBestPlayRankingFlags(prop).projectionConfidenceLow);
  const low = byScore.filter((prop) => resolveBestPlayRankingFlags(prop).projectionConfidenceLow);
  const result = [];

  for (const prop of stable) {
    if (result.length >= target) break;
    result.push(prop);
  }

  for (const prop of low) {
    if (result.length >= target) break;
    if (result.length < LOW_CONFIDENCE_EXCLUDE_TOP) continue;
    if (result.length >= LOW_CONFIDENCE_MAX_RANK) break;
    result.push(prop);
  }

  for (const prop of stable) {
    if (result.length >= target) break;
    if (result.includes(prop)) continue;
    result.push(prop);
  }

  for (const prop of byScore) {
    if (result.length >= target) break;
    if (result.includes(prop)) continue;
    if (resolveBestPlayRankingFlags(prop).projectionConfidenceLow) continue;
    result.push(prop);
  }

  return result.slice(0, target);
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

export function buildBestPlayRankReason(prop = {}, rank = 1, audit = null) {
  const resolved = audit || computeBestPlayRankingScore(prop);
  const penalties = resolved.penalties || computeBestPlayRankingPenalties(prop);
  const penaltyParts = [];
  if (penalties.outlierPenalty) penaltyParts.push(`outlier -${penalties.outlierPenalty}`);
  if (penalties.aggressiveRiskPenalty) penaltyParts.push(`aggressive -${penalties.aggressiveRiskPenalty}`);
  if (penalties.missingSeasonPenalty) penaltyParts.push(`season -${penalties.missingSeasonPenalty}`);
  if (penalties.sampleSizePenalty) penaltyParts.push(`sample -${penalties.sampleSizePenalty}`);
  const penaltyLabel = penaltyParts.length ? penaltyParts.join(", ") : "none";
  const stableLabel = isStableFullDataPlayer(prop) ? "stable full data" : "validation flags applied";
  return `Rank #${rank}: score ${round1(resolved.rankingScore)} (${round1(resolved.probability)}% prob + ${round1(resolved.confidence)}% conf + ${round1(resolved.playability)} playability; penalties: ${penaltyLabel}; ${stableLabel})`;
}

export function annotateBestPlayRankingAudit(prop = {}, rank = null) {
  const playabilityScore = resolvePlayabilityScore(prop);
  const audit = computeBestPlayRankingScore({ ...prop, playabilityScore });
  const resolvedRank = rank ?? prop.bestPlayRank ?? prop.topVerifiedRank ?? prop.topMlbPlayRank ?? null;
  const finalRankReason = buildBestPlayRankReason({ ...prop, playabilityScore }, resolvedRank ?? 1, audit);
  const legacyScore = computeTopPickScore({ ...prop, playabilityScore });
  return {
    ...prop,
    playabilityScore,
    bestPlayRankingScore: audit.rankingScore,
    rankingScoreBase: audit.baseScore,
    topPickScore: audit.rankingScore,
    verifiedRankingScore: audit.rankingScore,
    weightedBestPlayScore: audit.rankingScore,
    legacyTopPickScore: legacyScore,
    rankingPenalties: audit.penalties,
    finalRankReason,
    rankingReason: finalRankReason,
    topPickRankingReason: finalRankReason,
    bestPlayRank: resolvedRank,
    topVerifiedRank: prop.topVerifiedRank ?? resolvedRank,
    isStableFullDataPlayer: isStableFullDataPlayer(prop),
    isOutlierRankingPlayer: isOutlierRankingPlayer(prop),
  };
}

export function annotateTopPickRankingFields(prop = {}, rank = null) {
  return annotateBestPlayRankingAudit(prop, rank);
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
