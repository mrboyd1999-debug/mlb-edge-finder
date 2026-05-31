import { normalize } from "./formatters.js";

/** Normalized game lifecycle states used across the DFS pipeline. */
export const GAME_STATUS = {
  scheduled: "scheduled",
  pregame: "pregame",
  live: "live",
  final: "final",
  postponed: "postponed",
};

export const DEFAULT_PREGAME_WINDOW_HOURS = 24;
export const DEFAULT_PREGAME_WINDOW_MS = DEFAULT_PREGAME_WINDOW_HOURS * 60 * 60 * 1000;
export const MIN_START_BUFFER_MS = 60 * 1000;

const EXCLUDED_GAME_STATUSES = new Set([GAME_STATUS.live, GAME_STATUS.final, GAME_STATUS.postponed]);

/** High-volume slate reasons logged as summaries instead of per-prop spam. */
export const SLATE_QUIET_REASONS = new Set([
  "game is live",
  "game already started",
  "game is final",
  "game is postponed",
  "outside pregame window",
]);

const LIVE_PATTERNS = /\b(live|inprogress|in progress|in-game|ingame)\b/i;
const FINAL_PATTERNS = /\b(final|finished|complete|completed|ended|closed|full time|ft)\b/i;
const POSTPONED_PATTERNS = /\b(postponed|postponement|delayed|suspended game|ppd|cancelled|canceled)\b/i;
const PREGAME_PATTERNS = /\b(pregame|pre-game|pre game|scheduled|upcoming|open)\b/i;

export function readPregameWindowMs(filterPrefs = {}) {
  const hours = Number(filterPrefs.pregameWindowHours ?? DEFAULT_PREGAME_WINDOW_HOURS);
  if (!Number.isFinite(hours) || hours <= 0) return Number.MAX_SAFE_INTEGER;
  return hours * 60 * 60 * 1000;
}

export function normalizeGameStatus(prop = {}) {
  const blob = [
    prop.gameStatus,
    prop.status,
    prop.lineStatus,
    prop.league,
    prop.description,
    prop.eventStatus,
  ]
    .filter(Boolean)
    .join(" ");

  if (prop.isLive || prop.inGame || prop.is_live || prop.in_game) return GAME_STATUS.live;
  if (POSTPONED_PATTERNS.test(blob)) return GAME_STATUS.postponed;
  if (FINAL_PATTERNS.test(blob)) return GAME_STATUS.final;
  if (LIVE_PATTERNS.test(blob)) return GAME_STATUS.live;

  const start = new Date(prop.startTime).getTime();
  if (Number.isFinite(start)) {
    if (start <= Date.now() - MIN_START_BUFFER_MS) return GAME_STATUS.live;
    if (PREGAME_PATTERNS.test(blob)) return GAME_STATUS.pregame;
    if (start > Date.now() + MIN_START_BUFFER_MS) return GAME_STATUS.scheduled;
    return GAME_STATUS.pregame;
  }

  const lower = normalize(blob);
  if (lower.includes("postpon")) return GAME_STATUS.postponed;
  if (lower.includes("final") || lower.includes("complete") || lower.includes("closed")) return GAME_STATUS.final;
  if (lower.includes("live") || lower.includes("inprogress")) return GAME_STATUS.live;
  if (lower.includes("pregame") || lower.includes("scheduled") || lower.includes("upcoming")) return GAME_STATUS.pregame;
  return GAME_STATUS.scheduled;
}

export function attachNormalizedGameStatus(prop = {}) {
  const normalizedGameStatus = normalizeGameStatus(prop);
  return {
    ...prop,
    normalizedGameStatus,
    gameStatus: prop.gameStatus || normalizedGameStatus,
  };
}

export function isExcludedGameStatus(status = "") {
  return EXCLUDED_GAME_STATUSES.has(String(status || "").toLowerCase());
}

export function isGameStarted(prop, bufferMs = MIN_START_BUFFER_MS) {
  const start = new Date(prop.startTime).getTime();
  if (!Number.isFinite(start)) return false;
  return start <= Date.now() + bufferMs;
}

export function isWithinPregameWindow(prop, windowMs = DEFAULT_PREGAME_WINDOW_MS) {
  const start = new Date(prop.startTime).getTime();
  if (!Number.isFinite(start)) return false;
  const now = Date.now();
  return start > now + MIN_START_BUFFER_MS && start <= now + windowMs;
}

export function getSlateFilterReason(prop = {}, options = {}) {
  const includeUncertain = Boolean(options.includeUncertain);
  const windowMs = readPregameWindowMs(options);
  const enriched = prop.normalizedGameStatus ? prop : attachNormalizedGameStatus(prop);
  const status = enriched.normalizedGameStatus;

  if (isExcludedGameStatus(status)) {
    if (status === GAME_STATUS.live) return "game is live";
    if (status === GAME_STATUS.final) return "game is final";
    if (status === GAME_STATUS.postponed) return "game is postponed";
  }

  const liveLabel = normalize(`${prop.league || ""} ${prop.status || ""} ${prop.gameStatus || ""}`);
  if (liveLabel.includes("live") || liveLabel.includes("inprogress") || prop.status === "live") {
    return "game is live";
  }

  if (!includeUncertain) {
    if (isGameStarted(enriched)) return "game already started";
    const start = new Date(enriched.startTime).getTime();
    if (!Number.isFinite(start)) {
      if (!prop.partialTimeLabel) return "missing valid start time";
    } else if (start > Date.now() + windowMs) {
      return "outside pregame window";
    }
  }

  if (prop.status === "locked" || prop.status === "expired") return "prop is locked or expired";
  return "";
}

export function isUpcomingSlateProp(prop = {}, options = {}) {
  return getSlateFilterReason(prop, options) === "";
}

export function filterUpcomingSlate(props = [], options = {}, audit = null, hooks = {}) {
  const record = hooks.recordFilterReason || (() => {});
  const logProp = hooks.logFilteredProp || (() => {});
  const quietCounts = new Map();
  const kept = [];

  props.forEach((prop) => {
    const enriched = attachNormalizedGameStatus(prop);
    const reason = getSlateFilterReason(enriched, options);
    if (!reason) {
      kept.push(enriched);
      return;
    }

    record(audit, reason, enriched, "slate");
    if (SLATE_QUIET_REASONS.has(reason)) {
      quietCounts.set(reason, (quietCounts.get(reason) || 0) + 1);
    } else {
      logProp(enriched, reason);
    }
  });

  if (audit) {
    audit.upcomingSlate = kept.length;
    audit.slateExcluded = props.length - kept.length;
    audit.slateExclusionReasons = Object.fromEntries(quietCounts);
  }

  if (quietCounts.size && hooks.logSlateSummary !== false) {
    logSlateFilterSummary(quietCounts, props.length - kept.length);
  }

  return kept;
}

export function logSlateFilterSummary(quietCounts, totalExcluded = 0) {
  if (!totalExcluded) return;
  const breakdown = [...quietCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(" · ");
  console.info("[DFS Slate] excluded non-upcoming props", {
    totalExcluded,
    breakdown,
  });
}
