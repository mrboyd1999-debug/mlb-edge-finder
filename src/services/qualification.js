import { recordFilterReason } from "../utils/propPipelineDebug.js";
import { MLB_ONLY_MODE, guardMlbOnlyProp } from "../utils/mlbOnlyMode.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { computeRankScore } from "./projectionEngine.js";
import { buildRejectionAnalytics } from "./rejectionAnalytics.js";
import {
  evaluateQualificationPool,
  isAcceptedQualificationTier,
  isSmartAcceptanceEligible,
  qualificationTierLabel,
  qualificationTierToDisplayTier,
  QUALIFICATION_TIERS,
  selectDiverseAcceptedProps,
} from "./adaptiveQualification.js";
import { RENDER_LIMITS } from "../utils/approvedMarkets.js";

export const DISPLAY_MIN_CONFIDENCE = 40;

const SUPPORTED_SPORTS = MLB_ONLY_MODE ? new Set(["MLB"]) : new Set(["MLB", "NBA", "WNBA", "ATP Tennis", "WTA Tennis", "Tennis", "Soccer", "NFL", "NCAAF", "NHL"]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function isGameNotExpired(prop) {
  const status = String(prop.status || "").toLowerCase();
  return status !== "expired" && status !== "closed";
}

export function isDisplayable(prop) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  const player = String(prop.playerName || "").trim();
  const line = Number(prop.line);
  const sport = String(prop.sport || "");
  if (!player) return false;
  if (!prop.statType || !Number.isFinite(line) || line <= 0) return false;
  if (!SUPPORTED_SPORTS.has(sport)) return false;
  if (!isGameNotExpired(prop)) return false;
  const confidence = Number(prop.confidenceScore ?? 0);
  return confidence > 0;
}

export function isNearQualification(prop) {
  return prop.qualificationTier === QUALIFICATION_TIERS.NEAR_MISS;
}

export function isReadyToBet(prop) {
  return isAcceptedQualificationTier(prop.qualificationTier, prop);
}

export function classifyDisplayTier(prop) {
  if (!isDisplayable(prop)) return null;
  return qualificationTierToDisplayTier(prop.qualificationTier, prop);
}

export function applyQualificationLabels(prop, evaluation = {}) {
  const tier = evaluation.qualificationTier || prop.qualificationTier || QUALIFICATION_TIERS.REJECT;
  const displayTier = qualificationTierToDisplayTier(tier);

  if (!displayTier) {
    return {
      ...prop,
      ...evaluation,
      qualificationTier: tier,
      displayTier: null,
      recommendationStatus: "rejected",
      bettingLabel: "Hidden",
      rejectionReason: evaluation.hardFailReason || prop.rejectionReason || "below qualification threshold",
      rejectionStage: prop.rejectionStage || "qualification",
    };
  }

  const bettingLabel =
    tier === QUALIFICATION_TIERS.ELITE
      ? "Elite"
      : tier === QUALIFICATION_TIERS.STRONG
        ? "Ready to Bet"
        : tier === QUALIFICATION_TIERS.NEAR_MISS
          ? "Near Miss"
          : "Watchlist";

  const recommendationStatus =
    tier === QUALIFICATION_TIERS.ELITE || tier === QUALIFICATION_TIERS.STRONG
      ? "ready"
      : tier === QUALIFICATION_TIERS.NEAR_MISS
        ? "near"
        : "research";

  return {
    ...prop,
    ...evaluation,
    qualificationTier: tier,
    qualificationScore: evaluation.qualificationScore ?? prop.qualificationScore ?? 0,
    displayTier,
    recommendationStatus,
    bettingLabel,
    qualificationLabel: qualificationTierLabel(tier),
    rejectionReason: "",
    rejectionStage: "",
    isQualificationAccepted: isAcceptedQualificationTier(tier, prop),
    penaltyStack: evaluation.penaltyStack || prop.penaltyStack || [],
    softPenaltyTotal: evaluation.softPenaltyTotal ?? prop.softPenaltyTotal ?? 0,
  };
}

export function buildHistoryAccuracyWeights(history = []) {
  const buckets = new Map();
  history.forEach((pick) => {
    const status = String(pick.resultStatus || pick.finalResult || "");
    if (!["Win", "Loss"].includes(status)) return;
    const key = `${pick.sport || "Other"}|${pick.statType || pick.propType || "unknown"}`;
    const row = buckets.get(key) || { wins: 0, losses: 0 };
    if (status === "Win") row.wins += 1;
    else row.losses += 1;
    buckets.set(key, row);
  });

  const weights = new Map();
  buckets.forEach((row, key) => {
    const total = row.wins + row.losses;
    if (total < 4) return;
    const rate = row.wins / total;
    const boost = clamp((rate - 0.5) * 0.2, -0.08, 0.1);
    weights.set(key, 1 + boost);
  });
  return weights;
}

export function historyWeightForProp(prop, weights = new Map()) {
  const key = `${prop.sport || "Other"}|${prop.statType || "unknown"}`;
  return weights.get(key) || 1;
}

export function sportSpecificConfidenceBoost(prop, profile = {}) {
  const sport = prop.sport;
  let boost = 0;
  if (sport === "MLB") {
    if (/strikeout|pitch/i.test(prop.statType || "")) boost += 3;
    if (/out|hits allowed|earned run|walk/i.test(prop.statType || "")) boost += 2;
    if (/single|double|triple|home run|stolen base|total base|hit|rbi|run|hrr/i.test(prop.statType || "")) boost += 2;
    if (profile?.hitStreak >= 3) boost += 2;
    if (profile?.handednessMatchup) boost += 1;
    if (profile?.pitchCountTrend || profile?.usageAdjustment) boost += 2;
  } else if (sport === "NBA" || sport === "WNBA") {
    if (Number.isFinite(profile?.projectedMinutes)) boost += 3;
    if (prop.injuryRisk === "Low") boost += 2;
    if (Number.isFinite(profile?.last5Average)) boost += 2;
  } else if (sport === "Soccer") {
    if (/shot|cross|pass/i.test(prop.statType || "")) boost += 2;
  }
  return boost;
}

export function researchGapConfidencePenalty(research = {}) {
  const count = Number(research.missingCount || research.gaps?.length || 0);
  return Math.min(12, count * 2);
}

function correlationKey(prop) {
  return [prop.playerName, prop.sport, prop.statType, prop.startTime, prop.platform].join("|").toLowerCase();
}

function gameKey(prop) {
  return [prop.sport, prop.team, prop.opponent, prop.startTime].join("|").toLowerCase();
}

export function avoidCorrelatedProps(props = [], limit = 120) {
  const selected = [];
  const usedPlayers = new Set();
  const gameCounts = new Map();

  const tierPriority = (prop) => {
    if (prop.qualificationTier === QUALIFICATION_TIERS.ELITE) return 5;
    if (prop.qualificationTier === QUALIFICATION_TIERS.STRONG) return 4;
    if (prop.displayTier === "ready") return 4;
    if (prop.qualificationTier === QUALIFICATION_TIERS.NEAR_MISS || prop.displayTier === "near") return 3;
    if (prop.qualificationTier === QUALIFICATION_TIERS.WATCHLIST || prop.displayTier === "research") return 2;
    return 1;
  };

  const sorted = [...props].sort(
    (a, b) =>
      tierPriority(b) - tierPriority(a) ||
      Number(b.qualificationScore || 0) - Number(a.qualificationScore || 0) ||
      Number(b.priorityScore || 0) - Number(a.priorityScore || 0) ||
      computeRankScore(b) - computeRankScore(a)
  );

  for (const prop of sorted) {
    if (selected.length >= limit) break;
    const playerKey = `${prop.sport}|${prop.playerName}`.toLowerCase();
    const gKey = gameKey(prop);
    const gameLoad = gameCounts.get(gKey) || 0;
    if (usedPlayers.has(playerKey)) continue;
    if (gameLoad >= 3) continue;
    const dup = selected.some((item) => correlationKey(item) === correlationKey(prop));
    if (dup) continue;
    selected.push(prop);
    usedPlayers.add(playerKey);
    gameCounts.set(gKey, gameLoad + 1);
  }

  if (selected.length < Math.min(limit, 24) && sorted.length > selected.length) {
    sorted.forEach((prop) => {
      if (selected.length >= limit) return;
      if (selected.some((item) => correlationKey(item) === correlationKey(prop))) return;
      selected.push(prop);
    });
  }

  return selected;
}

export function buildQualificationBoards(scoredProps = [], audit, history = []) {
  const scopedProps = MLB_ONLY_MODE ? scoredProps.filter((prop) => guardMlbOnlyProp(prop)) : scoredProps;
  const historyWeights = buildHistoryAccuracyWeights(history);
  const pool = evaluateQualificationPool(scopedProps);

  const elite = [];
  const strong = [];
  const near = [];
  const watchlist = [];
  const rejected = [];

  pool.evaluated.forEach((row) => {
    const labeled = applyQualificationLabels(row.prop, row);
    const tier = labeled.qualificationTier;

    if (tier === QUALIFICATION_TIERS.ELITE) elite.push(labeled);
    else if (tier === QUALIFICATION_TIERS.STRONG) strong.push(labeled);
    else if (tier === QUALIFICATION_TIERS.NEAR_MISS) near.push(labeled);
    else if (tier === QUALIFICATION_TIERS.WATCHLIST) watchlist.push(labeled);
    else {
      rejected.push(labeled);
      recordReject(
        audit,
        labeled.hardFailReason || labeled.rejectionReason || "below qualification threshold",
        labeled.hardFail ? "hard-gate" : "qualification",
        labeled
      );
    }
  });

  const acceptedPool = selectDiverseAcceptedProps(
    [
      ...elite,
      ...strong,
      ...near.filter((prop) => isAcceptedQualificationTier(prop.qualificationTier, prop)),
      ...watchlist.filter((prop) => isAcceptedQualificationTier(prop.qualificationTier, prop)),
      ...rejected
        .filter((prop) => !prop.hardFail && isSmartAcceptanceEligible(prop))
        .filter((prop) => Number(prop.qualificationScore || prop.confidenceScore || 0) >= 52),
    ],
    RENDER_LIMITS.readyToBet
  );
  const readyDisplay = avoidCorrelatedProps(
    acceptedPool.sort(
      (a, b) =>
        Number(b.qualificationScore || 0) - Number(a.qualificationScore || 0) ||
        Number(b.priorityScore || 0) - Number(a.priorityScore || 0) ||
        computeRankScore(b) - computeRankScore(a)
    ),
    RENDER_LIMITS.readyToBet
  );
  const nearDisplay = avoidCorrelatedProps(
    near.sort(
      (a, b) =>
        Number(b.qualificationScore || 0) - Number(a.qualificationScore || 0) ||
        Number(b.priorityScore || 0) - Number(a.priorityScore || 0)
    ),
    15
  );
  const researchDisplay = avoidCorrelatedProps(
    watchlist.sort(
      (a, b) =>
        Number(b.qualificationScore || 0) - Number(a.qualificationScore || 0) ||
        Number(b.priorityScore || 0) - Number(a.priorityScore || 0) ||
        computeRankScore(b) - computeRankScore(a)
    ),
    25
  );
  const allDisplayable = [...readyDisplay, ...nearDisplay, ...researchDisplay];

  const rejectionAnalytics = buildRejectionAnalytics(scopedProps, {
    readyProps: acceptedPool,
    nearProps: near,
  });

  audit.displayed = allDisplayable.length;
  audit.ready = acceptedPool.length;
  audit.elite = elite.length;
  audit.strong = strong.length;
  audit.near = near.length;
  audit.research = watchlist.length;
  audit.scored = scoredProps.length;
  audit.rejectionAnalytics = rejectionAnalytics.summary;
  audit.rejectionSamples = rejectionAnalytics.rejected.slice(0, 40);
  audit.qualificationAnalytics = pool.analytics;

  return {
    ready: readyDisplay,
    elite: elite.slice(0, RENDER_LIMITS.topPicks || 2),
    near: nearDisplay,
    research: researchDisplay,
    watchlist: researchDisplay,
    allDisplayable,
    rejected,
    historyWeights,
    rejectionAnalytics,
    qualificationAnalytics: pool.analytics,
    tierThresholds: pool.tierThresholds,
  };
}

function recordReject(audit, reason, stage, prop) {
  if (!audit) return;
  recordFilterReason(audit, reason, prop, stage);
}
