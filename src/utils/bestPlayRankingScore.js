/**
 * Top pick ranking — score, tier-aware selection, and ranking reasons.
 */

import { computePlayabilityScore } from "./propCalibration.js";
import { computeExpectedValueScore } from "../services/decisionEngine.js";
import { isBlockedNonMlbPipelineProp, isSupportedMlbMarket } from "./mlbAllowedMarkets.js";
import { canonicalMarketKey } from "./marketNormalization.js";
import { PENALTY_AGGRESSIVE_RISK, PENALTY_OUTLIER } from "./probabilityCalibration.js";
import { qualifiesEliteRecentFormCap } from "./mlbPlayConfidence.js";

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function resolveEvScore(prop = {}) {
  return finite(prop.expectedValueScore ?? computeExpectedValueScore(prop), 0);
}

function resolveRankProbability(prop = {}) {
  return finite(prop.probabilityScore ?? prop.verifiedProbability ?? prop.finalProbability, 0);
}

function resolveRankConfidence(prop = {}) {
  return finite(
    prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence ?? prop.finalConfidence,
    0
  );
}

export function buildScoreDiagnostics(prop = {}, rank = null) {
  const evScore = resolveEvScore(prop);
  return {
    rank,
    rawProjection: prop.projection ?? prop.projectedValue ?? null,
    line: prop.line ?? null,
    edge: prop.edge ?? null,
    edgePercent: prop.edgePercent ?? null,
    probability: resolveRankProbability(prop) || null,
    confidence: resolveRankConfidence(prop) || null,
    evScore: Number.isFinite(evScore) ? round1(evScore) : null,
    playScore: (() => {
      const value = prop.playabilityScore ?? prop.playabilityBreakdown?.finalPlayability;
      const num = Number(value);
      return Number.isFinite(num) ? round1(num) : null;
    })(),
    scoreBand: resolveScoreBand(prop),
  };
}

export function resolveScoreBand(prop = {}) {
  const confidence = resolveRankConfidence(prop);
  const probability = resolveRankProbability(prop);
  const score = Math.max(confidence, probability);
  if (score >= 85) return "Elite";
  if (score >= 75) return "Strong";
  if (score >= 65) return "Playable";
  return "Avoid";
}

function compareEvProbConf(a = {}, b = {}) {
  const evDelta = resolveEvScore(b) - resolveEvScore(a);
  if (evDelta !== 0) return evDelta;
  const probDelta = resolveRankProbability(b) - resolveRankProbability(a);
  if (probDelta !== 0) return probDelta;
  return resolveRankConfidence(b) - resolveRankConfidence(a);
}

export const RANKING_PENALTY_OUTLIER = 20;
export const RANKING_PENALTY_MISSING_SEASON = 15;
export const RANKING_PENALTY_SMALL_SAMPLE = 10;
export const LOW_CONFIDENCE_MAX_RANK = 5;
export const LOW_CONFIDENCE_EXCLUDE_TOP = 3;
export const PITCHER_ZERO_MAX_RANK = 3;
export const STABLE_VS_OUTLIER_PROB_WINDOW = 10;

function resolvePitcherIntegrityForRank(prop = {}) {
  const value = prop.integrityAudit?.pitcherIntegrity ?? prop.pitcherIntegrity;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function isReviewNeededForRank(prop = {}) {
  return hasIntegrityReviewFlags(prop);
}

function enforceReviewNeededRankFloor(sorted = [], minRank = 2) {
  if (!sorted.length || minRank <= 1) return sorted;

  const reservedSlots = minRank - 1;
  const eligible = sorted.filter((prop) => !isReviewNeededForRank(prop));
  const head = eligible.slice(0, reservedSlots);
  const headSet = new Set(head);
  const tail = sorted.filter((prop) => !headSet.has(prop));
  return [...head, ...tail];
}

function enforcePitcherZeroRankFloor(sorted = [], maxRank = PITCHER_ZERO_MAX_RANK) {
  if (!sorted.length || maxRank <= 1) return sorted;

  const reservedSlots = maxRank - 1;
  const verified = sorted.filter((prop) => resolvePitcherIntegrityForRank(prop) !== 0);
  const head = verified.slice(0, reservedSlots);
  const headSet = new Set(head);
  const tail = sorted.filter((prop) => !headSet.has(prop));
  return [...head, ...tail];
}

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
  const missingSeasonPenalty = seasonAvailable
    ? 0
    : qualifiesEliteRecentFormCap(prop)
      ? Math.min(RANKING_PENALTY_MISSING_SEASON, 5)
      : RANKING_PENALTY_MISSING_SEASON;
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

import { classifyPropTier } from "./tierClassification.js";
import { DATA_STATUS, resolveMlbDataStatus } from "./mlbBoardPipeline.js";

const MAX_RANKING_EDGE_PERCENT = 40;

function computeValidatedEdgePercent(prop = {}) {
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(projection) || projection <= 0 || !Number.isFinite(line)) return null;
  return ((projection - line) / projection) * 100;
}

function clampValidatedEdgePercent(edgePercent) {
  const pct = finite(edgePercent, NaN);
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(MAX_RANKING_EDGE_PERCENT, pct));
}

function isFullDataProp(prop = {}) {
  return resolveMlbDataStatus(prop) === DATA_STATUS.FULL_MLB_DATA;
}

function hasIntegrityReviewFlags(prop = {}) {
  const integrity = prop.integrityAudit;
  if (!integrity) return false;
  return Boolean(integrity.hitRateInvalid || integrity.probabilityMismatch || integrity.edgeMismatch);
}

const TIER_SORT_ORDER = { A: 0, B: 1, "Review Needed": 2, C: 3, D: 4 };

function compareBestPlaysTierRank(a = {}, b = {}) {
  const tierA = TIER_SORT_ORDER[classifyPropTier(a) ?? "D"] ?? 5;
  const tierB = TIER_SORT_ORDER[classifyPropTier(b) ?? "D"] ?? 5;
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
  return Math.min(resolveRankingEdgePercent(prop), 90);
}

export function resolveRecentFormScore(prop = {}) {
  const raw =
    prop.last10HitRate ??
    prop.recentHitRate ??
    prop.hitRateSnapshot?.last10 ??
    prop.hitRateSnapshot?.last10HitRate ??
    prop.hitRateSnapshot?.last10Label;
  if (raw == null || raw === "" || raw === "—") return 0;
  if (typeof raw === "string" && raw.includes("%")) {
    const num = Number(String(raw).replace("%", "").trim());
    return Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 0;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num <= 1 ? num * 100 : num));
}

export function resolveMarketPriorityBonus(prop = {}) {
  const market = canonicalMarketKey(prop);
  if (market === "hrr") return 10;
  if (market === "totalBases") return 8;
  if (market === "hits") return 7;
  if (market === "rbis") return 4;
  if (market === "fantasyScore") return -5;
  if (!isSupportedMlbMarket(prop) || isBlockedNonMlbPipelineProp(prop)) return -10;
  const tier = String(prop.finalTier || prop.tier || "").toUpperCase();
  if (tier === "C") return -5;
  return 0;
}

/** Top Play final score for Verified Plays ranking. */
export function computeTopPlayFinalScore(prop = {}) {
  const probability = finite(prop.probabilityScore ?? prop.verifiedProbability ?? prop.probabilityNormalized, 0);
  const confidence = finite(
    prop.displayConfidenceScore ?? prop.confidenceNormalized ?? prop.confidenceScore ?? prop.confidence,
    0
  );
  const edgeScore = resolveNormalizedEdgeScore(prop);
  const recentForm = resolveRecentFormScore(prop);
  const marketBonus = resolveMarketPriorityBonus(prop);
  const score =
    probability * 0.45 + confidence * 0.25 + edgeScore * 0.2 + recentForm * 0.1 + marketBonus;
  return Math.round(score * 100) / 100;
}

/** User-facing Best Play rank breakdown for card display. */
export function buildTopPlayRankExplanation(prop = {}) {
  const rankScore = computeTopPlayFinalScore(prop);
  const probability = finite(
    prop.probabilityNormalized ?? prop.probabilityScore ?? prop.verifiedProbability,
    NaN
  );
  const confidence = finite(
    prop.confidenceNormalized ?? prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence,
    NaN
  );
  const edgePercent = resolveRankingEdgePercent(prop);
  const edgeLabel =
    prop.displayEdgeLabel ||
    (Number.isFinite(edgePercent) && edgePercent !== 0
      ? `${edgePercent > 0 ? "+" : ""}${Math.round(edgePercent)}%`
      : null);

  return {
    rankScore,
    rankScoreLabel: `Rank Score ${rankScore}`,
    probabilityLabel: Number.isFinite(probability) ? `Probability ${Math.round(probability)}%` : null,
    confidenceLabel: Number.isFinite(confidence) ? `Confidence ${Math.round(confidence)}%` : null,
    edgeLabel: edgeLabel ? `Edge ${edgeLabel.startsWith("+") || edgeLabel.startsWith("-") ? edgeLabel : `+${edgeLabel}`}` : null,
    lines: [
      `Rank Score ${rankScore}`,
      Number.isFinite(probability) ? `Probability ${Math.round(probability)}%` : null,
      Number.isFinite(confidence) ? `Confidence ${Math.round(confidence)}%` : null,
      edgeLabel
        ? `Edge ${edgeLabel.startsWith("+") || edgeLabel.startsWith("-") ? edgeLabel : `+${edgeLabel}`}`
        : null,
    ].filter(Boolean),
  };
}

export function compareTopPlayFinalScore(a = {}, b = {}) {
  const tierDelta = compareBestPlaysTierRank(a, b);
  if (tierDelta !== 0) return tierDelta;
  const primary = compareEvProbConf(a, b);
  if (primary !== 0) return primary;
  return computeTopPlayFinalScore(b) - computeTopPlayFinalScore(a);
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
  return compareEvProbConf(a, b) || computeTopPickScore(b) - computeTopPickScore(a);
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

/** Best Plays: EV score, then probability, then confidence. */
export function compareBestPlaysRank(a = {}, b = {}) {
  const stableCmp = compareStableVsOutlierPriority(a, b);
  if (stableCmp !== 0) return stableCmp;

  const primary = compareEvProbConf(a, b);
  if (primary !== 0) return primary;

  const tierCmp = compareBestPlaysTierRank(a, b);
  if (tierCmp !== 0) return tierCmp;

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

  return enforcePitcherZeroRankFloor(
    enforceReviewNeededRankFloor(result.slice(0, target), 2),
    PITCHER_ZERO_MAX_RANK
  );
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
  const expectedValueScore = resolveEvScore({ ...prop, playabilityScore });
  const audit = computeBestPlayRankingScore({ ...prop, playabilityScore, expectedValueScore });
  const resolvedRank = rank ?? prop.bestPlayRank ?? prop.topVerifiedRank ?? prop.topMlbPlayRank ?? null;
  const finalRankReason = buildBestPlayRankReason({ ...prop, playabilityScore, expectedValueScore }, resolvedRank ?? 1, audit);
  const legacyScore = computeTopPickScore({ ...prop, playabilityScore, expectedValueScore });
  const scoreDiagnostics = buildScoreDiagnostics(
    { ...prop, playabilityScore, expectedValueScore },
    resolvedRank
  );
  return {
    ...prop,
    playabilityScore,
    expectedValueScore,
    scoreDiagnostics,
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
