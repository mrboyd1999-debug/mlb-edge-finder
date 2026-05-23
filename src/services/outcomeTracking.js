import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { findStatProfile } from "../utils/playerNames.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { isGoblinProp, isDemonProp, displaySport } from "../utils/propLabels.js";
import { formatLeanSide } from "../utils/formatters.js";
import { readHistory, writeHistory, recordPropHistoryEntry } from "./pickStore.js";

export const BOARD_RECOMMENDATIONS = {
  TOP_PICKS: "topPicks",
  READY_TO_BET: "readyToBet",
  BEST_VALUE: "bestValue",
  STREAK_FINDER: "streakFinder",
  GOBLIN: "goblin",
  DEMON: "demon",
};

const TOP_PICKS_MIN = 72;
const READY_MIN = 58;
const DEMON_MIN = 80;
const CALIBRATED_TOP_STRONG = 70;

/** Sample thresholds for historical adjustments. */
export const MIN_NO_ADJUSTMENT_SAMPLE = 5;
export const MIN_LIGHT_ADJUSTMENT_SAMPLE = 5;
export const MIN_STRONG_ADJUSTMENT_SAMPLE = 10;
const MIN_ANALYTICS_SAMPLE = 5;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function normalize(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function pickStatus(pick = {}) {
  return String(pick.resultStatus || pick.finalResult || pick.result || "Pending");
}

export function confidenceTierLabel(confidence = 0) {
  const value = Number(confidence);
  if (!Number.isFinite(value) || value <= 0) return "Unknown";
  if (value >= 80) return "80+";
  if (value >= 72) return "72-79";
  if (value >= 65) return "65-71";
  if (value >= 58) return "58-64";
  if (value >= 50) return "50-57";
  return "Under 50";
}

export function outcomeIdentity(prop = {}) {
  return [
    prop.slateDate || dateKey(new Date(prop.startTime || prop.timestamp || Date.now())),
    prop.platform,
    prop.playerName || prop.player,
    prop.recommendation || prop.categorySource,
    displaySport(prop) || prop.sport,
    prop.propType || prop.statType,
    prop.line,
    prop.bestPick || prop.pickDirection || prop.side,
  ]
    .map(normalize)
    .join("|");
}

function hasPositiveEdge(prop = {}) {
  const edge = Number(prop.edge);
  return Number.isFinite(edge) && edge > 0 && Boolean(prop.bestPick || prop.side);
}

function adjustmentWeight(sample = 0) {
  if (sample < MIN_NO_ADJUSTMENT_SAMPLE) return 0;
  if (sample < MIN_STRONG_ADJUSTMENT_SAMPLE) return 0.55;
  return 1;
}

function isTopPickEligibleProp(prop = {}) {
  if (!isVerifiedSportsbookProp(prop) || prop.isDemoData || prop.manualEntry) return false;
  if (!prop.hasVerifiedStats && !prop.manualEnriched) return false;
  if (!hasPositiveEdge(prop)) return false;
  const status = String(prop.status || "").toLowerCase();
  if (["live", "expired", "locked"].includes(status)) return false;
  const raw = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const calibrated = Number(prop.calibratedConfidence ?? raw);
  const risk = String(prop.riskLevel || "").toUpperCase();
  if (risk === "HIGH") return false;
  return raw >= TOP_PICKS_MIN || (calibrated >= CALIBRATED_TOP_STRONG && raw >= TOP_PICKS_MIN - 4);
}

function isReadyToBetProp(prop = {}) {
  if (!isVerifiedSportsbookProp(prop) || prop.isDemoData || prop.manualEntry) return false;
  if (prop.marketResearchOnly || prop.marketSupportTier === 2 || prop.noveltyMarket) return false;
  if (!hasPositiveEdge(prop)) return false;
  const status = String(prop.status || "").toLowerCase();
  if (["live", "expired", "locked"].includes(status)) return false;
  const start = new Date(prop.startTime).getTime();
  if (!Number.isFinite(start) || start <= Date.now()) return false;
  const confidence = Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
  return confidence >= READY_MIN;
}

function isBestValueEligibleProp(prop = {}) {
  if (!isVerifiedSportsbookProp(prop) || prop.isDemoData || prop.manualEntry) return false;
  if (!hasPositiveEdge(prop)) return false;
  const status = String(prop.status || "").toLowerCase();
  if (["live", "expired", "locked"].includes(status)) return false;
  const ev = Number(prop.expectedValueScore ?? 0);
  const dq = Number(prop.dataQualityScore || 0);
  return ev >= 45 && dq >= 40;
}

function isStreakFinderSavable(prop = {}) {
  return isVerifiedSportsbookProp(prop) && Boolean(prop.playerName) && !prop.isDemoData && !prop.manualEntry;
}

function isDemonEligibleProp(prop = {}) {
  return (
    isVerifiedSportsbookProp(prop) &&
    isDemonProp(prop) &&
    Number(prop.confidenceScore ?? prop.confidence ?? 0) >= DEMON_MIN &&
    Number(prop.edge || 0) >= 1
  );
}

export function isSavableBoardProp(prop = {}, recommendation = "") {
  if (!prop || !isVerifiedSportsbookProp(prop) || prop.isDemoData || prop.manualEntry) return false;
  if (recommendation === BOARD_RECOMMENDATIONS.TOP_PICKS) return isTopPickEligibleProp(prop);
  if (recommendation === BOARD_RECOMMENDATIONS.READY_TO_BET) return isReadyToBetProp(prop);
  if (recommendation === BOARD_RECOMMENDATIONS.BEST_VALUE) return isBestValueEligibleProp(prop);
  if (recommendation === BOARD_RECOMMENDATIONS.STREAK_FINDER) return isStreakFinderSavable(prop);
  if (recommendation === BOARD_RECOMMENDATIONS.GOBLIN) return isGoblinProp(prop);
  if (recommendation === BOARD_RECOMMENDATIONS.DEMON) return isDemonEligibleProp(prop);
  return false;
}

export function toOutcomeRecord(prop = {}, recommendation = BOARD_RECOMMENDATIONS.READY_TO_BET) {
  const timestamp = prop.generatedAt || new Date().toISOString();
  const slateDate = prop.slateDate || dateKey(new Date(prop.startTime || timestamp));
  const confidence = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const pickDirection = prop.bestPick || prop.side || "";
  const uniqueKey = outcomeIdentity({ ...prop, recommendation, slateDate });

  return {
    id: uniqueKey,
    propId: prop.id || uniqueKey,
    uniqueKey,
    slateDate,
    date: slateDate,
    timestamp,
    generatedAt: timestamp,
    createdAt: timestamp,
    gameStartTime: prop.startTime || null,
    recommendation,
    recommendationType: recommendationLabel(recommendation),
    categorySource: recommendation,
    category: recommendationLabel(recommendation),
    player: prop.playerName,
    playerName: prop.playerName,
    sport: displaySport(prop) || prop.sport,
    league: prop.league,
    propType: prop.statType,
    statType: prop.statType,
    market: prop.statType,
    platform: prop.platform,
    source: prop.platform,
    team: prop.team,
    opponent: prop.opponent,
    line: Number(prop.line),
    confidence,
    confidenceScore: confidence,
    calibratedConfidence: Number(prop.calibratedConfidence ?? confidence),
    confidenceTier: confidenceTierLabel(confidence),
    edge: Number(prop.edge || 0),
    edgePct: prop.edgePct,
    expectedValueScore: Number(prop.expectedValueScore ?? 0) || null,
    projectedValue: prop.projectedValue ?? prop.projection ?? null,
    volatility: prop.volatility ?? null,
    riskLevel: prop.riskLevel || "",
    bestPick: pickDirection,
    pickDirection,
    side: pickDirection,
    pick: pickDirection,
    startTime: prop.startTime,
    result: pickStatus(prop),
    resultStatus: pickStatus(prop),
    finalResult: pickStatus(prop),
    actualResult: prop.actualStatResult ?? prop.actualResult ?? null,
    actualStatResult: prop.actualStatResult ?? prop.actualResult ?? null,
    settledAt: prop.settledAt || null,
    dataQualityScore: prop.dataQualityScore ?? null,
    sportsbookComparison: prop.sportsbookComparison || null,
    lineMovementData: prop.lineMovement || null,
    reasoningSummary: prop.qualificationReason || prop.reasoningSummary || "",
    notes: prop.qualificationReason || prop.topTwoReason || prop.reasoningSummary || "",
  };
}

function recommendationLabel(recommendation = "") {
  if (recommendation === BOARD_RECOMMENDATIONS.TOP_PICKS) return "Top Picks";
  if (recommendation === BOARD_RECOMMENDATIONS.READY_TO_BET) return "Ready To Bet";
  if (recommendation === BOARD_RECOMMENDATIONS.BEST_VALUE) return "Best Value";
  if (recommendation === BOARD_RECOMMENDATIONS.STREAK_FINDER) return "Streak Finder";
  if (recommendation === BOARD_RECOMMENDATIONS.GOBLIN) return "Goblin";
  if (recommendation === BOARD_RECOMMENDATIONS.DEMON) return "Demon";
  return "Model Recommendation";
}

export function mergeOutcomeRecords(existing = [], additions = []) {
  const byKey = new Map();
  existing.forEach((row) => byKey.set(row.uniqueKey || outcomeIdentity(row), row));
  additions.forEach((row) => {
    const key = row.uniqueKey || outcomeIdentity(row);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, row);
      return;
    }
    const currentConfidence = Number(current.confidenceScore ?? current.confidence ?? 0);
    const nextConfidence = Number(row.confidenceScore ?? row.confidence ?? 0);
    const mergedRecommendation = uniqueList([current.recommendation, row.recommendation, current.categorySource, row.categorySource]);
    byKey.set(key, {
      ...current,
      ...(nextConfidence >= currentConfidence ? row : {}),
      recommendation: mergedRecommendation[0] || row.recommendation,
      categorySource: mergedRecommendation.join(","),
      category: mergedRecommendation.map(recommendationLabel).join(", "),
      updatedAt: new Date().toISOString(),
      resultStatus: current.resultStatus !== "Pending" ? current.resultStatus : row.resultStatus,
      finalResult: current.finalResult !== "Pending" ? current.finalResult : row.finalResult,
      result: current.result !== "Pending" ? current.result : row.result,
      actualStatResult: current.actualStatResult ?? row.actualStatResult ?? null,
      settledAt: current.settledAt || row.settledAt || null,
    });
  });
  return Array.from(byKey.values());
}

function uniqueList(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function persistBoardOutcomes(
  { topPicks = [], readyToBet = [], bestValue = [], streakFinder = [], goblins = [], demons = [] } = {},
  existing = readHistory()
) {
  const batches = [
    [topPicks, BOARD_RECOMMENDATIONS.TOP_PICKS],
    [readyToBet, BOARD_RECOMMENDATIONS.READY_TO_BET],
    [bestValue, BOARD_RECOMMENDATIONS.BEST_VALUE],
    [streakFinder, BOARD_RECOMMENDATIONS.STREAK_FINDER],
    [goblins, BOARD_RECOMMENDATIONS.GOBLIN],
    [demons, BOARD_RECOMMENDATIONS.DEMON],
  ];
  const additions = batches.flatMap(([props, recommendation]) =>
    props.filter((prop) => isSavableBoardProp(prop, recommendation)).map((prop) => toOutcomeRecord(prop, recommendation))
  );
  if (!additions.length) return existing;
  return mergeOutcomeRecords(existing, additions);
}

function sportFinishBufferMs(sport = "") {
  const key = normalize(sport);
  if (key.includes("mlb") || key.includes("baseball")) return 4 * 60 * 60 * 1000;
  if (key.includes("tennis")) return 5 * 60 * 60 * 1000;
  if (key.includes("soccer")) return 2.5 * 60 * 60 * 1000;
  return 3 * 60 * 60 * 1000;
}

export function isGameFinished(pick = {}, now = Date.now()) {
  const start = new Date(pick.startTime).getTime();
  if (!Number.isFinite(start)) return false;
  return now >= start + sportFinishBufferMs(pick.sport);
}

function statFromMlbSplit(stat = {}, statType = "") {
  const type = String(statType).toLowerCase();
  const key = canonicalMarketKey(statType);
  if (type.includes("strikeout") || type.includes("pitcher")) {
    return finiteNumber(stat.strikeOuts ?? stat.strikeouts);
  }
  if (key === "hits" || type === "hits") return finiteNumber(stat.hits);
  if (type.includes("rbi")) return finiteNumber(stat.rbi ?? stat.rbis);
  if (type.includes("run") && !type.includes("earned")) return finiteNumber(stat.runs);
  if (key === "totalBases" || type.includes("total base")) return finiteNumber(stat.totalBases);
  if (type.includes("home run")) return finiteNumber(stat.homeRuns);
  if (type.includes("h+r+r") || type.includes("hrr")) {
    return sumKnown([stat.hits, stat.runs, stat.rbi ?? stat.rbis]);
  }
  return finiteNumber(stat.hits ?? stat.strikeOuts ?? stat.runs);
}

function statFromBasketballGame(game = {}, statType = "") {
  const key = canonicalMarketKey(statType);
  const points = finiteNumber(game.pts ?? game.points) || 0;
  const rebounds = finiteNumber(game.reb ?? game.rebounds) || 0;
  const assists = finiteNumber(game.ast ?? game.assists) || 0;
  if (key === "points") return points;
  if (key === "rebounds") return rebounds;
  if (key === "assists") return assists;
  if (key === "pra") return round(points + rebounds + assists);
  if (key === "pr") return round(points + rebounds);
  if (key === "pa") return round(points + assists);
  if (key === "ra") return round(rebounds + assists);
  if (key === "threes") return finiteNumber(game.fg3m ?? game.threesMade);
  return points || rebounds || assists || null;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sumKnown(values = []) {
  const clean = values.map(finiteNumber).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) : null;
}

function sameGameDay(startTime, rowTime) {
  const a = dateKey(new Date(startTime));
  const b = dateKey(new Date(rowTime));
  return Boolean(a && b && a === b);
}

export function resolveActualStatValue(pick = {}, statsMap = new Map()) {
  const profile = findStatProfile(statsMap, pick);
  if (!profile) return null;
  const statType = pick.statType || pick.propType || pick.market;
  const sport = normalize(pick.sport);

  if (sport === "mlb" && Array.isArray(profile.gradingRows)) {
    const split = profile.gradingRows.find((row) => sameGameDay(pick.startTime, row.date || row.game?.gameDate));
    if (split?.stat) return statFromMlbSplit(split.stat, statType);
  }

  if ((sport === "nba" || sport === "wnba") && Array.isArray(profile.gradingRows)) {
    const game = profile.gradingRows.find((row) => sameGameDay(pick.startTime, row.game?.date || row.date));
    if (game) return statFromBasketballGame(game, statType);
  }

  return null;
}

export function gradeOutcome(pick = {}, actualStatResult = null) {
  const actual = finiteNumber(actualStatResult);
  const line = finiteNumber(pick.line);
  if (!Number.isFinite(actual) || !Number.isFinite(line)) {
    return { resultStatus: "Pending", finalResult: "Pending", result: "Pending", actualStatResult: null, settledAt: null };
  }
  const side = formatLeanSide(pick.bestPick || pick.pickDirection || pick.side || "");
  let resultStatus = "Pending";
  if (actual === line) resultStatus = "Push";
  else if (side === "Under" || side === "Less") resultStatus = actual < line ? "Win" : "Loss";
  else if (side === "Over" || side === "More") resultStatus = actual > line ? "Win" : "Loss";
  else resultStatus = actual > line ? "Win" : actual < line ? "Loss" : "Push";

  const graded = {
    resultStatus,
    finalResult: resultStatus,
    result: resultStatus,
    actualStatResult: actual,
    settledAt: new Date().toISOString(),
  };
  if (["Win", "Loss", "Push"].includes(resultStatus)) {
    recordPropHistoryEntry(pick, { resultStatus, hit: resultStatus === "Win" ? true : resultStatus === "Loss" ? false : null });
  }
  return graded;
}

export function autoGradePendingOutcomes(history = [], statsMap = new Map()) {
  let settledCount = 0;
  const updated = history.map((pick) => {
    if (pickStatus(pick) !== "Pending") return pick;
    if (!isGameFinished(pick)) return pick;
    const actual = finiteNumber(pick.actualStatResult ?? pick.actualResult) ?? resolveActualStatValue(pick, statsMap);
    if (!Number.isFinite(actual)) return pick;
    const graded = gradeOutcome(pick, actual);
    if (graded.resultStatus === "Pending") return pick;
    settledCount += 1;
    return { ...pick, ...graded, actualResult: graded.actualStatResult };
  });
  return { history: updated, settledCount };
}

/** Alias for auto-grading completed games. */
export function gradeCompletedProps(history = [], statsMap = new Map()) {
  return autoGradePendingOutcomes(history, statsMap);
}

function settledDecisions(rows = []) {
  return rows.filter((row) => ["Win", "Loss"].includes(pickStatus(row)));
}

function hitRate(rows = []) {
  const decisions = settledDecisions(rows);
  if (decisions.length < MIN_ANALYTICS_SAMPLE) return null;
  const wins = decisions.filter((row) => pickStatus(row) === "Win").length;
  return {
    hitRate: wins / decisions.length,
    wins,
    losses: decisions.length - wins,
    pushes: rows.filter((row) => pickStatus(row) === "Push").length,
    pending: rows.filter((row) => pickStatus(row) === "Pending").length,
    sample: decisions.length,
    winPercentage: Math.round((wins / decisions.length) * 100),
  };
}

function lineRangeLabel(line = 0) {
  const value = Number(line);
  if (!Number.isFinite(value)) return "Unknown";
  if (value < 1) return "Under 1";
  if (value < 3) return "1-2.9";
  if (value < 6) return "3-5.9";
  if (value < 10) return "6-9.9";
  return "10+";
}

function bucketRows(history = [], keyFn) {
  const buckets = new Map();
  history.forEach((row) => {
    const key = keyFn(row) || "Unknown";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  });
  const summary = {};
  buckets.forEach((rows, key) => {
    const stats = hitRate(rows);
    if (stats) summary[key] = stats;
  });
  return summary;
}

export function computeOutcomeAnalytics(history = []) {
  const settled = settledDecisions(history);
  const overall = hitRate(history) || { hitRate: null, sample: settled.length, winPercentage: "—" };

  return {
    overall,
    byPropType: bucketRows(history, (row) => row.propType || row.statType || row.market),
    bySport: bucketRows(history, (row) => row.sport || "Unknown"),
    byConfidenceTier: bucketRows(history, (row) => row.confidenceTier || confidenceTierLabel(row.confidenceScore ?? row.confidence)),
    byMarket: bucketRows(history, (row) => canonicalMarketKey(row.propType || row.statType || row.market)),
    byPlayer: bucketRows(history, (row) => row.playerName || row.player),
    byRecommendation: bucketRows(history, (row) => row.recommendation || row.categorySource || "Unknown"),
    byLineRange: bucketRows(history, (row) => lineRangeLabel(row.line)),
    bySource: bucketRows(history, (row) => row.source || row.platform || "Unknown"),
    streakAccuracy: {
      topPicks: hitRate(history.filter((row) => String(row.recommendation || row.categorySource || "").includes("topPicks"))),
      readyToBet: hitRate(history.filter((row) => String(row.recommendation || row.categorySource || "").includes("readyToBet"))),
      bestValue: hitRate(history.filter((row) => String(row.recommendation || row.categorySource || "").includes("bestValue"))),
      streakFinder: hitRate(history.filter((row) => String(row.recommendation || row.categorySource || "").includes("streakFinder"))),
      goblin: hitRate(history.filter((row) => String(row.recommendation || row.categorySource || "").includes("goblin"))),
      demon: hitRate(history.filter((row) => String(row.recommendation || row.categorySource || "").includes("demon"))),
      streakStarter: hitRate(history.filter((row) => String(row.recommendation || row.categorySource || "").includes("streakStarter"))),
    },
  };
}

function lookupBucket(analytics = {}, group = {}, key = "") {
  const normalizedKey = normalize(key);
  const exact = group[key] || group[Object.keys(group).find((entry) => normalize(entry) === normalizedKey)];
  return exact || null;
}

export function marketHitRateAdjustment(prop = {}, history = []) {
  const analytics = computeOutcomeAnalytics(history);
  const propKey = prop.statType || prop.propType;
  const marketBucket = lookupBucket(analytics, analytics.byMarket, canonicalMarketKey(propKey));
  const propBucket = lookupBucket(analytics, analytics.byPropType, propKey);
  const bucket = marketBucket || propBucket;
  if (!bucket || bucket.sample < MIN_NO_ADJUSTMENT_SAMPLE) {
    return { adjustment: 0, hitRate: null, sample: bucket?.sample || 0, note: "" };
  }
  const weight = adjustmentWeight(bucket.sample);
  const delta = (bucket.hitRate - 0.5) * 14 * weight;
  return {
    adjustment: round(clamp(delta, -8, 10)),
    hitRate: bucket.hitRate,
    sample: bucket.sample,
    note: `${propKey} market ${Math.round(bucket.hitRate * 100)}% (${bucket.sample})`,
  };
}

export function playerConsistencyModifier(prop = {}, history = []) {
  const playerName = prop.playerName || prop.player;
  const playerRows = history.filter(
    (row) =>
      normalize(row.playerName || row.player) === normalize(playerName) &&
      ["Win", "Loss", "Push"].includes(pickStatus(row))
  );
  if (playerRows.length < MIN_NO_ADJUSTMENT_SAMPLE) {
    return { boost: 0, penalty: 0, note: "", sample: playerRows.length };
  }
  const weight = adjustmentWeight(playerRows.length);
  const outcomes = playerRows.map((row) => pickStatus(row));
  const winRate = outcomes.filter((status) => status === "Win").length / playerRows.length;
  const swing = 1 - Math.abs(winRate - 0.5) * 2;
  let boost = 0;
  let penalty = 0;
  const notes = [];

  if (winRate >= 0.58) {
    boost = (winRate - 0.5) * 12 * weight;
    notes.push(`${Math.round(winRate * 100)}% player hit rate`);
  } else if (winRate <= 0.42) {
    penalty = (0.42 - winRate) * 16 * weight;
    notes.push(`volatile player ${Math.round(winRate * 100)}%`);
  } else if (swing >= 0.35) {
    penalty = swing * 5 * weight;
    notes.push("inconsistent outcomes");
  }

  return {
    boost: round(clamp(boost, 0, 8)),
    penalty: round(clamp(penalty, 0, 10)),
    note: notes.join(" · "),
    sample: playerRows.length,
    winRate,
  };
}

export function historicalAccuracyBoost(prop = {}, history = []) {
  const market = marketHitRateAdjustment(prop, history);
  const player = playerConsistencyModifier(prop, history);
  const analytics = computeOutcomeAnalytics(history);
  let boost = market.adjustment > 0 ? market.adjustment : 0;
  boost += player.boost;
  const notes = [market.note, player.note].filter(Boolean);

  const tier = confidenceTierLabel(prop.confidenceScore ?? prop.confidence ?? 0);
  const tierBucket = lookupBucket(analytics, analytics.byConfidenceTier, tier);
  if (tierBucket?.sample >= MIN_NO_ADJUSTMENT_SAMPLE) {
    const weight = adjustmentWeight(tierBucket.sample);
    const tierDelta = (tierBucket.hitRate - 0.5) * 10 * weight;
    if (tierDelta > 0) {
      boost += tierDelta;
      notes.push(`${tier} tier ${Math.round(tierBucket.hitRate * 100)}%`);
    }
  }

  const recommendation = prop.recommendation || prop.categorySource;
  if (recommendation) {
    const recBucket = lookupBucket(analytics, analytics.byRecommendation, recommendation);
    if (recBucket?.sample >= MIN_NO_ADJUSTMENT_SAMPLE) {
      const weight = adjustmentWeight(recBucket.sample);
      boost += Math.max(0, (recBucket.hitRate - 0.5) * 6 * weight);
    }
  }

  return {
    boost: round(clamp(boost, -8, 12)),
    note: notes.join(" · "),
    analyticsSample: settledDecisions(history).length,
    marketHitRate: market.hitRate,
    marketSample: market.sample,
  };
}

export function historicalConfidenceBoost(prop = {}, history = []) {
  const accuracy = historicalAccuracyBoost(prop, history);
  return {
    boost: accuracy.boost,
    note: accuracy.note,
    analyticsSample: accuracy.analyticsSample,
  };
}

/** Alias for long-term learning boost. */
export function historicalBoost(prop = {}, history = []) {
  return historicalConfidenceBoost(prop, history);
}

/** Alias for historical volatility / inconsistency penalty. */
export function volatilityPenalty(prop = {}, history = []) {
  return historicalVolatilityPenalty(prop, history);
}

/** Market-level reliability score (0–100) from settled prop history. */
export function marketReliabilityScore(prop = {}, history = []) {
  const market = marketHitRateAdjustment(prop, history);
  const sample = Number(market.sample || 0);
  const hitRate = market.hitRate;

  if (sample < MIN_NO_ADJUSTMENT_SAMPLE || hitRate == null) {
    return {
      score: 50,
      label: "insufficient market history",
      sample,
      hitRate: null,
      reliable: false,
    };
  }

  const weight = adjustmentWeight(sample);
  const score = clamp(42 + (hitRate - 0.45) * 90 * weight + Math.min(12, sample / 4), 0, 100);

  return {
    score: round(score),
    label: `${Math.round(hitRate * 100)}% market hit rate (${Math.round(sample)} picks)`,
    sample,
    hitRate,
    reliable: hitRate >= 0.48 && sample >= MIN_NO_ADJUSTMENT_SAMPLE,
  };
}

export function historicalMissPenalty(prop = {}, history = []) {
  const player = playerConsistencyModifier(prop, history);
  const analytics = computeOutcomeAnalytics(history);
  const playerKey = prop.playerName || prop.player;
  const marketKey = prop.statType || prop.propType;
  let penalty = 0;
  const notes = [];

  const playerBucket = lookupBucket(analytics, analytics.byPlayer, playerKey);
  if (playerBucket?.sample >= MIN_NO_ADJUSTMENT_SAMPLE && playerBucket.hitRate != null && playerBucket.hitRate < 0.38) {
    const weight = adjustmentWeight(playerBucket.sample);
    penalty += (0.38 - playerBucket.hitRate) * 20 * weight;
    notes.push(`${prop.playerName} cold (${Math.round(playerBucket.hitRate * 100)}%)`);
  }

  const settled = history.filter(
    (row) =>
      normalize(row.playerName || row.player) === normalize(playerKey) &&
      (row.statType === marketKey || row.propType === marketKey) &&
      ["Win", "Loss"].includes(pickStatus(row))
  );
  const recentMisses = settled.slice(0, 8).filter((row) => pickStatus(row) === "Loss").length;
  if (recentMisses >= 3) {
    penalty += Math.min(6, recentMisses);
    notes.push(`${recentMisses} recent misses`);
  }

  penalty += Number(player.penalty || 0) * 0.35;
  if (player.note) notes.push(player.note);

  return {
    penalty: round(clamp(penalty, 0, 12)),
    note: notes.join(" · ").trim(),
    recentMisses,
  };
}

export function historicalVolatilityPenalty(prop = {}, history = []) {
  const analytics = computeOutcomeAnalytics(history);
  const propKey = prop.statType || prop.propType;
  const player = playerConsistencyModifier(prop, history);
  let penalty = player.penalty;
  const notes = player.note ? [player.note] : [];

  const marketAdj = marketHitRateAdjustment(prop, history);
  if (marketAdj.sample >= MIN_NO_ADJUSTMENT_SAMPLE && marketAdj.hitRate != null && marketAdj.hitRate < 0.42) {
    const weight = adjustmentWeight(marketAdj.sample);
    penalty += (0.42 - marketAdj.hitRate) * 18 * weight;
    notes.push(`${propKey} cold market (${Math.round(marketAdj.hitRate * 100)}%)`);
  }

  const propBucket = lookupBucket(analytics, analytics.byPropType, propKey);
  if (propBucket?.sample >= MIN_NO_ADJUSTMENT_SAMPLE && propBucket.hitRate < 0.42) {
    const weight = adjustmentWeight(propBucket.sample);
    penalty += (0.42 - propBucket.hitRate) * 12 * weight;
  }

  const tier = confidenceTierLabel(prop.confidenceScore ?? prop.confidence ?? 0);
  const tierBucket = lookupBucket(analytics, analytics.byConfidenceTier, tier);
  if (tierBucket?.sample >= MIN_NO_ADJUSTMENT_SAMPLE && tierBucket.hitRate < 0.45) {
    const weight = adjustmentWeight(tierBucket.sample);
    penalty += (0.45 - tierBucket.hitRate) * 12 * weight;
    notes.push(`${tier} tier underperforming`);
  }

  if (Number.isFinite(prop.volatility) && prop.volatility >= 3.5 && propBucket?.hitRate != null && propBucket.hitRate < 0.5) {
    penalty += 2;
  }

  return {
    penalty: round(clamp(penalty, 0, 10)),
    note: notes.join(" · ").trim(),
    marketHitRate: marketAdj.hitRate,
    marketSample: marketAdj.sample,
  };
}

export function syncOutcomeHistory(history = readHistory(), statsMap = new Map()) {
  const graded = autoGradePendingOutcomes(history, statsMap);
  if (graded.settledCount > 0 || graded.history.length !== history.length) {
    writeHistory(graded.history);
  }
  return graded;
}

export function buildOutcomeDashboard(history = []) {
  const analytics = computeOutcomeAnalytics(history);
  const settled = settledDecisions(history);
  const wins = settled.filter((row) => pickStatus(row) === "Win").length;
  const losses = settled.filter((row) => pickStatus(row) === "Loss").length;
  const pushes = history.filter((row) => pickStatus(row) === "Push").length;
  const voids = history.filter((row) => pickStatus(row) === "Void").length;

  return {
    total: history.length,
    pending: history.filter((row) => pickStatus(row) === "Pending").length,
    wins,
    losses,
    pushes,
    voids,
    winPercentage: settled.length ? Math.round((wins / settled.length) * 100) : 0,
    analytics,
    topPicksHitRate: formatHitRate(analytics.streakAccuracy.topPicks),
    readyToBetHitRate: formatHitRate(analytics.streakAccuracy.readyToBet),
    bestValueHitRate: formatHitRate(analytics.streakAccuracy.bestValue),
    streakFinderHitRate: formatHitRate(analytics.streakAccuracy.streakFinder),
    goblinHitRate: formatHitRate(analytics.streakAccuracy.goblin),
    demonHitRate: formatHitRate(analytics.streakAccuracy.demon),
    streakStarterHitRate: formatHitRate(analytics.streakAccuracy.streakStarter),
    bySport: mapBreakdown(analytics.bySport),
    byStatType: mapBreakdown(analytics.byPropType),
    byMarket: mapBreakdown(analytics.byMarket),
    byConfidenceRange: mapBreakdown(analytics.byConfidenceTier),
    byLineRange: mapBreakdown(analytics.byLineRange),
    bySource: mapBreakdown(analytics.bySource),
    byCategorySource: mapBreakdown(analytics.byRecommendation),
    byPlayer: mapBreakdown(analytics.byPlayer),
    byPlatform: mapBreakdown(analytics.bySource),
    byRiskLevel: mapBreakdown(bucketRows(history, (row) => row.riskLevel || "Unknown")),
  };
}

function formatHitRate(bucket) {
  if (!bucket) return "—";
  return bucket.winPercentage;
}

function mapBreakdown(group = {}) {
  return Object.entries(group)
    .map(([key, stats]) => ({
      key,
      wins: stats.wins,
      losses: stats.losses,
      pushes: stats.pushes,
      winPercentage: stats.winPercentage,
    }))
    .sort((a, b) => b.wins + b.losses - (a.wins + a.losses));
}
