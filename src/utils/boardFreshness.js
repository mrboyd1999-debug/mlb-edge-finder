/**
 * Board freshness — live status requires today's data under 15 minutes old.
 */

import { formatDateTime } from "./formatters.js";

export const BOARD_LIVE_FRESH_MAX_AGE_MS = 15 * 60 * 1000;
export const STALE_DATA_HEADLINE = "STALE DATA — refresh required";
export const CACHE_DATA_HEADLINE = "Cache Data";
export const LIVE_DATA_HEADLINE = "Live Data Available";

export function parseBoardTimestamp(value = "") {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function isBoardTimestampToday(value = "") {
  const ts = parseBoardTimestamp(value);
  if (ts == null) return false;
  const boardDate = new Date(ts);
  const now = new Date();
  return (
    boardDate.getFullYear() === now.getFullYear() &&
    boardDate.getMonth() === now.getMonth() &&
    boardDate.getDate() === now.getDate()
  );
}

export function resolveBoardAgeMinutes(value = "") {
  const ts = parseBoardTimestamp(value);
  if (ts == null) return null;
  return Math.round((Date.now() - ts) / 60_000);
}

export function isBoardFreshForLiveDisplay(
  boardUpdatedAt = "",
  maxAgeMs = BOARD_LIVE_FRESH_MAX_AGE_MS
) {
  const ts = parseBoardTimestamp(boardUpdatedAt);
  if (ts == null) return false;
  if (!isBoardTimestampToday(boardUpdatedAt)) return false;
  return Date.now() - ts <= maxAgeMs;
}

export function isBoardStale(boardUpdatedAt = "", maxAgeMs = BOARD_LIVE_FRESH_MAX_AGE_MS) {
  return !isBoardFreshForLiveDisplay(boardUpdatedAt, maxAgeMs);
}

export function buildBoardFreshnessDebug({
  boardUpdatedAt = "",
  currentFetchTime = "",
  liveProviderCount = 0,
  liveNormalizedCount = 0,
  cacheUsed = false,
} = {}) {
  const ageMinutes = resolveBoardAgeMinutes(boardUpdatedAt);
  const hasLiveNormalized = Number(liveNormalizedCount) > 0 && Number(liveProviderCount) > 0;
  const fresh = hasLiveNormalized || (isBoardFreshForLiveDisplay(boardUpdatedAt) && !cacheUsed);
  const stale = !fresh;

  return {
    currentFetchTime: currentFetchTime || "",
    boardUpdatedAt: boardUpdatedAt || "",
    boardAgeMinutes: ageMinutes,
    liveProviderCount: Number(liveProviderCount) || 0,
    liveNormalizedCount: Number(liveNormalizedCount) || 0,
    cacheUsed: Boolean(cacheUsed),
    stale,
    fresh,
    liveEligible: fresh && Number(liveProviderCount) > 0,
  };
}

export function formatCachedDataNotice(boardUpdatedAt = "") {
  if (!boardUpdatedAt) return "Using cached data (timestamp unknown)";
  return `Using cached data from ${formatDateTime(boardUpdatedAt)}`;
}

export function resolveLiveFeedHeadline({
  loading = false,
  boardFreshness = null,
  apiHealthHeadline = "",
} = {}) {
  if (loading) return "Loading feeds…";
  if (boardFreshness?.liveEligible && !boardFreshness?.cacheUsed) return LIVE_DATA_HEADLINE;
  if (boardFreshness?.stale) return STALE_DATA_HEADLINE;
  if (boardFreshness?.cacheUsed) return CACHE_DATA_HEADLINE;
  return apiHealthHeadline || "Limited";
}
