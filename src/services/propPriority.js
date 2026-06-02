import {
  canonicalMarketKey,
  getMarketSupportTier,
  isComboMarketKey,
  isNoveltyMarket,
} from "../utils/marketNormalization.js";

/** Highest-priority cashable markets by sport. */
export const CORE_MARKETS = {
  NBA: new Set(["points", "assists", "rebounds", "pra", "fantasyScore"]),
  WNBA: new Set(["points", "assists", "rebounds", "pra", "fantasyScore"]),
  MLB: new Set(["strikeouts", "hits", "totalBases", "hrr", "outs"]),
  Tennis: new Set(["aces", "fantasyScore", "gamesWon"]),
  "ATP Tennis": new Set(["aces", "fantasyScore", "gamesWon"]),
  "WTA Tennis": new Set(["aces", "fantasyScore", "gamesWon"]),
};

/** Markets that should receive reduced pipeline weight. */
const LOW_WEIGHT_MARKET_KEYS = new Set([
  "totalTieBreaks",
  "totalSets",
  "quarterPoints",
  "pointsFirst3Min",
  "timeOnIce",
  "doubleDouble",
  "breakPoints",
]);

const EXOTIC_TENNIS_KEYS = new Set(["totalSets", "totalTieBreaks", "breakPoints", "doubleFaults", "totalGames"]);
const VOLATILE_COMBO_KEYS = new Set(["pr", "pa", "ra"]);
const TENNIS_SPORTS = new Set(["Tennis", "ATP Tennis", "WTA Tennis"]);

export const BOARD_SORT_MODES = {
  priority: "priority",
  decision: "decision",
  ev: "ev",
  confidence: "confidence",
  volatility: "volatility",
};

export const PRIORITY_TIERS = {
  core: "core",
  standard: "standard",
  secondary: "secondary",
  deprioritized: "deprioritized",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSport(sport = "") {
  if (TENNIS_SPORTS.has(sport)) return sport;
  return String(sport || "");
}

function marketKeyForProp(prop = {}) {
  return prop.marketKey || canonicalMarketKey(prop.statType);
}

export function isCoreMarket(prop = {}) {
  const sport = normalizeSport(prop.sport);
  const key = marketKeyForProp(prop);
  const registry = CORE_MARKETS[sport];
  return Boolean(registry?.has(key));
}

export function isLowWeightMarket(prop = {}) {
  const key = marketKeyForProp(prop);
  return LOW_WEIGHT_MARKET_KEYS.has(key);
}

export function isExoticTennisMarket(prop = {}) {
  if (!TENNIS_SPORTS.has(prop.sport)) return false;
  return EXOTIC_TENNIS_KEYS.has(marketKeyForProp(prop));
}

export function isVolatileComboMarket(prop = {}) {
  const key = marketKeyForProp(prop);
  return VOLATILE_COMBO_KEYS.has(key) && isComboMarketKey(key);
}

export function classifyPriorityTier(prop = {}) {
  if (computeDeprioritizationPenalty(prop) >= 28) return PRIORITY_TIERS.deprioritized;
  if (isCoreMarket(prop)) return PRIORITY_TIERS.core;
  if (isLowWeightMarket(prop) || prop.noveltyMarket || prop.marketSupportTier === 2) return PRIORITY_TIERS.secondary;
  return PRIORITY_TIERS.standard;
}

export function computeDeprioritizationPenalty(prop = {}, phase = "postScore") {
  let penalty = 0;
  const key = marketKeyForProp(prop);
  const tier = prop.marketSupportTier ?? getMarketSupportTier(prop.statType, prop.sport);

  if (prop.noveltyMarket || isNoveltyMarket(prop.statType, prop.sport)) penalty += phase === "preScore" ? 18 : 24;
  if (tier === 2 || prop.marketResearchOnly) penalty += 14;
  if (isLowWeightMarket(prop)) penalty += 16;
  if (isExoticTennisMarket(prop)) penalty += phase === "preScore" ? 12 : 18;
  if (isVolatileComboMarket(prop)) penalty += 10;

  if (phase === "postScore") {
    const sampleSize = Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0);
    if (sampleSize > 0 && sampleSize < 3) penalty += 14;
    else if (sampleSize > 0 && sampleSize < 5) penalty += 6;

    const confidence = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
    if (prop.isAdjustedOdds || prop.adjustedOddsType) {
      if (confidence < 62) penalty += 12;
      else if (confidence < 68) penalty += 5;
    }

    const volatility = Number(prop.volatility || prop.modelSignal?.volatility);
    if (Number.isFinite(volatility) && volatility >= 3.5) penalty += 8;
    else if (Number.isFinite(volatility) && volatility >= 2.75) penalty += 4;
  } else if (prop.isAdjustedOdds || prop.adjustedOddsType) {
    penalty += 6;
  }

  if (prop.fallbackProfile || prop.isDemoData || prop.manualEntry) penalty += 12;
  if (key === "doubleDouble") penalty += 10;

  return penalty;
}

function sharpnessScore(prop = {}) {
  const indicator = String(prop.sharpMoneyIndicator || prop.modelSignal?.sharpMoneyIndicator || "");
  const books = Number(prop.sportsbookComparison?.books || prop.modelSignal?.sportsbookComparison?.books || 0);
  const discrepancy = Number(prop.sportsbookDiscrepancy ?? prop.modelSignal?.sportsbookDiscrepancy);

  if (indicator === "Strong alignment") return 100;
  if (indicator === "Sportsbook market supports value") return 82;
  if (indicator === "Line moved toward model") return 68;
  if (Number.isFinite(discrepancy) && discrepancy >= 0.75 && books >= 2) return 75;
  if (Number.isFinite(discrepancy) && discrepancy >= 0.4 && books >= 2) return 58;
  if (indicator === "Market moved against model") return 18;
  return books >= 1 ? 35 : 20;
}

function edgeComponent(edge = 0, line = 1) {
  if (!Number.isFinite(edge) || edge <= 0) return 0;
  const scale = Math.max(1, Math.abs(Number(line) || 1));
  return clamp((edge / scale) * 55 + edge * 8, 0, 100);
}

function consistencyScore(prop = {}) {
  const hitRate = Number(prop.last10HitRate ?? prop.recentHitRate ?? prop.modelSignal?.recentHitRate);
  const sampleSize = Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0);
  let score = 35;
  if (Number.isFinite(hitRate)) score += clamp((hitRate - 0.45) * 120, -15, 35);
  if (sampleSize >= 8) score += 12;
  else if (sampleSize >= 5) score += 8;
  else if (sampleSize >= 3) score += 3;
  else if (sampleSize > 0) score -= 8;
  return clamp(score, 0, 100);
}

function matchupScore(rating = "") {
  const text = String(rating || "").toLowerCase();
  if (text.includes("favorable")) return 88;
  if (text.includes("playable")) return 68;
  if (text.includes("neutral")) return 50;
  if (text.includes("tough")) return 24;
  return 45;
}

function movementScore(movement = null) {
  if (!movement) return 45;
  if (movement.supportsPick) return 82;
  if (movement.againstPick) return 20;
  return 45;
}

function volatilityComponent(volatility) {
  if (!Number.isFinite(volatility)) return 50;
  if (volatility <= 1.8) return 92;
  if (volatility <= 2.25) return 78;
  if (volatility <= 2.75) return 62;
  if (volatility <= 3.5) return 42;
  return 24;
}

/** Weighted priority score after full scoring (0–100). */
export function computePropPriorityScore(prop = {}) {
  const confidence = clamp(Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0), 0, 100);
  const dq = clamp(Number(prop.dataQualityScore || prop.modelSignal?.dataQualityScore || 0), 0, 100);
  const edge = Number(prop.edge || prop.modelSignal?.edge || 0);
  const expectedValue = Number(prop.expectedValue ?? prop.modelSignal?.expectedValue);
  const volatility = Number(prop.volatility ?? prop.modelSignal?.volatility);
  const movement = prop.lineMovement || prop.modelSignal?.lineMovement;

  let score =
    confidence * 0.26 +
    dq * 0.17 +
    sharpnessScore(prop) * 0.14 +
    edgeComponent(edge, prop.line) * 0.15 +
    consistencyScore(prop) * 0.11 +
    matchupScore(prop.matchupRating || prop.modelSignal?.matchupRating) * 0.06 +
    movementScore(movement) * 0.05 +
    volatilityComponent(volatility) * 0.06;

  if (Number.isFinite(expectedValue) && expectedValue > 0) score += clamp(expectedValue * 40, 0, 8);
  if (isCoreMarket(prop)) score += 14;
  score -= computeDeprioritizationPenalty(prop, "postScore");

  return clamp(Math.round(score), 0, 100);
}

/** Lightweight score used before expensive stat/sportsbook enrichment. */
export function computePreScorePriority(prop = {}) {
  let score = 0;
  const sport = prop.sport || "";
  const tier = prop.marketSupportTier ?? getMarketSupportTier(prop.statType, sport);

  if (prop.platform === "PrizePicks") score += 4;
  if (prop.platform === "Underdog") score += 3;
  if (["MLB", "NBA", "WNBA", "Tennis", "ATP Tennis", "WTA Tennis"].includes(sport)) score += 6;

  if (isCoreMarket(prop)) score += 30;
  else if (tier === 1 && !isLowWeightMarket(prop)) score += 14;
  else if (tier === 2) score += 5;
  else if (prop.noveltyMarket || tier === 0) score -= 6;

  if (prop.playerName && Number.isFinite(Number(prop.line))) score += 4;
  if (prop.startTime) score += 2;
  const multiplier = Number(prop.multiplier);
  if (multiplier > 1) score += 6;
  else if (multiplier > 0 && multiplier < 1) score += 4;

  score -= computeDeprioritizationPenalty(prop, "preScore");
  return score;
}

export function isSharpOnlyCandidate(prop = {}) {
  const confidence = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  const dq = Number(prop.dataQualityScore || prop.modelSignal?.dataQualityScore || 0);
  const edge = Number(prop.edge || prop.modelSignal?.edge || 0);
  const expectedValue = Number(prop.expectedValue ?? prop.modelSignal?.expectedValue);
  const discrepancy = Number(prop.sportsbookDiscrepancy ?? prop.modelSignal?.sportsbookDiscrepancy);
  const books = Number(prop.sportsbookComparison?.books || prop.modelSignal?.sportsbookComparison?.books || 0);
  const indicator = String(prop.sharpMoneyIndicator || prop.modelSignal?.sharpMoneyIndicator || "");

  if (confidence < 55 || dq < 42 || edge <= 0) return false;
  if (prop.noveltyMarket && !indicator.includes("alignment") && !indicator.includes("supports value")) return false;

  const strongBook =
    books >= 2 &&
    Number.isFinite(discrepancy) &&
    discrepancy >= 0.35 &&
    (indicator === "Strong alignment" ||
      indicator === "Sportsbook market supports value" ||
      indicator === "Line moved toward model");

  const strongEdge =
    (Number.isFinite(expectedValue) && expectedValue >= 0.025) ||
    edge >= 1.2 ||
    (Number.isFinite(discrepancy) && discrepancy >= 0.6);

  const priority = Number(prop.priorityScore || computePropPriorityScore(prop));
  return strongBook && strongEdge && priority >= 52;
}

export function sortBoardProps(props = [], sortMode = BOARD_SORT_MODES.priority) {
  const mode = sortMode || BOARD_SORT_MODES.priority;
  return [...props].sort((a, b) => compareBoardProps(a, b, mode));
}

export function compareBoardProps(a = {}, b = {}, sortMode = BOARD_SORT_MODES.priority) {
  if (sortMode === BOARD_SORT_MODES.decision) {
    return (
      Number(b.expectedValueScore ?? -Infinity) - Number(a.expectedValueScore ?? -Infinity) ||
      Number(b.confidenceScore ?? b.confidence ?? 0) - Number(a.confidenceScore ?? a.confidence ?? 0) ||
      Number(b.edge || 0) - Number(a.edge || 0) ||
      Number(a.volatility ?? Number.MAX_SAFE_INTEGER) - Number(b.volatility ?? Number.MAX_SAFE_INTEGER) ||
      Number(b.dataQualityScore || 0) - Number(a.dataQualityScore || 0) ||
      Number(b.decisionRankScore || 0) - Number(a.decisionRankScore || 0)
    );
  }
  if (sortMode === BOARD_SORT_MODES.ev) {
    return (
      Number(b.expectedValue ?? b.modelSignal?.expectedValue ?? -Infinity) -
        Number(a.expectedValue ?? a.modelSignal?.expectedValue ?? -Infinity) ||
      Number(b.edge || b.modelSignal?.edge || 0) - Number(a.edge || a.modelSignal?.edge || 0) ||
      Number(b.priorityScore || 0) - Number(a.priorityScore || 0)
    );
  }
  if (sortMode === BOARD_SORT_MODES.confidence) {
    return (
      Number(b.confidenceScore || b.modelSignal?.confidenceScore || 0) -
        Number(a.confidenceScore || a.modelSignal?.confidenceScore || 0) ||
      Number(b.priorityScore || 0) - Number(a.priorityScore || 0)
    );
  }
  if (sortMode === BOARD_SORT_MODES.volatility) {
    const aVol = Number(a.volatility ?? a.modelSignal?.volatility);
    const bVol = Number(b.volatility ?? b.modelSignal?.volatility);
    const safeA = Number.isFinite(aVol) ? aVol : Number.MAX_SAFE_INTEGER;
    const safeB = Number.isFinite(bVol) ? bVol : Number.MAX_SAFE_INTEGER;
    return safeA - safeB || Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
  }
  return (
    Number(b.priorityScore || 0) - Number(a.priorityScore || 0) ||
    Number(b.confidenceScore || b.modelSignal?.confidenceScore || 0) -
      Number(a.confidenceScore || a.modelSignal?.confidenceScore || 0) ||
    Number(b.edge || b.modelSignal?.edge || 0) - Number(a.edge || a.modelSignal?.edge || 0)
  );
}
