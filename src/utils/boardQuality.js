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
import { attachIntegrityAuditFields, buildIntegrityAudit } from "./integrityAudit.js";
import { resolveVerifiedHitRateSnapshot } from "./verifiedHitRates.js";

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
  "Filled remaining Best Plays slots from Tier A/B full-data pool.";
export const BEST_PLAY_MIN_CONFIDENCE = 65;
export const BEST_PLAY_MIN_PROBABILITY = 60;
export const BEST_PLAY_MIN_PLAYABILITY = 60;
export const BEST_PLAY_MIN_SANITY = 80;
export const MIN_UNIQUE_PLAYERS_TOP_10 = 5;
export const MIN_PROJECTED_PROPS_FOR_BEST_PLAYS = 20;
export const TOP_BEST_PLAYS_TARGET = 10;
export const CONFIDENCE_CALIBRATION_MIN = 50;
export const CONFIDENCE_CALIBRATION_MAX = 95;
export const TIER_A_MIN_CONFIDENCE = 75;
export const TIER_A_MIN_PLAYABILITY = 70;
export const TIER_A_MIN_SANITY = 80;
export const TIER_B_MIN_CONFIDENCE = 65;
export const TIER_B_MIN_PLAYABILITY = 60;

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

export function classifyPropTier(prop = {}) {
  const integrity = prop.integrityAudit || buildIntegrityAudit(prop);
  const confidence = resolvePropConfidence(prop);
  const playability = resolvePropPlayability(prop);
  const sanity = resolvePropSanity(prop);
  const snapshot = resolveVerifiedHitRateSnapshot(prop);
  const seasonAvailable =
    Boolean(prop.seasonRateValid) ||
    (integrity.seasonDataIntegrity >= 80 && snapshot.seasonLabel !== "—" && snapshot.seasonLabel !== "0%");
  const recentAvailable = snapshot.last5Label !== "—" || snapshot.last10Label !== "—";
  const projectionAvailable = finite(prop.projection ?? prop.projectedValue) != null;
  const opponentAvailable = Boolean(String(prop.opponent || "").trim());

  if (
    integrity.reviewNeeded ||
    integrity.hitRateInvalid ||
    integrity.probabilityMismatch ||
    integrity.dataIntegrityWarning
  ) {
    return TIER_REVIEW_NEEDED_LABEL;
  }

  let tier = "C";
  if (confidence >= TIER_B_MIN_CONFIDENCE && playability >= TIER_B_MIN_PLAYABILITY) {
    tier = "B";
  }

  const qualifiesA =
    confidence >= TIER_A_MIN_CONFIDENCE &&
    playability >= TIER_A_MIN_PLAYABILITY &&
    sanity >= TIER_A_MIN_SANITY &&
    seasonAvailable &&
    recentAvailable &&
    projectionAvailable &&
    opponentAvailable &&
    integrity.tierAEligible;

  if (qualifiesA) {
    tier = "A";
  } else if (
    confidence >= TIER_A_MIN_CONFIDENCE &&
    playability >= TIER_A_MIN_PLAYABILITY &&
    sanity >= TIER_A_MIN_SANITY &&
    !seasonAvailable
  ) {
    tier = "B";
  }

  return tier;
}

export function resolvePropTier(prop = {}) {
  return prop.confidenceTier || classifyPropTier(prop);
}

export function passesBestPlayHardExclusions(prop = {}) {
  if (!isFullDataProp(prop)) return false;
  const tier = classifyPropTier(prop);
  if (tier === "C" || tier === TIER_REVIEW_NEEDED_LABEL) return false;
  return true;
}

export function passesTierABFullData(prop = {}) {
  if (!isFullDataProp(prop)) return false;
  const tier = classifyPropTier(prop);
  return tier === "A" || tier === "B";
}

export function passesBestPlayThresholds(prop = {}) {
  if (resolvePropConfidence(prop) < BEST_PLAY_MIN_CONFIDENCE) return false;
  if (resolvePropProbability(prop) < BEST_PLAY_MIN_PROBABILITY) return false;
  if (resolvePropPlayability(prop) < BEST_PLAY_MIN_PLAYABILITY) return false;
  return true;
}

export function passesBestPlayGate(prop = {}) {
  if (!passesBestPlayHardExclusions(prop)) return false;
  return passesBestPlayThresholds(prop);
}

export function resolveBestPlayExclusionReason(prop = {}) {
  if (!isFullDataProp(prop)) {
    const detail = resolveFullDataReason(prop).replace(/^PARTIAL_DATA:\s*/, "");
    return detail ? `Excluded: Partial Data (${detail})` : "Excluded: Partial Data";
  }
  const tier = classifyPropTier(prop);
  if (tier === "C") return "Excluded: Tier C";
  const confidence = resolvePropConfidence(prop);
  if (confidence < BEST_PLAY_MIN_CONFIDENCE) return "Excluded: Confidence below threshold";
  if (resolvePropProbability(prop) < BEST_PLAY_MIN_PROBABILITY) return "Excluded: Probability below threshold";
  if (resolvePropPlayability(prop) < BEST_PLAY_MIN_PLAYABILITY) return "Excluded: Playability below threshold";
  return "";
}

export function resolveBestPlayThresholdMissReason(prop = {}) {
  if (!passesTierABFullData(prop)) return resolveBestPlayExclusionReason(prop);
  const misses = [];
  if (resolvePropConfidence(prop) < BEST_PLAY_MIN_CONFIDENCE) misses.push("Confidence below threshold");
  if (resolvePropProbability(prop) < BEST_PLAY_MIN_PROBABILITY) misses.push("Probability below threshold");
  if (resolvePropPlayability(prop) < BEST_PLAY_MIN_PLAYABILITY) misses.push("Playability below threshold");
  if (!misses.length) return "";
  return `Excluded: ${misses.join(", ")}`;
}

export function buildBestPlayFilterDiagnostics(pool = []) {
  const counts = {
    totalProjected: (pool || []).length,
    fullData: 0,
    partialData: 0,
    tierA: 0,
    tierB: 0,
    tierC: 0,
    rejectedByConfidence: 0,
    rejectedByProbability: 0,
    rejectedByPlayability: 0,
    rejectedByTierC: 0,
    qualifiedStrict: 0,
    // legacy aliases for existing UI
    tierAFullData: 0,
    tierBFullData: 0,
    tierCFullData: 0,
    missingProjection: 0,
    missingStats: 0,
  };

  for (const prop of pool || []) {
    if (!isFullDataProp(prop)) {
      counts.partialData += 1;
      const missing = resolveMissingFullDataFields(prop);
      if (missing.includes("projection")) counts.missingProjection += 1;
      continue;
    }

    counts.fullData += 1;
    const tier = classifyPropTier(prop);
    if (tier === "A") {
      counts.tierA += 1;
      counts.tierAFullData += 1;
    } else if (tier === "B") {
      counts.tierB += 1;
      counts.tierBFullData += 1;
    } else {
      counts.tierC += 1;
      counts.tierCFullData += 1;
      counts.rejectedByTierC += 1;
    }

    if (tier === "C") continue;

    if (resolvePropConfidence(prop) < BEST_PLAY_MIN_CONFIDENCE) counts.rejectedByConfidence += 1;
    if (resolvePropProbability(prop) < BEST_PLAY_MIN_PROBABILITY) counts.rejectedByProbability += 1;
    if (resolvePropPlayability(prop) < BEST_PLAY_MIN_PLAYABILITY) counts.rejectedByPlayability += 1;
    if (passesBestPlayGate(prop)) counts.qualifiedStrict += 1;
  }

  return counts;
}

export function buildBestPlayRejectionSamples(pool = [], limit = 12) {
  return [...(pool || [])]
    .map((prop) => ({
      player: prop.playerName || prop.player || "Unknown",
      market: prop.statType || prop.market || prop.propType || "—",
      reason: resolveBestPlayExclusionReason(prop) || resolveBestPlayThresholdMissReason(prop),
      fullDataReason: prop.fullDataReason || resolveFullDataReason(prop),
      confidence: Math.round(resolvePropConfidence(prop)),
      probability: Math.round(resolvePropProbability(prop)),
    }))
    .filter((row) => row.reason && row.reason.startsWith("Excluded"))
    .slice(0, limit);
}

export function compareBestPlaysRecoveryRank(a = {}, b = {}) {
  return compareBestPlaysRank(a, b);
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
  const strictEligible = (pool || []).filter(passesBestPlayGate);
  const strictSorted = applyBestPlayRankConstraints(
    [...strictEligible].sort(compareBestPlaysRecoveryRank)
  );
  let picks = applyBestPlaysDiversityFilter(strictSorted, {
    limit,
    maxPerPlayer,
    maxPerMarket,
    minUniquePlayers: MIN_UNIQUE_PLAYERS_TOP_10,
  });
  picks = applyBestPlayRankConstraints(picks, { limit });

  const shouldFill =
    picks.length < limit &&
    (Number(projectedCount) >= MIN_PROJECTED_PROPS_FOR_BEST_PLAYS || diagnostics.fullData > 0);
  let usedFallback = false;

  if (shouldFill) {
    const fallbackPool = [...(pool || [])].filter(passesTierABFullData).sort(compareBestPlaysRecoveryRank);
    const pickedKeys = new Set(picks.map((prop) => buildPlayerMarketKey(prop)));
    const playerCounts = new Map();
    const marketCounts = new Map();
    for (const prop of picks) {
      const playerKeyValue = playerKey(prop);
      const marketKeyValue = diversityMarketKey(prop);
      if (playerKeyValue) playerCounts.set(playerKeyValue, (playerCounts.get(playerKeyValue) || 0) + 1);
      if (marketKeyValue) marketCounts.set(marketKeyValue, (marketCounts.get(marketKeyValue) || 0) + 1);
    }

    for (const prop of fallbackPool) {
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
      usedFallback = true;
    }
  }

  if (diagnostics.fullData > 0 && picks.length === 0) {
    const rescuePool = [...(pool || [])].filter(passesTierABFullData).sort(compareBestPlaysRecoveryRank);
    picks = applyBestPlaysDiversityFilter(rescuePool, {
      limit,
      maxPerPlayer,
      maxPerMarket,
      minUniquePlayers: MIN_UNIQUE_PLAYERS_TOP_10,
    });
    usedFallback = rescuePool.length > 0;
  }

  const annotatedPicks = picks.map((prop, index) => {
    const strictPass = passesBestPlayGate(prop);
    return annotateBestPlayRankingAudit(
      {
        ...prop,
        bestPlayFilterReason: strictPass
          ? ""
          : resolveBestPlayThresholdMissReason(prop) || "Included via Tier A/B fallback",
        bestPlayUsedFallback: !strictPass,
      },
      index + 1
    );
  });

  return {
    picks: annotatedPicks,
    usedFallback,
    fallbackNotice: usedFallback ? BEST_PLAY_FALLBACK_NOTICE : "",
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

export function passesTopFiveBestPlayGate(prop = {}) {
  return passesBestPlayGate(prop);
}

export function passesSafestPlayGate(prop = {}) {
  if (!passesBestPlayHardExclusions(prop)) return false;
  if (resolvePropConfidence(prop) < SAFEST_MIN_CONFIDENCE) return false;
  if (resolvePropProbability(prop) < SAFEST_MIN_PROBABILITY) return false;
  if (resolvePropPlayability(prop) < SAFEST_MIN_PLAYABILITY) return false;
  if (resolvePropSanity(prop) < SAFEST_MIN_SANITY) return false;
  return true;
}

export function passesValueUnderGate(prop = {}) {
  if (!isFullDataProp(prop)) return false;
  const tier = classifyPropTier(prop);
  if (tier === "C") return false;
  const lean = String(prop.lean || prop.pick || prop.side || "").toLowerCase();
  const side = resolveRecommendedSide(prop);
  const isUnder = side === "UNDER" || /under|less|lower/.test(lean);
  if (!isUnder) return false;
  const line = finite(prop.line, NaN);
  const projection = finite(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(line) || !Number.isFinite(projection) || projection >= line) return false;
  if (resolvePropConfidence(prop) < VALUE_UNDER_MIN_CONFIDENCE) return false;
  if (resolvePropPlayability(prop) < VALUE_UNDER_MIN_PLAYABILITY) return false;
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
  const verified = applyBestPlayRankConstraints(
    eligible.filter((prop) => {
      const flags = resolveBestPlayRankingFlags(prop);
      return (
        !flags.projectionConfidenceLow &&
        !flags.outlierDetected &&
        passesOverallPlayVerification(prop)
      );
    })
  );
  if (verified[0]) {
    return { ...verified[0], overallPlayVerified: true };
  }

  const fallback = applyBestPlayRankConstraints(
    eligible.filter((prop) => passesOverallPlayVerification(prop))
  );
  if (fallback[0]) {
    return { ...fallback[0], overallPlayVerified: true };
  }

  const best = applyBestPlayRankConstraints(eligible);
  return best[0] ? { ...best[0], overallPlayVerified: false } : null;
}

export function buildOverallPlayExplanation(prop = {}) {
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
  return (
    compareNumericDesc(a, b, resolvePropConfidence) ||
    compareNumericDesc(a, b, resolvePropProbability) ||
    compareNumericDesc(a, b, resolvePropPlayability) ||
    compareNumericDesc(a, b, resolvePropSanity) ||
    compareHighestEdgePlays(a, b)
  );
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
  if (strictPicks.length >= limit) {
    return { picks: strictPicks, fallbackNotice: "", usedFallback: false };
  }
  const fallbackPicks = buildTopSectionPicks(strictPool, {
    compareFn: compareSafestPlaysRank,
    limit,
    filterFn: passesTierABFullData,
  });
  return {
    picks: fallbackPicks,
    usedFallback: strictPicks.length < limit,
    fallbackNotice: strictPicks.length < limit ? SAFEST_FALLBACK_NOTICE : "",
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
  const edgeLabels = formatValidatedEdgeDisplay(prop);
  const fullDataReason = resolveFullDataReason(prop);
  const fullData = isFullDataProp(prop);
  const withSeason = attachSeasonHitRateFields(prop);
  const withIntegrityAudit = attachIntegrityAuditFields(withSeason);
  const propTier = classifyPropTier(withIntegrityAudit);
  const withIntegrity = attachDataIntegrityFields(withIntegrityAudit);
  const dataQualityBadge = resolveBoardDataQualityBadge({ ...withIntegrity, isFullData: fullData, partialData: !fullData });
  return {
    ...withIntegrity,
    ...edgeLabels,
    rawEdgeLabel: edgeLabels.rawEdgeLabel,
    displayEdgeLabel: edgeLabels.displayEdgeLabel,
    edgePercent: edgeLabels.edgePercent ?? prop.edgePercent,
    projectionConfidenceLevel: resolveProjectionConfidenceLevel(withIntegrity),
    fullDataReason,
    isFullData: fullData,
    partialData: !fullData,
    confidenceTier: propTier,
    confidenceTierLabel:
      propTier === TIER_REVIEW_NEEDED_LABEL ? TIER_REVIEW_NEEDED_LABEL : `Tier ${propTier}`,
    reviewNeeded: propTier === TIER_REVIEW_NEEDED_LABEL || Boolean(withIntegrityAudit.reviewNeeded),
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
