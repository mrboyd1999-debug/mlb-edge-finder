/**
 * Best Plays outcome tracking — persist generated board picks and build performance dashboard.
 */

import { readHistory, writeHistory } from "./pickStore.js";
import { gradeOutcome, autoGradePendingOutcomes, pickStatus, normalizeOutcomeStatus } from "./outcomeTracking.js";
import { resolveRecommendedSide, classifyConfidenceTier } from "../utils/boardQuality.js";
import { normalizeSource } from "../utils/normalizeSource.js";

export const BEST_PLAYS_TRACKING = {
  BEST_PLAYS: "best-plays",
  SAFEST: "safest-plays",
  VALUE_UNDERS: "value-unders",
  VALUE_OVERS: "value-overs",
  HIGHEST_EDGE: "highest-edge",
  VERIFIED: "verified-plays",
};

const TRACKING_SOURCE = "best-plays-board";
const MIN_CATEGORY_SAMPLE = 3;

function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function normalize(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function withinDays(row = {}, days = 7, now = Date.now()) {
  const stamp = new Date(row.generatedAt || row.timestamp || row.createdAt || row.slateDate).getTime();
  if (!Number.isFinite(stamp)) return false;
  return now - stamp <= days * 24 * 60 * 60 * 1000;
}

function sideBucket(row = {}) {
  const side = String(row.recommendedSide || row.pickDirection || row.side || "").toUpperCase();
  if (side.includes("UNDER") || side.includes("LESS")) return "under";
  if (side.includes("OVER") || side.includes("MORE")) return "over";
  return "other";
}

function platformBucket(row = {}) {
  const source = normalizeSource(row);
  if (source === "prizepicks") return "prizepicks";
  if (source === "underdog") return "underdog";
  return source || "other";
}

function tierBucket(row = {}) {
  const tier = String(row.confidenceTier || classifyConfidenceTier(row.confidenceScore ?? row.confidence) || "")
    .toUpperCase()
    .replace(/^TIER\s*/i, "");
  if (["A", "B", "C", "D"].includes(tier)) return tier;
  return classifyConfidenceTier(row.confidenceScore ?? row.confidence) || "D";
}

export function bestPlayOutcomeIdentity(prop = {}, sectionId = BEST_PLAYS_TRACKING.BEST_PLAYS) {
  const slateDate = prop.slateDate || dateKey(new Date(prop.startTime || prop.timestamp || Date.now()));
  return [
    TRACKING_SOURCE,
    sectionId,
    slateDate,
    normalizeSource(prop),
    prop.playerName || prop.player,
    prop.statType || prop.market || prop.propType,
    prop.line,
    resolveRecommendedSide(prop),
  ]
    .map(normalize)
    .join("|");
}

export function toBestPlayOutcomeRecord(prop = {}, sectionId = BEST_PLAYS_TRACKING.BEST_PLAYS) {
  const timestamp = prop.generatedAt || new Date().toISOString();
  const slateDate = prop.slateDate || dateKey(new Date(prop.startTime || timestamp));
  const confidence = Number(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence ?? 0);
  const recommendedSide = resolveRecommendedSide(prop);
  const uniqueKey = bestPlayOutcomeIdentity({ ...prop, slateDate }, sectionId);
  const resultStatus = pickStatus(prop);

  return {
    id: uniqueKey,
    propId: prop.id || uniqueKey,
    uniqueKey,
    trackingSource: TRACKING_SOURCE,
    boardSection: sectionId,
    recommendation: sectionId,
    categorySource: sectionId,
    slateDate,
    date: slateDate,
    timestamp,
    generatedAt: timestamp,
    createdAt: timestamp,
    gameStartTime: prop.startTime || null,
    startTime: prop.startTime || null,
    player: prop.playerName || prop.player,
    playerName: prop.playerName || prop.player,
    sport: prop.sport || "MLB",
    league: prop.league || prop.sport || "MLB",
    propType: prop.statType || prop.market || prop.propType,
    statType: prop.statType || prop.market || prop.propType,
    market: prop.statType || prop.market || prop.propType,
    platform: prop.platform || normalizeSource(prop),
    source: prop.platform || normalizeSource(prop),
    team: prop.team || "",
    opponent: prop.opponent || "",
    line: Number(prop.line),
    projection: prop.projection ?? prop.projectedValue ?? null,
    confidence,
    confidenceScore: confidence,
    confidenceTier: prop.confidenceTier || classifyConfidenceTier(confidence),
    probabilityScore: prop.probabilityScore ?? prop.verifiedProbability ?? null,
    playabilityScore: prop.playabilityScore ?? null,
    recommendedSide,
    bestPick: recommendedSide === "UNDER" ? "under" : recommendedSide === "OVER" ? "over" : "pass",
    pickDirection: recommendedSide === "UNDER" ? "under" : recommendedSide === "OVER" ? "over" : "pass",
    side: recommendedSide === "UNDER" ? "under" : recommendedSide === "OVER" ? "over" : "pass",
    pick: recommendedSide === "UNDER" ? "under" : recommendedSide === "OVER" ? "over" : "pass",
    result: resultStatus,
    resultStatus,
    finalResult: resultStatus,
    status: normalizeOutcomeStatus(resultStatus),
    actualResult: prop.actualStatResult ?? prop.actualResult ?? null,
    actualStatResult: prop.actualStatResult ?? prop.actualResult ?? null,
    settledAt: prop.settledAt || null,
    reasoningSummary: prop.rankingReason || prop.qualifyReason || prop.whyThisPick || "",
    notes: prop.rankingReason || prop.qualifyReason || "",
  };
}

export function mergeBestPlayOutcomeRecords(existing = [], additions = []) {
  const byKey = new Map();
  for (const row of existing || []) {
    byKey.set(row.uniqueKey || bestPlayOutcomeIdentity(row, row.boardSection), row);
  }
  for (const row of additions || []) {
    const key = row.uniqueKey || bestPlayOutcomeIdentity(row, row.boardSection);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, {
      ...current,
      ...row,
      resultStatus: current.resultStatus !== "Pending" ? current.resultStatus : row.resultStatus,
      finalResult: current.finalResult !== "Pending" ? current.finalResult : row.finalResult,
      result: current.result !== "Pending" ? current.result : row.result,
      actualStatResult: current.actualStatResult ?? row.actualStatResult ?? null,
      settledAt: current.settledAt || row.settledAt || null,
      updatedAt: new Date().toISOString(),
    });
  }
  return Array.from(byKey.values());
}

function sectionPicks(board = {}, sectionId = "") {
  return (board?.sections || []).find((row) => row.id === sectionId)?.picks || [];
}

export function persistBestPlaysBoardOutcomes(board = {}, existing = readHistory()) {
  const batches = [
    [sectionPicks(board, "top-10-best-plays"), BEST_PLAYS_TRACKING.BEST_PLAYS],
    [sectionPicks(board, "top-5-safest"), BEST_PLAYS_TRACKING.SAFEST],
    [sectionPicks(board, "top-5-value-unders"), BEST_PLAYS_TRACKING.VALUE_UNDERS],
    [sectionPicks(board, "top-5-value-overs"), BEST_PLAYS_TRACKING.VALUE_OVERS],
    [sectionPicks(board, "top-5-highest-edge"), BEST_PLAYS_TRACKING.HIGHEST_EDGE],
    [sectionPicks(board, "verified-plays"), BEST_PLAYS_TRACKING.VERIFIED],
  ];
  const additions = batches.flatMap(([picks, sectionId]) =>
    (picks || []).map((prop) => toBestPlayOutcomeRecord(prop, sectionId))
  );
  if (!additions.length) return existing;
  const merged = mergeBestPlayOutcomeRecords(existing, additions);
  return merged;
}

function summarizeRows(rows = []) {
  const settled = rows.filter((row) => ["Win", "Loss"].includes(pickStatus(row)));
  const wins = settled.filter((row) => pickStatus(row) === "Win").length;
  const losses = settled.filter((row) => pickStatus(row) === "Loss").length;
  const pushes = rows.filter((row) => pickStatus(row) === "Push").length;
  const accuracy = settled.length ? Math.round((wins / settled.length) * 100) : null;

  const categoryStats = (filterFn) => {
    const subset = settled.filter(filterFn);
    if (subset.length < MIN_CATEGORY_SAMPLE) return null;
    const categoryWins = subset.filter((row) => pickStatus(row) === "Win").length;
    return {
      wins: categoryWins,
      losses: subset.length - categoryWins,
      sample: subset.length,
      accuracy: Math.round((categoryWins / subset.length) * 100),
    };
  };

  const categories = {
    overall: categoryStats(() => true),
    over: categoryStats((row) => sideBucket(row) === "over"),
    under: categoryStats((row) => sideBucket(row) === "under"),
    tierA: categoryStats((row) => tierBucket(row) === "A"),
    tierB: categoryStats((row) => tierBucket(row) === "B"),
    tierC: categoryStats((row) => tierBucket(row) === "C"),
    prizepicks: categoryStats((row) => platformBucket(row) === "prizepicks"),
    underdog: categoryStats((row) => platformBucket(row) === "underdog"),
  };

  const ranked = Object.entries(categories)
    .filter(([, stats]) => stats && Number.isFinite(stats.accuracy))
    .sort((a, b) => b[1].accuracy - a[1].accuracy);

  return {
    wins,
    losses,
    pushes,
    pending: rows.filter((row) => pickStatus(row) === "Pending").length,
    accuracy,
    categories,
    bestCategory: ranked[0] ? { key: ranked[0][0], ...ranked[0][1] } : null,
    worstCategory: ranked.length ? { key: ranked[ranked.length - 1][0], ...ranked[ranked.length - 1][1] } : null,
  };
}

export function filterBestPlaysTrackingHistory(history = []) {
  return (history || []).filter((row) => row.trackingSource === TRACKING_SOURCE);
}

export function buildPerformanceTrackerDashboard(history = [], { now = Date.now() } = {}) {
  const tracked = filterBestPlaysTrackingHistory(history);
  return {
    last7Days: summarizeRows(tracked.filter((row) => withinDays(row, 7, now))),
    last30Days: summarizeRows(tracked.filter((row) => withinDays(row, 30, now))),
    allTime: summarizeRows(tracked),
    trackedCount: tracked.length,
  };
}

export function syncBestPlaysOutcomeHistory(history = readHistory(), statsMap = new Map()) {
  const graded = autoGradePendingOutcomes(history, statsMap);
  if (graded.settledCount > 0 || graded.history.length !== history.length) {
    writeHistory(graded.history);
  }
  return graded;
}

export function gradeBestPlayOutcome(pick = {}, actualStatResult = null) {
  return gradeOutcome(pick, actualStatResult);
}
