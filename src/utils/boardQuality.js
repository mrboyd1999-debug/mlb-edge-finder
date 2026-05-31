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
import { STARTER_PENDING_LABEL } from "./opponentStarter.js";

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
  "No Tier A/B plays today — showing highest scoring Tier C plays.";
export const REVIEW_NEEDED_FALLBACK_NOTICE = TIER_C_FALLBACK_NOTICE;
export const PITCHER_PENDING_CONFIDENCE_PENALTY = 10;
export const PITCHER_PENDING_TAG = "Pitcher Pending";
export const FALLBACK_RANK_WEIGHTS = {
  confidence: 0.35,
  probability: 0.35,
  playability: 0.2,
  sanity: 0.1,
};
export const TIER_A_MIN_CONFIDENCE = 75;
export const TIER_A_MIN_PLAYABILITY = 80;
export const TIER_A_MIN_EDGE = 0.5;
export const TIER_A_MIN_LAST10_HIT_RATE = 60;
export const TIER_B_MIN_CONFIDENCE = 65;
export const TIER_B_MIN_PLAYABILITY = 70;
export const TIER_B_MIN_EDGE = 0.3;
export const TIER_B_MIN_LAST10_HIT_RATE = 50;
/** Legacy probability gates — not used for A/B/C tier classification. */
export const TIER_A_MIN_PROBABILITY = 65;
export const TIER_B_MIN_PROBABILITY = 55;
export const TIER_REVIEW_MIN_CONFIDENCE = TIER_B_MIN_CONFIDENCE;
export const TIER_REVIEW_MIN_PROBABILITY = TIER_B_MIN_PROBABILITY;
export const TIER_REVIEW_MIN_PLAYABILITY = TIER_B_MIN_PLAYABILITY;
export const TIER_A_MIN_SANITY = 90;
export const TIER_A_MIN_PITCHER_INTEGRITY = 70;
export const TIER_B_MIN_SANITY = 85;
export const BEST_PLAY_MIN_CONFIDENCE = TIER_REVIEW_MIN_CONFIDENCE;
export const BEST_PLAY_MIN_PROBABILITY = TIER_REVIEW_MIN_PROBABILITY;
export const BEST_PLAY_MIN_PLAYABILITY = TIER_REVIEW_MIN_PLAYABILITY;
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
  return resolveMissingFullDataFields(prop).length === 0;
}

export function resolveBoardDataQualityLabel(prop = {}) {
  return isFullDataProp(prop) ? "Full MLB Data" : "Partial Data";
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
  const confidence = resolvePropConfidence(prop);
  const playability = resolvePropPlayability(prop);
  const edge = resolvePropEdge(prop);
  const last10 = resolveLast10HitRate(prop);

  if (!Number.isFinite(confidence) || confidence < TIER_A_MIN_CONFIDENCE) {
    failures.push(`confidence ${formatTierMetric(confidence)} < ${TIER_A_MIN_CONFIDENCE}`);
  }
  if (!Number.isFinite(playability) || playability < TIER_A_MIN_PLAYABILITY) {
    failures.push(`playability ${formatTierMetric(playability)} < ${TIER_A_MIN_PLAYABILITY}`);
  }
  if (!Number.isFinite(edge) || edge < TIER_A_MIN_EDGE) {
    failures.push(`edge ${formatTierMetric(edge)} < ${TIER_A_MIN_EDGE}`);
  }
  if (!Number.isFinite(last10) || last10 < TIER_A_MIN_LAST10_HIT_RATE) {
    failures.push(`last10 hit rate ${formatTierMetric(last10)} < ${TIER_A_MIN_LAST10_HIT_RATE}`);
  }
  return failures;
}

export function getTierBFailures(prop = {}) {
  const failures = [];
  const confidence = resolvePropConfidence(prop);
  const playability = resolvePropPlayability(prop);
  const edge = resolvePropEdge(prop);
  const last10 = resolveLast10HitRate(prop);

  if (!Number.isFinite(confidence) || confidence < TIER_B_MIN_CONFIDENCE) {
    failures.push(`confidence ${formatTierMetric(confidence)} < ${TIER_B_MIN_CONFIDENCE}`);
  }
  if (!Number.isFinite(playability) || playability < TIER_B_MIN_PLAYABILITY) {
    failures.push(`playability ${formatTierMetric(playability)} < ${TIER_B_MIN_PLAYABILITY}`);
  }
  if (!Number.isFinite(edge) || edge < TIER_B_MIN_EDGE) {
    failures.push(`edge ${formatTierMetric(edge)} < ${TIER_B_MIN_EDGE}`);
  }
  if (!Number.isFinite(last10) || last10 < TIER_B_MIN_LAST10_HIT_RATE) {
    failures.push(`last10 hit rate ${formatTierMetric(last10)} < ${TIER_B_MIN_LAST10_HIT_RATE}`);
  }
  return failures;
}

export function explainTierClassification(prop = {}) {
  const tierAFailures = getTierAFailures(prop);
  const tierBFailures = getTierBFailures(prop);
  const tier = passesQualificationTierA(prop) ? "A" : passesQualificationTierB(prop) ? "B" : "C";
  let reason = "";
  if (tier === "A") {
    reason = "Qualified Tier A";
  } else if (tier === "B") {
    reason = `Tier A failed: ${tierAFailures.join("; ") || "unknown"}`;
  } else {
    reason = `Tier A failed: ${tierAFailures.join("; ") || "unknown"}; Tier B failed: ${
      tierBFailures.join("; ") || "unknown"
    }`;
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

export function classifyPropTier(prop = {}) {
  if (passesQualificationTierA(prop)) return "A";
  if (passesQualificationTierB(prop)) return "B";
  return "C";
}

export function resolvePropTier(prop = {}) {
  return prop.confidenceTier || classifyPropTier(prop);
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
    // legacy aliases for existing UI
    tierAFullData: 0,
    tierBFullData: 0,
    tierCFullData: 0,
    rejectedByProbability: 0,
    rejectedBySanity: 0,
    missingProjection: 0,
    missingStats: 0,
    tierRejectionLog: [],
  };

  for (const prop of pool || []) {
    if (isFullDataProp(prop)) counts.fullData += 1;
    else counts.partialData += 1;

    const audit = explainTierClassification(prop);
    if (audit.tier === "A") {
      counts.tierA += 1;
      counts.tierAFullData += 1;
      counts.qualifiedStrict += 1;
    } else if (audit.tier === "B") {
      counts.tierB += 1;
      counts.tierBFullData += 1;
      counts.qualifiedStrict += 1;
    } else {
      counts.tierC += 1;
      counts.tierCFullData += 1;
      counts.rejectedByTierC += 1;
      if (audit.tierAFailures.some((row) => row.startsWith("confidence"))) counts.rejectedByConfidence += 1;
      if (audit.tierAFailures.some((row) => row.startsWith("playability"))) counts.rejectedByPlayability += 1;
      if (audit.tierBFailures.some((row) => row.startsWith("edge"))) counts.rejectedByEdge += 1;
      if (audit.tierBFailures.some((row) => row.startsWith("last10"))) counts.rejectedByLast10 += 1;
      counts.tierRejectionLog.push({
        player: prop.playerName || prop.player || "Unknown",
        market: prop.statType || prop.market || prop.propType || "—",
        tier: audit.tier,
        reason: audit.reason,
        confidence: Math.round(resolvePropConfidence(prop)),
        playability: Math.round(resolvePropPlayability(prop)),
        edge: formatTierMetric(resolvePropEdge(prop)),
        last10HitRate: formatTierMetric(resolveLast10HitRate(prop)),
      });
      console.info(
        `[Tier Filter] ${prop.playerName || prop.player || "Unknown"} rejected: ${audit.reason}`
      );
    }
  }

  return counts;
}

export function buildBestPlayRejectionSamples(pool = [], limit = 12) {
  return buildBestPlayFilterDiagnostics(pool).tierRejectionLog.slice(0, limit);
}

export function compareBestPlaysRecoveryRank(a = {}, b = {}) {
  return compareSortScore(a, b);
}

function buildBestPlaysTierPools(pool = []) {
  const eligible = (pool || []).filter((prop) => playerKey(prop) && marketKey(prop));
  const tierA = eligible.filter(passesQualificationTierA);
  const tierB = eligible.filter((prop) => passesQualificationTierB(prop) && !passesQualificationTierA(prop));
  const tierC = eligible.filter((prop) => !passesQualificationTierB(prop));
  return { eligible, tierA, tierB, tierC, fullData: eligible.filter(isFullDataProp) };
}

function resolveBestPlaysSourcePool({ tierA, tierB, tierC }) {
  if (tierA.length) {
    return {
      sourcePool: tierA,
      activeTier: "A",
      usedFallback: false,
      fallbackNotice: "",
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
  return {
    sourcePool: tierC,
    activeTier: "C",
    usedFallback: true,
    fallbackNotice: TIER_C_FALLBACK_NOTICE,
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
  const tierOrder = { A: 0, B: 1, [TIER_REVIEW_NEEDED_LABEL]: 2, C: 3, D: 4 };
  const tierA = tierOrder[classifyPropTier(a)] ?? 4;
  const tierB = tierOrder[classifyPropTier(b)] ?? 4;
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
  const { eligible, tierA, tierB, tierC, fullData } = tierPools;
  const { sourcePool, activeTier, usedFallback, fallbackNotice } = resolveBestPlaysSourcePool(tierPools);
  const strictEligible = [...tierA, ...tierB];
  const rankedSource = applyBestPlayRankConstraints([...sourcePool].sort(compareSortScore));
  let picks = applyBestPlaysDiversityFilter(rankedSource, {
    limit,
    maxPerPlayer,
    maxPerMarket,
    minUniquePlayers: MIN_UNIQUE_PLAYERS_TOP_10,
  });

  if (picks.length < limit) {
    picks = fillBestPlaysToLimit(picks, [...sourcePool].sort(compareSortScore), {
      limit,
      maxPerPlayer,
      maxPerMarket,
    });
  }

  if (picks.length < limit && tierC.length > 0 && activeTier !== "C") {
    picks = fillBestPlaysToLimit(picks, [...tierC].sort(compareSortScore), {
      limit,
      maxPerPlayer,
      maxPerMarket,
    });
  }

  if (picks.length < limit && eligible.length > 0) {
    picks = fillBestPlaysToLimit(picks, [...eligible].sort(compareSortScore), {
      limit,
      maxPerPlayer,
      maxPerMarket,
    });
  }

  if (eligible.length > 0 && picks.length === 0) {
    picks = applyBestPlaysDiversityFilter([...eligible].sort(compareSortScore), {
      limit,
      maxPerPlayer,
      maxPerMarket,
      minUniquePlayers: MIN_UNIQUE_PLAYERS_TOP_10,
    });
  }

  picks = applyBestPlayRankConstraints(picks.slice(0, limit), { limit });

  diagnostics.activeTier = activeTier;
  diagnostics.tierADisplayed = picks.filter((prop) => classifyPropTier(prop) === "A").length;
  diagnostics.tierBDisplayed = picks.filter((prop) => classifyPropTier(prop) === "B").length;
  diagnostics.tierCDisplayed = picks.filter((prop) => classifyPropTier(prop) === "C").length;

  const annotatedPicks = picks.map((prop, index) => {
    const propTier = classifyPropTier(prop);
    const tierAudit = explainTierClassification(prop);
    return annotateBestPlayRankingAudit(
      {
        ...prop,
        sortScore: computeSortScore(prop),
        fallbackRankingScore: computeSortScore(prop),
        bestPlayActiveTier: activeTier,
        bestPlayFilterReason: tierAudit.reason,
        bestPlayUsedFallback: usedFallback || propTier !== activeTier,
      },
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

export function passesTopFiveEdgeGate(prop = {}) {
  return isFullDataProp(prop);
}

export function passesValueSideGate(prop = {}) {
  if (!isFullDataProp(prop)) return false;
  const tier = classifyPropTier(prop);
  return tier === "A" || tier === "B";
}

export function passesTopFiveBestPlayGate(prop = {}) {
  return passesValueSideGate(prop);
}

export function passesSafestPlayGate(prop = {}) {
  if (!isFullDataProp(prop)) return false;
  return passesQualificationTierA(prop);
}

export function passesValueUnderGate(prop = {}) {
  if (!passesValueSideGate(prop)) return false;
  const lean = String(prop.lean || prop.pick || prop.side || "").toLowerCase();
  const side = resolveRecommendedSide(prop);
  const isUnder = side === "UNDER" || /under|less|lower/.test(lean);
  if (!isUnder) return false;
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(line) || !Number.isFinite(projection) || projection >= line) return false;
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
  const eligible = (pool || []).filter(isFullDataProp);
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
  return (
    compareNumericDesc(a, b, resolvePropConfidence) ||
    compareNumericDesc(a, b, resolveProjectionGap) ||
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
  return {
    picks: strictPicks,
    usedFallback: false,
    fallbackNotice: strictPicks.length ? "" : SAFEST_FALLBACK_NOTICE,
  };
}

export function buildValueUndersSection(pool = [], { limit = TOP_SECTION_LIMIT } = {}) {
  const picks = buildTopSectionPicks(dedupeByPlayerMarketBestScore(pool), {
    compareFn: compareValueUndersRank,
    side: "UNDER",
    limit,
    filterFn: passesValueUnderGate,
  });
  return { picks, fallbackNotice: "", usedFallback: false };
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
  const edgeLabels = formatValidatedEdgeDisplay(withPitcherPenalty);
  const fullDataReason = resolveFullDataReason(withPitcherPenalty);
  const fullData = isFullDataProp(withPitcherPenalty);
  const withSeason = attachSeasonHitRateFields(withPitcherPenalty);
  const withIntegrityAudit = attachIntegrityAuditFields(withSeason);
  const propTier = classifyPropTier(withIntegrityAudit);
  const withIntegrity = attachDataIntegrityFields(withIntegrityAudit);
  const dataQualityBadge = resolveBoardDataQualityBadge({ ...withIntegrity, isFullData: fullData, partialData: !fullData });
  return {
    ...withIntegrity,
    ...edgeLabels,
    rawEdgeLabel: edgeLabels.rawEdgeLabel,
    displayEdgeLabel: edgeLabels.displayEdgeLabel,
    edgePercent: edgeLabels.edgePercent ?? withPitcherPenalty.edgePercent,
    projectionConfidenceLevel: resolveProjectionConfidenceLevel(withIntegrity),
    fullDataReason,
    isFullData: fullData,
    partialData: !fullData,
    confidenceTier: propTier,
    confidenceTierLabel:
      propTier === TIER_REVIEW_NEEDED_LABEL ? TIER_REVIEW_NEEDED_LABEL : `Tier ${propTier}`,
    reviewNeeded: hasIntegrityReviewFlags(withIntegrityAudit) || propTier === TIER_REVIEW_NEEDED_LABEL,
    dataStatus: fullData ? "FULL_DATA" : "PARTIAL_DATA",
    dataQualityBadge,
    dataQualityLabel: dataQualityBadge.label,
  };
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
  return (
    compareHighestEdgePlays(a, b) ||
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
