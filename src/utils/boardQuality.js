/**
 * Phase 6/7/11 board quality — diversity, edge display, full-data lock, tier classification.
 */

import { attachSeasonHitRateFields, resolveSeasonHitRateBundle } from "./seasonHitRate.js";
import { attachDataIntegrityFields } from "./dataIntegrity.js";
import { canonicalMarketKey } from "./marketNormalization.js";
import {
  applyBestPlayRankConstraints,
  compareBestPlaysRank,
  annotateBestPlayRankingAudit,
  resolveBestPlayRankingFlags,
} from "./bestPlayRankingScore.js";
import {
  attachIntegrityAuditFields,
  buildIntegrityAudit,
  PITCHER_MATCHUP_NOT_VERIFIED_MESSAGE,
  canSelectOverallPlayAtRank,
} from "./integrityAudit.js";
import { resolveVerifiedHitRateSnapshot } from "./verifiedHitRates.js";
import { STARTER_PENDING_LABEL, normalizePropPitcherFields, PITCHER_VERIFICATION, resolvePitcherVerification } from "./opponentStarter.js";
import {
  allowFallbackVerification,
  attachVerificationStatusFields,
  resolveVerificationStatus,
  VERIFICATION_STATUS,
} from "./verificationStatus.js";
import {
  DATA_STATUS,
  NO_VERIFIED_PLAYS_MESSAGE,
  TIER_A_RULES,
  TIER_B_RULES,
  BEST_PLAYS_MIN,
  hasFullMlbDataFields,
  resolveMlbDataStatus,
  isResearchCandidate,
  passesBestPlayBoardGate,
  normalizeBoardProp,
} from "./mlbBoardPipeline.js";

export const MAX_PLAYER_PROPS_IN_TOP_LIST = 2;
export const MAX_MARKET_PROPS_IN_TOP_LIST = 3;
export const BEST_PLAYS_DIVERSITY_MARKETS = [
  "hrr",
  "totalBases",
  "hits",
  "strikeouts",
  "fantasyScore",
  "runs",
];
export const TOP_SECTION_LIMIT = 5;
export const VALUE_SECTION_LIMIT = 10;
export const VALUE_MIN_CONFIDENCE = 60;
export const VALUE_MIN_PROBABILITY = 60;
export const SAFEST_PARTIAL_MIN_CONFIDENCE = 70;
export const SAFEST_PARTIAL_MIN_PROBABILITY = 65;
export const PROJECTED_FALLBACK_NOTICE =
  "No Tier A/B plays today — showing highest-confidence projected plays.";
export const MAX_DISPLAY_EDGE_PERCENT = 40;
export const PARTIAL_DATA_CONFIDENCE_PENALTY = 10;
export const TOP_FIVE_MIN_CONFIDENCE = 70;
export const SAFEST_MIN_CONFIDENCE = 75;
export const SAFEST_MIN_PLAYABILITY = 70;
export const SAFEST_MIN_SANITY = 80;
export const SAFEST_MIN_PROBABILITY = 70;
export const VALUE_UNDER_MIN_CONFIDENCE = 60;
export const VALUE_UNDER_MIN_PLAYABILITY = 60;
export const SAFEST_FALLBACK_NOTICE =
  "No full-data safest plays yet. Showing best available Tier A/B.";
export const TIER_REVIEW_NEEDED_LABEL = "Review Needed";
export const OVERALL_PLAY_PENDING_MESSAGE = "Best available play — awaiting matchup verification.";
export const BEST_PLAY_FALLBACK_NOTICE =
  "No Tier A plays today — showing highest scoring Tier B plays.";
export const TIER_C_FALLBACK_NOTICE =
  "No Tier A/B plays today — showing research candidates only.";
export const REVIEW_NEEDED_FALLBACK_NOTICE = TIER_C_FALLBACK_NOTICE;
export const PITCHER_PENDING_CONFIDENCE_PENALTY = 10;
export const PITCHER_PENDING_TAG = "Pitcher Pending";
export const FALLBACK_RANK_WEIGHTS = {
  confidence: 0.35,
  probability: 0.35,
  playability: 0.2,
  sanity: 0.1,
};
/** Production tier thresholds — probability + confidence + playability + full MLB data. */
export const TIER_A_MIN_CONFIDENCE = TIER_A_RULES.confidence;
export const TIER_A_MIN_PLAYABILITY = TIER_A_RULES.playability;
export const TIER_A_MIN_PROBABILITY = TIER_A_RULES.probability;
export const TIER_B_MIN_CONFIDENCE = TIER_B_RULES.confidence;
export const TIER_B_MIN_PLAYABILITY = TIER_B_RULES.playability;
export const TIER_B_MIN_PROBABILITY = TIER_B_RULES.probability;
/** Legacy edge gates — not used for A/B/C tier classification. */
export const TIER_A_MIN_EDGE = 0.5;
export const TIER_B_MIN_EDGE = 0.3;
export const TIER_A_MIN_LAST10_HIT_RATE = 60;
export const TIER_B_MIN_LAST10_HIT_RATE = 50;
export const TIER_REVIEW_MIN_CONFIDENCE = TIER_B_MIN_CONFIDENCE;
export const TIER_REVIEW_MIN_PROBABILITY = TIER_B_MIN_PROBABILITY;
export const TIER_REVIEW_MIN_PLAYABILITY = TIER_B_MIN_PLAYABILITY;
export const TIER_A_MIN_SANITY = 90;
export const TIER_A_MIN_PITCHER_INTEGRITY = 70;
export const TIER_B_MIN_SANITY = 85;
export const BEST_PLAY_MIN_CONFIDENCE = BEST_PLAYS_MIN.confidence;
export const BEST_PLAY_MIN_PROBABILITY = BEST_PLAYS_MIN.probability;
export const BEST_PLAY_MIN_PLAYABILITY = BEST_PLAYS_MIN.playability;
export const BEST_PLAY_MIN_SANITY = 0;
export const MIN_UNIQUE_PLAYERS_TOP_10 = 5;
export const MIN_PROJECTED_PROPS_FOR_BEST_PLAYS = 20;
export const TOP_BEST_PLAYS_TARGET = 10;
export const CONFIDENCE_CALIBRATION_MIN = 50;
export const CONFIDENCE_CALIBRATION_MAX = 95;

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function playerKey(prop = {}) {
  return String(prop.playerName || prop.player || "")
    .trim()
    .toLowerCase();
}

export function marketKey(prop = {}) {
  return canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
}

function diversityMarketKey(prop = {}) {
  return marketKey(prop) || String(prop.statType || prop.market || prop.propType || "").trim().toLowerCase();
}

export function buildPlayerMarketKey(prop = {}) {
  return `${playerKey(prop)}|${marketKey(prop)}`;
}

function defaultPickScore(prop = {}) {
  return Number(
    prop.bestPlayRankingScore ??
      prop.topPickScore ??
      prop.verifiedRankingScore ??
      prop.weightedBestPlayScore ??
      0
  );
}

/** Keep highest-scoring prop per player + market type. */
export function dedupeByPlayerMarketBestScore(props = [], scoreFn = defaultPickScore) {
  const best = new Map();
  for (const prop of props || []) {
    const key = buildPlayerMarketKey(prop);
    if (!key || key === "|") continue;
    const score = Number(scoreFn(prop)) || 0;
    const prev = best.get(key);
    if (!prev || score > (Number(scoreFn(prev)) || 0)) {
      best.set(key, prop);
    }
  }
  return [...best.values()];
}

/** Max N props per player in ranked lists (e.g. Top 10 allows 2 Juan Soto markets). */
export function applyPlayerDiversityFilter(
  props = [],
  { limit = 10, maxPerPlayer = MAX_PLAYER_PROPS_IN_TOP_LIST } = {}
) {
  const counts = new Map();
  const out = [];
  for (const prop of props || []) {
    if (out.length >= limit) break;
    const key = playerKey(prop);
    if (!key) continue;
    const used = counts.get(key) || 0;
    if (used >= maxPerPlayer) continue;
    counts.set(key, used + 1);
    out.push(prop);
  }
  return out;
}

/** Prefer unique players and mixed markets; cap props per player and per market. */
export function applyBestPlaysDiversityFilter(
  props = [],
  {
    limit = 10,
    maxPerPlayer = MAX_PLAYER_PROPS_IN_TOP_LIST,
    maxPerMarket = MAX_MARKET_PROPS_IN_TOP_LIST,
    minUniquePlayers = MIN_UNIQUE_PLAYERS_TOP_10,
    priorityMarkets = BEST_PLAYS_DIVERSITY_MARKETS,
  } = {}
) {
  const sorted = [...props];
  const playerCounts = new Map();
  const marketCounts = new Map();
  const out = [];
  const seen = new Set();

  const canAdd = (prop) => {
    const player = playerKey(prop);
    const market = diversityMarketKey(prop);
    if (!player || !market) return false;
    if (seen.has(prop)) return false;
    if ((playerCounts.get(player) || 0) >= maxPerPlayer) return false;
    if ((marketCounts.get(market) || 0) >= maxPerMarket) return false;
    return true;
  };

  const addProp = (prop) => {
    const player = playerKey(prop);
    const market = diversityMarketKey(prop);
    out.push(prop);
    seen.add(prop);
    playerCounts.set(player, (playerCounts.get(player) || 0) + 1);
    marketCounts.set(market, (marketCounts.get(market) || 0) + 1);
  };

  for (const targetMarket of priorityMarkets) {
    if (out.length >= limit) break;
    const candidate = sorted.find((prop) => diversityMarketKey(prop) === targetMarket && canAdd(prop));
    if (candidate) addProp(candidate);
  }

  for (const prop of sorted) {
    if (out.length >= limit) break;
    const player = playerKey(prop);
    if (!player || seen.has(prop) || playerCounts.has(player)) continue;
    if (!canAdd(prop)) continue;
    addProp(prop);
  }

  for (const prop of sorted) {
    if (out.length >= limit) break;
    if (seen.has(prop) || !canAdd(prop)) continue;
    addProp(prop);
  }

  void minUniquePlayers;
  return out.slice(0, limit);
}

export function computeValidatedEdgePercent(prop = {}) {
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(projection) || projection <= 0) return null;
  if (!Number.isFinite(line)) return null;
  return ((projection - line) / projection) * 100;
}

export function clampValidatedEdgePercent(edgePercent) {
  const pct = finite(edgePercent, NaN);
  if (!Number.isFinite(pct)) return null;
  return clamp(pct, 0, MAX_DISPLAY_EDGE_PERCENT);
}

export function formatValidatedEdgeDisplay(prop = {}) {
  const rawPct = computeValidatedEdgePercent(prop);
  if (rawPct == null || !Number.isFinite(rawPct)) {
    return {
      rawEdgeLabel: "—",
      displayEdgeLabel: "—",
      relativeEdgeLabel: "—",
      edgePercent: null,
      edgeCapped: false,
    };
  }
  const absPct = Math.abs(rawPct);
  const edgeCapped = absPct > MAX_DISPLAY_EDGE_PERCENT;
  const capped = clampValidatedEdgePercent(absPct);
  const sign = rawPct > 0 ? "+" : rawPct < 0 ? "" : "";
  const displayEdgeLabel = edgeCapped ? "40%+" : `${sign}${Math.round(capped ?? 0)}%`;
  const rawEdge = finite(prop.edge, NaN);
  const rawEdgeLabel =
    Number.isFinite(rawEdge) && rawEdge !== 0
      ? `${rawEdge > 0 ? "+" : ""}${Math.round(rawEdge * 10) / 10}`
      : displayEdgeLabel;
  return {
    rawEdgeLabel,
    displayEdgeLabel,
    relativeEdgeLabel: displayEdgeLabel,
    edgePercent: rawPct,
    edgeCapped,
  };
}

export function hasMissingProjection(prop = {}) {
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  return !Number.isFinite(projection) || projection <= 0;
}

export function resolveMissingFullDataFields(prop = {}) {
  const missing = [];
  if (!playerKey(prop)) missing.push("player");
  if (!marketKey(prop)) missing.push("market");
  const line = finite(prop.line, NaN);
  if (!Number.isFinite(line) || line <= 0) missing.push("line");
  if (hasMissingProjection(prop)) missing.push("projection");
  const confidence = resolvePropConfidence(prop);
  if (!Number.isFinite(confidence) || confidence <= 0) missing.push("confidence");
  return missing;
}

export function resolveFullDataReason(prop = {}) {
  const missing = resolveMissingFullDataFields(prop);
  if (!missing.length) return "FULL_DATA: required projection fields present";
  return `PARTIAL_DATA: missing ${missing.join(", ")}`;
}

export function isFullDataProp(prop = {}) {
  return resolveMlbDataStatus(prop) === DATA_STATUS.FULL_MLB_DATA;
}

export function resolveBoardDataQualityLabel(prop = {}) {
  const status = resolveMlbDataStatus(prop);
  if (status === DATA_STATUS.FULL_MLB_DATA) return "Full MLB Data";
  if (status === DATA_STATUS.REVIEW_NEEDED) return "Review Needed";
  if (status === DATA_STATUS.RESEARCH_ONLY) return "Research Only";
  return "Partial MLB Data";
}

export function resolveBoardDataQualityBadge(prop = {}) {
  return {
    label: resolveBoardDataQualityLabel(prop),
    tone: isFullDataProp(prop) ? "full" : "partial",
  };
}

/** Partial only when a hard required field is missing — optional context never triggers this. */
export function hasPartialDataFlags(prop = {}) {
  return !isFullDataProp(prop);
}

export function hasPartialDataBadge(prop = {}) {
  return hasPartialDataFlags(prop);
}

export function hasMlbStatsApiData(prop = {}) {
  return Boolean(
    prop.hasVerifiedStats ||
      prop.statsProfile ||
      prop.historicalCoverage === true ||
      Number(prop.sampleSize) >= 5 ||
      prop.historicalStatsAttached ||
      prop.hasGameLogs ||
      prop.historicalDataPresent
  );
}

export function hasSportsDataIoData(prop = {}) {
  return Boolean(
    /sportsdata/i.test(String(prop.projectionSource || "")) ||
      prop.sportsDataGames != null ||
      prop.sportsDataRawStat != null ||
      prop.sportsDataPropLabel
  );
}

export function passesFullDataBestPlayRequirements(prop = {}) {
  return isFullDataProp(prop);
}

export function hasMissingStats(prop = {}) {
  return !hasMlbStatsApiData(prop);
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function resolvePitcherIntegrityScore(prop = {}) {
  const integrity = prop.integrityAudit || buildIntegrityAudit(prop);
  return finite(integrity.pitcherIntegrity, 0);
}

export function isReviewNeededPlay(prop = {}) {
  return classifyPropTier(prop) === TIER_REVIEW_NEEDED_LABEL;
}

export function hasIntegrityReviewFlags(prop = {}) {
  const integrity = prop.integrityAudit || buildIntegrityAudit(prop);
  return Boolean(integrity.hitRateInvalid || integrity.probabilityMismatch || integrity.edgeMismatch);
}

export function isPitcherPendingPlay(prop = {}) {
  if (resolvePitcherIntegrityScore(prop) === 0) return true;
  const pitcher = String(prop.opposingPitcher || prop.matchupAudit?.pitcher || prop.opponentStarterNote || "").trim();
  return (
    !pitcher ||
    pitcher === "—" ||
    pitcher === STARTER_PENDING_LABEL ||
    pitcher === PITCHER_PENDING_TAG ||
    /pitcher pending|starter pending/i.test(pitcher)
  );
}

export function applyPitcherPendingConfidencePenalty(prop = {}) {
  if (!isPitcherPendingPlay(prop)) return prop;
  return {
    ...prop,
    pitcherPendingTag: PITCHER_PENDING_TAG,
    opposingPitcher:
      prop.opposingPitcher && prop.opposingPitcher !== "—"
        ? prop.opposingPitcher
        : STARTER_PENDING_LABEL,
  };
}

export function resolvePropEdge(prop = {}) {
  const edge = finite(prop.edge, NaN);
  if (Number.isFinite(edge)) return Math.abs(edge);
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (Number.isFinite(line) && Number.isFinite(projection)) return Math.abs(projection - line);
  return NaN;
}

export function resolveLast10HitRate(prop = {}) {
  const raw =
    prop.last10HitRate ??
    prop.recentHitRate ??
    prop.hitRateSnapshot?.last10 ??
    prop.hitRateSnapshot?.last10HitRate;
  const num = finite(raw, NaN);
  if (!Number.isFinite(num)) return NaN;
  return num <= 1 ? num * 100 : num;
}

function formatTierMetric(value) {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value * 10) / 10;
}

export function getTierAFailures(prop = {}) {
  const failures = [];
  const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
  if (isResearchCandidate(prop)) failures.push("research candidate");
  if (verificationStatus !== VERIFICATION_STATUS.FULL) {
    failures.push(`verificationStatus ${verificationStatus || VERIFICATION_STATUS.UNVERIFIED}`);
  }
  if (resolveMlbDataStatus(prop) !== DATA_STATUS.FULL_MLB_DATA) failures.push("dataStatus not FULL_MLB_DATA");
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const playability = resolvePropPlayability(prop);
  const projectionConfidence = resolveProjectionConfidenceLevel(prop);
  const pitcherVerification =
    prop.pitcherVerification || resolvePitcherVerification(prop).pitcherVerification;

  if (pitcherVerification !== PITCHER_VERIFICATION.VERIFIED) {
    failures.push(`pitcherVerification ${pitcherVerification || PITCHER_VERIFICATION.PENDING}`);
  }
  if (!Number.isFinite(confidence) || confidence < TIER_A_MIN_CONFIDENCE) {
    failures.push(`confidence ${formatTierMetric(confidence)} < ${TIER_A_MIN_CONFIDENCE}`);
  }
  if (!Number.isFinite(probability) || probability < TIER_A_MIN_PROBABILITY) {
    failures.push(`probability ${formatTierMetric(probability)} < ${TIER_A_MIN_PROBABILITY}`);
  }
  if (!Number.isFinite(playability) || playability < TIER_A_MIN_PLAYABILITY) {
    failures.push(`playability ${formatTierMetric(playability)} < ${TIER_A_MIN_PLAYABILITY}`);
  }
  if (projectionConfidence === "LOW") failures.push("projectionConfidence LOW");
  if (hasIntegrityReviewFlags(prop)) failures.push("major data integrity failure");
  return failures;
}

export function getTierBFailures(prop = {}) {
  const failures = [];
  if (isResearchCandidate(prop)) failures.push("research candidate");
  const dataStatus = resolveMlbDataStatus(prop);
  const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
  const dataOk =
    dataStatus === DATA_STATUS.FULL_MLB_DATA ||
    dataStatus === DATA_STATUS.REVIEW_NEEDED ||
    (allowFallbackVerification && verificationStatus === VERIFICATION_STATUS.PARTIAL);
  if (!dataOk) {
    failures.push("dataStatus not FULL_MLB_DATA, REVIEW_NEEDED, or PARTIAL verification");
  }
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const playability = resolvePropPlayability(prop);
  const pitcherVerification =
    prop.pitcherVerification || resolvePitcherVerification(prop).pitcherVerification;

  if (pitcherVerification === PITCHER_VERIFICATION.FAIL) {
    failures.push("pitcherVerification FAIL");
  }
  if (!Number.isFinite(confidence) || confidence < TIER_B_MIN_CONFIDENCE) {
    failures.push(`confidence ${formatTierMetric(confidence)} < ${TIER_B_MIN_CONFIDENCE}`);
  }
  if (!Number.isFinite(probability) || probability < TIER_B_MIN_PROBABILITY) {
    failures.push(`probability ${formatTierMetric(probability)} < ${TIER_B_MIN_PROBABILITY}`);
  }
  if (!Number.isFinite(playability) || playability < TIER_B_MIN_PLAYABILITY) {
    failures.push(`playability ${formatTierMetric(playability)} < ${TIER_B_MIN_PLAYABILITY}`);
  }
  return failures;
}

export function explainTierClassification(prop = {}) {
  const tierAFailures = getTierAFailures(prop);
  const tierBFailures = getTierBFailures(prop);
  const tier = classifyPropTier(prop);
  let reason = "";
  if (tier === "A") {
    reason = "Qualified Tier A";
  } else if (tier === "B") {
    reason = `Tier A failed: ${tierAFailures.join("; ") || "unknown"}`;
  } else if (tier === "C") {
    reason = `Tier B failed: ${tierBFailures.join("; ") || "unknown"}`;
  } else {
    reason = `Below Tier C or missing major data: ${tierBFailures.join("; ") || tierAFailures.join("; ") || "unknown"}`;
  }
  return { tier, tierAFailures, tierBFailures, reason };
}

export function passesQualificationTierA(prop = {}) {
  return getTierAFailures(prop).length === 0;
}

export function passesQualificationTierB(prop = {}) {
  return getTierBFailures(prop).length === 0;
}

export function passesQualificationReviewNeeded(prop = {}) {
  return passesQualificationTierB(prop);
}

export const passesStrictTierAMetrics = passesQualificationTierA;
export const passesStrictTierBMetrics = passesQualificationTierB;

export function computeSortScore(prop = {}) {
  const confidence = finite(resolvePropConfidence(prop), 0);
  const probability = finite(resolvePropProbability(prop), 0);
  const playability = finite(resolvePropPlayability(prop), 0);
  const sanity = finite(resolvePropSanity(prop), 0);
  return round1(
    confidence * FALLBACK_RANK_WEIGHTS.confidence +
      probability * FALLBACK_RANK_WEIGHTS.probability +
      playability * FALLBACK_RANK_WEIGHTS.playability +
      sanity * FALLBACK_RANK_WEIGHTS.sanity
  );
}

export const computeFallbackRankingScore = computeSortScore;

export function compareSortScore(a = {}, b = {}) {
  const scoreDelta = computeSortScore(b) - computeSortScore(a);
  if (scoreDelta !== 0) return scoreDelta;
  return compareBestPlaysRank(a, b);
}

export const compareFallbackRankingScore = compareSortScore;

/** Best Plays display sort: tier A→B, probability, confidence, playability, edge%. */
export function compareBestPlaysDisplayRank(a = {}, b = {}) {
  const tierCmp = compareBestPlaysTierRank(a, b);
  if (tierCmp !== 0) return tierCmp;
  const probCmp = resolvePropProbability(b) - resolvePropProbability(a);
  if (probCmp !== 0) return probCmp;
  const confCmp = resolvePropConfidence(b) - resolvePropConfidence(a);
  if (confCmp !== 0) return confCmp;
  const playCmp = resolvePropPlayability(b) - resolvePropPlayability(a);
  if (playCmp !== 0) return playCmp;
  const edgeA = Math.abs(finite(a.edgePercent, finite(a.edge, 0)));
  const edgeB = Math.abs(finite(b.edgePercent, finite(b.edge, 0)));
  return edgeB - edgeA;
}

export { NO_VERIFIED_PLAYS_MESSAGE, passesBestPlayBoardGate, isResearchCandidate, DATA_STATUS };

export function classifyPropTier(prop = {}) {
  if (passesQualificationTierA(prop)) return "A";
  if (passesQualificationTierB(prop)) return "B";
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  if ((Number.isFinite(confidence) && confidence >= 50) || (Number.isFinite(probability) && probability >= 50)) {
    return "C";
  }
  return "RESEARCH";
}

/** Single source of truth — read stored tier on enriched props, compute otherwise. */
export function resolveFinalTier(prop = {}) {
  const stored = String(prop.tier || prop.finalTier || "")
    .trim()
    .toUpperCase()
    .replace(/^TIER\s*/i, "");
  if (["A", "B", "C", "RESEARCH"].includes(stored)) return stored;
  return classifyPropTier(prop);
}

export function resolveFinalTierLabel(prop = {}) {
  return resolveTierDisplayLabel(prop);
}

export function resolveTierDisplayLabel(prop = {}) {
  const tier = resolveFinalTier(prop);
  if (tier === "A") return "Premium";
  if (tier === "B") return "Playable";
  if (tier === "C" || tier === "RESEARCH") return "Research";
  return `Tier ${tier}`;
}

/** Attach tier and sync all legacy tier alias fields. */
export function attachFinalTierFields(prop = {}) {
  const tier = classifyPropTier(prop);
  const finalTier = tier;
  const finalTierLabel = tier === "RESEARCH" ? "Research" : `Tier ${tier}`;
  return {
    ...prop,
    tier,
    finalTier,
    finalTierLabel,
    confidenceTier: tier,
    confidenceTierLabel: finalTierLabel,
    verifiedTier: tier,
    verifiedTierLabel: finalTierLabel,
  };
}

export function countFinalTierPool(pool = []) {
  const counts = { tierA: 0, tierB: 0, tierC: 0, research: 0 };
  for (const prop of pool || []) {
    const tier = resolveFinalTier(prop);
    if (tier === "A") counts.tierA += 1;
    else if (tier === "B") counts.tierB += 1;
    else if (tier === "C") counts.tierC += 1;
    else counts.research += 1;
  }
  return counts;
}

export function logFinalTierTable(pool = [], label = "Final tier audit") {
  const rows = (pool || []).map((prop) => ({
    player: prop.playerName || prop.player || "Unknown",
    confidence: Math.round(resolvePropConfidence(prop)),
    probability: Math.round(resolvePropProbability(prop)),
    playability: Math.round(resolvePropPlayability(prop)),
    finalTier: resolveFinalTier(prop),
  }));
  console.table(rows);
  console.info(`[${label}]`, countFinalTierPool(pool));
  return rows;
}

export function resolvePropTier(prop = {}) {
  return resolveFinalTier(prop);
}

export function passesBestPlayDisplayThresholds(prop = {}) {
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  if (!Number.isFinite(confidence) || confidence < 60) return false;
  if (!Number.isFinite(probability) || probability < 55) return false;
  return true;
}

export function passesBestPlayHardExclusions(prop = {}) {
  const tier = classifyPropTier(prop);
  return tier === "A" || tier === "B";
}

export function passesTierABFullData(prop = {}) {
  const tier = classifyPropTier(prop);
  return tier === "A" || tier === "B";
}

export function passesBestPlayThresholds(prop = {}) {
  return passesQualificationTierB(prop);
}

export function passesBestPlayGate(prop = {}) {
  return passesQualificationTierB(prop);
}

export function resolveBestPlayExclusionReason(prop = {}) {
  const audit = explainTierClassification(prop);
  if (audit.tier === "A" || audit.tier === "B") return "";
  return audit.reason;
}

export function resolveBestPlayThresholdMissReason(prop = {}) {
  return resolveBestPlayExclusionReason(prop);
}

export function buildTierPropAuditRow(prop = {}) {
  const audit = explainTierClassification(prop);
  const finalTier = resolveFinalTier(prop);
  return {
    player: prop.playerName || prop.player || "Unknown",
    market: prop.statType || prop.market || prop.propType || "—",
    confidence: Math.round(resolvePropConfidence(prop)),
    probability: Math.round(resolvePropProbability(prop)),
    playability: Math.round(resolvePropPlayability(prop)),
    tier: finalTier,
    finalTier,
    tierReason: audit.reason,
    sortScore: computeSortScore(prop),
  };
}

export function buildTop10ScoreDiagnostics(pool = [], limit = 10) {
  return [...(pool || [])]
    .map((prop) => buildTierPropAuditRow(prop))
    .sort((a, b) => (b.sortScore ?? 0) - (a.sortScore ?? 0))
    .slice(0, limit)
    .map(({ sortScore, ...row }) => ({
      ...row,
      score: sortScore,
      reason: row.tierReason,
    }));
}

export function buildBestPlayFilterDiagnostics(pool = []) {
  const counts = {
    totalProjected: (pool || []).length,
    fullData: 0,
    partialData: 0,
    tierA: 0,
    tierB: 0,
    tierC: 0,
    tierReviewNeeded: 0,
    rejectedByConfidence: 0,
    rejectedByPlayability: 0,
    rejectedByEdge: 0,
    rejectedByLast10: 0,
    rejectedByTierC: 0,
    qualifiedStrict: 0,
    tierADisplayed: 0,
    tierBDisplayed: 0,
    tierCDisplayed: 0,
    activeTier: "A",
    tierAFullData: 0,
    tierBFullData: 0,
    tierCFullData: 0,
    rejectedByProbability: 0,
    rejectedBySanity: 0,
    missingProjection: 0,
    missingStats: 0,
    tierRejectionLog: [],
    tierPropLog: [],
    top10ByScore: [],
  };

  for (const prop of pool || []) {
    if (isFullDataProp(prop)) counts.fullData += 1;
    else counts.partialData += 1;

    const audit = explainTierClassification(prop);
    const row = buildTierPropAuditRow(prop);
    counts.tierPropLog.push(row);

    if (row.finalTier === "A") {
      counts.tierA += 1;
      counts.tierAFullData += 1;
      counts.qualifiedStrict += 1;
    } else if (row.finalTier === "B") {
      counts.tierB += 1;
      counts.tierBFullData += 1;
      counts.qualifiedStrict += 1;
    } else {
      counts.tierC += 1;
      counts.tierCFullData += 1;
      counts.rejectedByTierC += 1;
      if (audit.tierAFailures.some((entry) => entry.startsWith("confidence"))) counts.rejectedByConfidence += 1;
      if (audit.tierAFailures.some((entry) => entry.startsWith("playability"))) counts.rejectedByPlayability += 1;
      if (audit.tierBFailures.some((entry) => entry.startsWith("probability"))) counts.rejectedByProbability += 1;
      counts.tierRejectionLog.push({
        player: row.player,
        market: row.market,
        tier: row.finalTier,
        reason: audit.reason,
        confidence: row.confidence,
        probability: row.probability,
        playability: row.playability,
        edge: formatTierMetric(resolvePropEdge(prop)),
        last10HitRate: formatTierMetric(resolveLast10HitRate(prop)),
      });
    }
  }

  counts.top10ByScore = buildTop10ScoreDiagnostics(pool);
  logFinalTierTable(pool, "Tier Filter Audit");

  return counts;
}

export function buildBestPlayRejectionSamples(pool = [], limit = 12) {
  return buildBestPlayFilterDiagnostics(pool).tierRejectionLog.slice(0, limit);
}

export function compareBestPlaysRecoveryRank(a = {}, b = {}) {
  return compareSortScore(a, b);
}

function buildBestPlaysTierPools(pool = []) {
  const eligible = (pool || []).filter(
    (prop) =>
      playerKey(prop) &&
      marketKey(prop) &&
      passesBestPlayBoardGate(prop) &&
      passesBestPlayDisplayThresholds(prop)
  );
  const tierA = eligible.filter((prop) => resolveFinalTier(prop) === "A");
  const tierB = eligible.filter((prop) => resolveFinalTier(prop) === "B");
  const tierC = (pool || []).filter(
    (prop) =>
      (resolveFinalTier(prop) === "C" || isResearchCandidate(prop)) &&
      (prop.verificationStatus || resolveVerificationStatus(prop)) !== VERIFICATION_STATUS.UNVERIFIED &&
      passesBestPlayDisplayThresholds(prop)
  );
  const projectedFallback = (pool || [])
    .filter((prop) => {
      const projection = finite(prop.projection ?? prop.projectedValue, NaN);
      return Number.isFinite(projection) && projection > 0;
    })
    .sort((a, b) => resolvePropConfidence(b) - resolvePropConfidence(a));
  return { eligible, tierA, tierB, tierC, projectedFallback, fullData: eligible.filter(isFullDataProp) };
}

function resolveBestPlaysSourcePool({ tierA, tierB, tierC, projectedFallback }) {
  if (tierA.length >= TOP_BEST_PLAYS_TARGET) {
    return {
      sourcePool: tierA,
      activeTier: "A",
      usedFallback: false,
      fallbackNotice: "",
    };
  }
  if (tierA.length > 0) {
    return {
      sourcePool: [...tierA, ...tierB],
      activeTier: "A",
      usedFallback: tierB.length > 0,
      fallbackNotice: tierB.length ? BEST_PLAY_FALLBACK_NOTICE : "",
    };
  }
  if (tierB.length) {
    return {
      sourcePool: tierB,
      activeTier: "B",
      usedFallback: true,
      fallbackNotice: BEST_PLAY_FALLBACK_NOTICE,
    };
  }
  if (tierC?.length) {
    return {
      sourcePool: tierC,
      activeTier: "C",
      usedFallback: true,
      fallbackNotice: TIER_C_FALLBACK_NOTICE,
    };
  }
  if (projectedFallback?.length) {
    return {
      sourcePool: projectedFallback,
      activeTier: "projected",
      usedFallback: true,
      fallbackNotice: PROJECTED_FALLBACK_NOTICE,
    };
  }
  return {
    sourcePool: [],
    activeTier: "none",
    usedFallback: false,
    fallbackNotice: "",
  };
}

function fillBestPlaysToLimit(
  picks = [],
  source = [],
  { limit, maxPerPlayer, maxPerMarket } = {}
) {
  const pickedKeys = new Set(picks.map((prop) => buildPlayerMarketKey(prop)));
  const playerCounts = new Map();
  const marketCounts = new Map();
  for (const prop of picks) {
    const playerKeyValue = playerKey(prop);
    const marketKeyValue = diversityMarketKey(prop);
    if (playerKeyValue) playerCounts.set(playerKeyValue, (playerCounts.get(playerKeyValue) || 0) + 1);
    if (marketKeyValue) marketCounts.set(marketKeyValue, (marketCounts.get(marketKeyValue) || 0) + 1);
  }

  for (const prop of source) {
    if (picks.length >= limit) break;
    const marketKeyValue = buildPlayerMarketKey(prop);
    if (pickedKeys.has(marketKeyValue)) continue;
    const playerKeyValue = playerKey(prop);
    const marketBucket = diversityMarketKey(prop);
    const usedPlayer = playerCounts.get(playerKeyValue) || 0;
    const usedMarket = marketCounts.get(marketBucket) || 0;
    if (usedPlayer >= maxPerPlayer) continue;
    if (usedMarket >= maxPerMarket) continue;
    picks.push(prop);
    pickedKeys.add(marketKeyValue);
    if (playerKeyValue) playerCounts.set(playerKeyValue, usedPlayer + 1);
    if (marketBucket) marketCounts.set(marketBucket, usedMarket + 1);
  }

  return picks;
}

function compareBestPlaysTierRank(a = {}, b = {}) {
  const tierOrder = { A: 0, B: 1, C: 2, RESEARCH: 3, [TIER_REVIEW_NEEDED_LABEL]: 2, D: 4 };
  const tierA = tierOrder[resolveFinalTier(a)] ?? 4;
  const tierB = tierOrder[resolveFinalTier(b)] ?? 4;
  return tierA - tierB;
}

export function buildTopBestPlaysPicks(
  pool = [],
  {
    limit = TOP_BEST_PLAYS_TARGET,
    projectedCount = 0,
    maxPerPlayer = MAX_PLAYER_PROPS_IN_TOP_LIST,
    maxPerMarket = MAX_MARKET_PROPS_IN_TOP_LIST,
  } = {}
) {
  const diagnostics = buildBestPlayFilterDiagnostics(pool);
  const rejectionSamples = buildBestPlayRejectionSamples(pool);
  const tierPools = buildBestPlaysTierPools(pool);
  const { eligible, tierA, tierB } = tierPools;
  const { sourcePool, activeTier, usedFallback, fallbackNotice } = resolveBestPlaysSourcePool(tierPools);
  const strictEligible = [...tierA, ...tierB];
  const rankedSource = applyBestPlayRankConstraints([...sourcePool].sort(compareBestPlaysDisplayRank));
  let picks = applyBestPlaysDiversityFilter(rankedSource, {
    limit,
    maxPerPlayer,
    maxPerMarket,
    minUniquePlayers: MIN_UNIQUE_PLAYERS_TOP_10,
  });

  if (picks.length < limit && sourcePool.length) {
    picks = fillBestPlaysToLimit(picks, [...sourcePool].sort(compareBestPlaysDisplayRank), {
      limit,
      maxPerPlayer,
      maxPerMarket,
    });
  }

  picks = applyBestPlayRankConstraints(
    picks.filter(passesBestPlayDisplayThresholds).slice(0, limit),
    { limit }
  );

  diagnostics.activeTier = activeTier;
  diagnostics.tierADisplayed = picks.filter((prop) => resolveFinalTier(prop) === "A").length;
  diagnostics.tierBDisplayed = picks.filter((prop) => resolveFinalTier(prop) === "B").length;
  diagnostics.tierCDisplayed = picks.filter((prop) => resolveFinalTier(prop) === "C").length;

  const annotatedPicks = picks.map((prop, index) => {
    const propTier = resolveFinalTier(prop);
    const tierAudit = explainTierClassification(prop);
    return annotateBestPlayRankingAudit(
      attachFinalTierFields({
        ...prop,
        sortScore: computeSortScore(prop),
        fallbackRankingScore: computeSortScore(prop),
        bestPlayActiveTier: activeTier,
        bestPlayFilterReason: tierAudit.reason,
        bestPlayUsedFallback: usedFallback || propTier !== activeTier,
      }),
      index + 1
    );
  });

  return {
    picks: annotatedPicks,
    usedFallback,
    fallbackNotice,
    activeTier,
    diagnostics,
    rejectionSamples,
    qualifiedStrict: strictEligible.length,
  };
}

export function classifyConfidenceTier(confidence) {
  const conf = finite(confidence, NaN);
  if (!Number.isFinite(conf)) return "D";
  if (conf >= TIER_A_MIN_CONFIDENCE) return "A";
  if (conf >= TIER_B_MIN_CONFIDENCE) return "B";
  return "C";
}

export function resolvePropConfidence(prop = {}) {
  return finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence, NaN);
}

export function resolvePropPlayability(prop = {}) {
  return finite(prop.playabilityScore ?? prop.playabilityBreakdown?.finalPlayability, NaN);
}

export function resolvePropSanity(prop = {}) {
  return finite(prop.projectionSanityScore ?? prop.projectionSanityAudit?.sanityScore, NaN);
}

export function resolvePropProbability(prop = {}) {
  return finite(prop.probabilityScore ?? prop.verifiedProbability, NaN);
}

export function resolveProjectionGap(prop = {}) {
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(line) || !Number.isFinite(projection)) return 0;
  return line - projection;
}

export function resolveSignedEdge(prop = {}) {
  const edge = finite(prop.edge, NaN);
  if (Number.isFinite(edge)) return edge;
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (Number.isFinite(line) && Number.isFinite(projection)) return projection - line;
  return NaN;
}

export function passesTopFiveEdgeGate(prop = {}) {
  return passesValueOverGate(prop);
}

export function passesValueSideGate(prop = {}) {
  return passesValueOverGate(prop) || passesValueUnderGate(prop);
}

export function passesValueOverGate(prop = {}) {
  const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
  if (verificationStatus === VERIFICATION_STATUS.UNVERIFIED) return false;
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const edge = resolveSignedEdge(prop);
  if (!Number.isFinite(confidence) || confidence < VALUE_MIN_CONFIDENCE) return false;
  if (!Number.isFinite(probability) || probability < VALUE_MIN_PROBABILITY) return false;
  if (!Number.isFinite(edge) || edge <= 0) return false;
  if (resolveRecommendedSide(prop) !== "OVER") return false;
  return true;
}

export function passesTopFiveBestPlayGate(prop = {}) {
  return passesValueOverGate(prop);
}

export function passesSafestPlayGate(prop = {}) {
  const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
  if (verificationStatus === VERIFICATION_STATUS.UNVERIFIED) return false;
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  if (!Number.isFinite(confidence) || confidence < SAFEST_PARTIAL_MIN_CONFIDENCE) return false;
  if (!Number.isFinite(probability) || probability < SAFEST_PARTIAL_MIN_PROBABILITY) return false;
  if (verificationStatus === VERIFICATION_STATUS.FULL) {
    return resolveFinalTier(prop) === "A";
  }
  return allowFallbackVerification && verificationStatus === VERIFICATION_STATUS.PARTIAL;
}

export function passesValueUnderGate(prop = {}) {
  const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
  if (verificationStatus === VERIFICATION_STATUS.UNVERIFIED) return false;
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const edge = resolveSignedEdge(prop);
  if (!Number.isFinite(confidence) || confidence < VALUE_MIN_CONFIDENCE) return false;
  if (!Number.isFinite(probability) || probability < VALUE_MIN_PROBABILITY) return false;
  if (!Number.isFinite(edge) || edge >= 0) return false;
  if (resolveRecommendedSide(prop) !== "UNDER") return false;
  return true;
}

function compareNumericDesc(a = {}, b = {}, resolver = () => 0) {
  return resolver(b) - resolver(a);
}

export function compareOverallPlayRank(a = {}, b = {}) {
  return compareBestPlaysRank(a, b);
}

export function passesOverallPlayVerification(prop = {}) {
  const integrity = prop.integrityAudit || buildIntegrityAudit(prop);
  const sanity = resolvePropSanity(prop) ?? 0;
  return (
    integrity.integrityScore >= 90 &&
    integrity.pitcherIntegrity >= 80 &&
    sanity >= 90 &&
    integrity.tierAEligible
  );
}

export function selectOverallPlay(pool = []) {
  const eligible = (pool || []).filter(passesBestPlayBoardGate);
  const ranked = applyBestPlayRankConstraints(
    eligible.filter((prop) => {
      const flags = resolveBestPlayRankingFlags(prop);
      return !flags.projectionConfidenceLow && !flags.outlierDetected;
    })
  );

  const verifiedCandidate = ranked.find(
    (prop) => passesOverallPlayVerification(prop) && canSelectOverallPlayAtRank(prop, 1)
  );
  if (verifiedCandidate) {
    return { ...verifiedCandidate, overallPlayVerified: true };
  }

  const pitcherVerifiedCandidate = ranked.find(
    (prop) => passesOverallPlayVerification(prop) && (prop.integrityAudit?.pitcherIntegrity ?? 0) > 0
  );
  if (pitcherVerifiedCandidate) {
    return { ...pitcherVerifiedCandidate, overallPlayVerified: true };
  }

  const verifiedAny = ranked.find((prop) => passesOverallPlayVerification(prop));
  if (verifiedAny) {
    return {
      ...verifiedAny,
      overallPlayVerified: false,
      overallPlayPitcherWarning: PITCHER_MATCHUP_NOT_VERIFIED_MESSAGE,
    };
  }

  const best = ranked.find((prop) => canSelectOverallPlayAtRank(prop, 1)) || ranked[0];
  if (!best) return null;

  if ((best.integrityAudit?.pitcherIntegrity ?? buildIntegrityAudit(best).pitcherIntegrity) === 0) {
    return {
      ...best,
      overallPlayVerified: false,
      overallPlayPitcherWarning: PITCHER_MATCHUP_NOT_VERIFIED_MESSAGE,
    };
  }

  return { ...best, overallPlayVerified: false };
}

export function buildOverallPlayExplanation(prop = {}) {
  if (prop.overallPlayPitcherWarning) {
    return prop.overallPlayPitcherWarning;
  }
  if (prop.overallPlayVerified === false) {
    return OVERALL_PLAY_PENDING_MESSAGE;
  }
  const confidence = Math.round(resolvePropConfidence(prop));
  const probability = Math.round(
    resolvePropProbability(prop) ??
      prop.calibratedProbability ??
      prop.probabilityTruth?.calibratedProbability ??
      0
  );
  const playability = Math.round(resolvePropPlayability(prop));
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  let projectionLabel = "Projection aligned with line";
  if (Number.isFinite(line) && Number.isFinite(projection)) {
    const gap = Math.round((projection - line) * 10) / 10;
    projectionLabel =
      gap > 0
        ? `Projection +${gap} over line`
        : gap < 0
          ? `Projection ${gap} under line`
          : "Projection aligned with line";
  }
  const tier = classifyPropTier(prop);
  const dataLabel = isFullDataProp(prop) ? "Full MLB data" : "Partial MLB data";
  return `Why ranked #1: Confidence ${confidence}% · Probability ${probability}% · Playability ${playability} · ${projectionLabel} · Tier ${tier} · ${dataLabel}`;
}

export function compareSafestPlaysRank(a = {}, b = {}) {
  const scoreCmp = compareSortScore(a, b);
  if (scoreCmp !== 0) return scoreCmp;
  return compareNumericDesc(a, b, resolvePropConfidence);
}

export function compareValueUndersRank(a = {}, b = {}) {
  const edgeA = resolveSignedEdge(a);
  const edgeB = resolveSignedEdge(b);
  if (Number.isFinite(edgeA) && Number.isFinite(edgeB) && edgeA !== edgeB) {
    return edgeA - edgeB;
  }
  return (
    compareNumericDesc(a, b, resolvePropConfidence) ||
    compareNumericDesc(a, b, resolvePropProbability) ||
    compareNumericDesc(a, b, resolvePropPlayability)
  );
}

export function buildSafestPlaysSection(pool = [], { limit = TOP_SECTION_LIMIT } = {}) {
  const strictPool = dedupeByPlayerMarketBestScore(pool);
  const strictPicks = buildTopSectionPicks(strictPool, {
    compareFn: compareSafestPlaysRank,
    limit,
    filterFn: passesSafestPlayGate,
  });
  if (strictPicks.length) {
    return { picks: strictPicks, usedFallback: false, fallbackNotice: "" };
  }

  const fallbackPicks = buildTopSectionPicks(strictPool, {
    compareFn: compareSafestPlaysRank,
    limit,
    filterFn: (prop = {}) => {
      const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
      if (verificationStatus === VERIFICATION_STATUS.UNVERIFIED) return false;
      const confidence = resolvePropConfidence(prop);
      const probability = resolvePropProbability(prop);
      return (
        Number.isFinite(confidence) &&
        confidence >= SAFEST_PARTIAL_MIN_CONFIDENCE &&
        Number.isFinite(probability) &&
        probability >= SAFEST_PARTIAL_MIN_PROBABILITY
      );
    },
  });

  return {
    picks: fallbackPicks,
    usedFallback: Boolean(fallbackPicks.length),
    fallbackNotice: fallbackPicks.length ? SAFEST_FALLBACK_NOTICE : "",
  };
}

export function buildValueUndersSection(pool = [], { limit = VALUE_SECTION_LIMIT } = {}) {
  const strictPool = dedupeByPlayerMarketBestScore(pool);
  const picks = buildTopSectionPicks(strictPool, {
    compareFn: compareValueUndersRank,
    side: "UNDER",
    limit,
    filterFn: passesValueUnderGate,
  });
  if (picks.length) {
    return { picks, fallbackNotice: "", usedFallback: false };
  }

  const fallbackPicks = buildTopSectionPicks(strictPool, {
    compareFn: compareValueUndersRank,
    side: "UNDER",
    limit,
    filterFn: (prop = {}) => {
      const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
      return verificationStatus !== VERIFICATION_STATUS.UNVERIFIED && resolveSignedEdge(prop) < 0;
    },
  });

  return {
    picks: fallbackPicks,
    fallbackNotice: fallbackPicks.length ? "Showing best available under plays." : "",
    usedFallback: Boolean(fallbackPicks.length),
  };
}

export function buildValueOversSection(pool = [], { limit = VALUE_SECTION_LIMIT } = {}) {
  const strictPool = dedupeByPlayerMarketBestScore(pool);
  const picks = buildTopSectionPicks(strictPool, {
    compareFn: compareValueSidePlaysRank,
    side: "OVER",
    limit,
    filterFn: passesValueOverGate,
  });
  if (picks.length) {
    return { picks, fallbackNotice: "", usedFallback: false };
  }

  const fallbackPicks = buildTopSectionPicks(strictPool, {
    compareFn: compareValueSidePlaysRank,
    side: "OVER",
    limit,
    filterFn: (prop = {}) => {
      const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
      return verificationStatus !== VERIFICATION_STATUS.UNVERIFIED && resolveSignedEdge(prop) > 0;
    },
  });

  return {
    picks: fallbackPicks,
    fallbackNotice: fallbackPicks.length ? "Showing best available over plays." : "",
    usedFallback: Boolean(fallbackPicks.length),
  };
}

export function resolveProjectionConfidenceLevel(prop = {}) {
  const hasMlbStats = Boolean(
    prop.historicalStatsAttached ||
      prop.hasGameLogs ||
      prop.historicalDataPresent ||
      Number(prop.gameLogCount) >= 3
  );
  const hasSportsDataIo = Boolean(
    /sportsdata/i.test(String(prop.projectionSource || "")) ||
      prop.sportsDataGames != null ||
      prop.sportsDataRawStat != null ||
      prop.sportsDataPropLabel
  );
  const hasStatsApi = Boolean(
    prop.hasVerifiedStats ||
      prop.statsProfile ||
      prop.historicalCoverage === true ||
      Number(prop.sampleSize) >= 5
  );

  const available = [hasMlbStats, hasSportsDataIo, hasStatsApi].filter(Boolean).length;
  if (available >= 3) return "HIGH";
  if (available === 2) return "MEDIUM";
  return "LOW";
}

export function attachBoardQualityFields(prop = {}) {
  const withPitcherPenalty = applyPitcherPendingConfidencePenalty(prop);
  const withPitcherNormalized = normalizePropPitcherFields(withPitcherPenalty);
  const edgeLabels = formatValidatedEdgeDisplay(withPitcherNormalized);
  const fullDataReason = resolveFullDataReason(withPitcherNormalized);
  const withSeason = attachSeasonHitRateFields(withPitcherNormalized);
  const withIntegrityAudit = attachIntegrityAuditFields(withSeason);
  const withIntegrity = attachDataIntegrityFields(withIntegrityAudit);
  const normalized = normalizeBoardProp(withIntegrity);
  const fullData = normalized.dataStatus === DATA_STATUS.FULL_MLB_DATA;
  const dataQualityBadge = resolveBoardDataQualityBadge({ ...normalized, isFullData: fullData, partialData: !fullData });
  const propTier = classifyPropTier(normalized);
  return attachFinalTierFields(
    attachVerificationStatusFields({
      ...normalized,
      ...edgeLabels,
      rawEdgeLabel: edgeLabels.rawEdgeLabel,
      displayEdgeLabel: edgeLabels.displayEdgeLabel,
      edgePercent: edgeLabels.edgePercent ?? withPitcherPenalty.edgePercent,
      projectionConfidenceLevel: resolveProjectionConfidenceLevel(normalized),
      fullDataReason,
      isFullData: fullData,
      partialData: !fullData,
      reviewNeeded:
        hasIntegrityReviewFlags(withIntegrityAudit) ||
        propTier === TIER_REVIEW_NEEDED_LABEL ||
        normalized.cardPlayLabel === "Review Needed",
      dataQualityBadge,
      dataQualityLabel: dataQualityBadge.label,
    })
  );
}

export function resolveRecommendedSide(prop = {}) {
  const side = String(prop.recommendedSide || prop.lean || prop.pick || prop.side || "").toUpperCase();
  if (side.includes("UNDER") || side.includes("LESS")) return "UNDER";
  if (side.includes("OVER") || side.includes("MORE")) return "OVER";
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  const line = finite(prop.line, NaN);
  if (Number.isFinite(projection) && Number.isFinite(line) && projection !== line) {
    return projection > line ? "OVER" : "UNDER";
  }
  return "PASS";
}

function compareHighestEdgePlays(a = {}, b = {}) {
  const edgeA = Math.abs(computeValidatedEdgePercent(a) ?? 0);
  const edgeB = Math.abs(computeValidatedEdgePercent(b) ?? 0);
  return edgeB - edgeA;
}

function compareValueSidePlays(a = {}, b = {}) {
  const confCmp = resolvePropConfidence(b) - resolvePropConfidence(a);
  if (confCmp !== 0) return confCmp;
  const edgeA = resolveSignedEdge(a);
  const edgeB = resolveSignedEdge(b);
  if (Number.isFinite(edgeA) && Number.isFinite(edgeB) && edgeA !== edgeB) {
    return edgeB - edgeA;
  }
  return (
    finite(b.probabilityScore ?? b.verifiedProbability, 0) -
    finite(a.probabilityScore ?? a.verifiedProbability, 0)
  );
}

export function buildTopSectionPicks(
  pool = [],
  { compareFn, side = "", limit = TOP_SECTION_LIMIT, filterFn = null } = {}
) {
  let rows = [...pool];
  if (filterFn) rows = rows.filter(filterFn);
  if (side === "UNDER" || side === "OVER") {
    rows = rows.filter((prop) => resolveRecommendedSide(prop) === side);
  }
  return applyPlayerDiversityFilter(rows.sort(compareFn), {
    limit,
    maxPerPlayer: MAX_PLAYER_PROPS_IN_TOP_LIST,
  });
}

export const compareHighestEdgePlaysRank = compareHighestEdgePlays;
export const compareValueSidePlaysRank = compareValueSidePlays;
