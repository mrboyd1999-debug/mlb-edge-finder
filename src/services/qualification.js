import { recordFilterReason } from "../utils/propPipelineDebug.js";
import { MLB_ONLY_MODE, guardMlbOnlyProp } from "../utils/mlbOnlyMode.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { computeRankScore } from "./projectionEngine.js";
import {
  hasValidPickFields,
  getReadyToBetRejectReason,
  isReadyToBet,
  READY_MIN_CONFIDENCE,
  READY_MIN_DATA_QUALITY,
} from "./pickScoring.js";

export const DISPLAY_MIN_CONFIDENCE = 40;
export const NEAR_CONFIDENCE_MIN = 58;
export const NEAR_CONFIDENCE_MAX = 64;
export const NEAR_DQ_MIN = 40;
export const NEAR_DQ_MAX = 49;

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
  if (isReadyToBet(prop)) return false;
  if (!isDisplayable(prop)) return false;
  const confidence = Number(prop.confidenceScore ?? 0);
  const dq = Number(prop.dataQualityScore ?? 0);
  const nearConf = confidence >= NEAR_CONFIDENCE_MIN && confidence <= NEAR_CONFIDENCE_MAX;
  const nearDq = dq >= NEAR_DQ_MIN && dq <= NEAR_DQ_MAX;
  return nearConf || nearDq;
}

export function classifyDisplayTier(prop) {
  if (!isDisplayable(prop)) return null;
  if (isReadyToBet(prop)) return "ready";
  if (isNearQualification(prop)) return "near";
  return "research";
}

export function applyQualificationLabels(prop) {
  const tier = classifyDisplayTier(prop);
  if (!tier) {
    return {
      ...prop,
      displayTier: null,
      recommendationStatus: "rejected",
      bettingLabel: "Hidden",
      rejectionReason: prop.rejectionReason || "below display threshold",
      rejectionStage: prop.rejectionStage || "display",
    };
  }
  const bettingLabel =
    tier === "ready" ? "Ready to Bet" : tier === "near" ? "Near Qualification" : "Research only";
  const recommendationStatus = tier === "ready" ? "ready" : tier === "near" ? "near" : "research";
  return {
    ...prop,
    displayTier: tier,
    recommendationStatus,
    bettingLabel,
    rejectionReason: "",
    rejectionStage: "",
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
  return [
    prop.playerName,
    prop.sport,
    prop.statType,
    prop.startTime,
    prop.platform,
  ]
    .join("|")
    .toLowerCase();
}

function gameKey(prop) {
  return [prop.sport, prop.team, prop.opponent, prop.startTime].join("|").toLowerCase();
}

export function avoidCorrelatedProps(props = [], limit = 120) {
  const selected = [];
  const usedPlayers = new Set();
  const gameCounts = new Map();

  const tierPriority = (prop) => (prop.displayTier === "ready" ? 3 : prop.displayTier === "near" ? 2 : 1);
  const sorted = [...props].sort(
    (a, b) =>
      tierPriority(b) - tierPriority(a) ||
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
  const ready = [];
  const near = [];
  const research = [];
  const rejected = [];

  scopedProps.forEach((prop) => {
    const labeled = applyQualificationLabels(prop);
    const tier = labeled.displayTier;
    if (!tier) {
      rejected.push(labeled);
      recordReject(audit, labeled.rejectionReason || "below display threshold", "display", labeled);
      return;
    }
    if (tier === "ready") {
      ready.push(labeled);
    } else {
      recordReject(audit, getReadyToBetRejectReason(labeled) || "not ready to bet", "qualification", labeled);
      if (tier === "near") near.push(labeled);
      else research.push(labeled);
    }
  });

  const allDisplayable = avoidCorrelatedProps(
    [...ready, ...near, ...research].sort((a, b) => computeRankScore(b) - computeRankScore(a)),
    40
  );

  audit.displayed = allDisplayable.length;
  audit.ready = ready.length;
  audit.near = near.length;
  audit.research = research.length;
  audit.scored = scoredProps.length;

  return {
    ready: ready.sort(
      (a, b) =>
        Number(b.priorityScore || 0) - Number(a.priorityScore || 0) || computeRankScore(b) - computeRankScore(a)
    ),
    near: near.sort(
      (a, b) =>
        Number(b.priorityScore || 0) - Number(a.priorityScore || 0) ||
        Number(b.confidenceScore) - Number(a.confidenceScore)
    ),
    research: research.sort(
      (a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0) || computeRankScore(b) - computeRankScore(a)
    ),
    allDisplayable,
    rejected,
    historyWeights,
  };
}

function recordReject(audit, reason, stage, prop) {
  if (!audit) return;
  recordFilterReason(audit, reason, prop, stage);
}
