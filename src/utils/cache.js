/**
 * Board cache helpers — live fetch wins over stale localStorage paint.
 */

export const BOARD_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function parseBoardCacheTimestamp(value = "") {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function isBoardCacheStale(timestamp = "", maxAgeMs = BOARD_CACHE_MAX_AGE_MS) {
  const ts = parseBoardCacheTimestamp(timestamp);
  if (ts == null) return false;
  return Date.now() - ts > maxAgeMs;
}

export function resolveBoardCacheAgeHours(timestamp = "") {
  const ts = parseBoardCacheTimestamp(timestamp);
  if (ts == null) return null;
  return (Date.now() - ts) / 3_600_000;
}

export function resolveLastRefreshTimestamp({
  lastUpdated = "",
  feedMode = "",
  providerAudit = null,
  debugInfo = null,
} = {}) {
  const audit = providerAudit || debugInfo?.providerCoverageAudit || {};
  const liveFeed = audit?.liveFeedDiagnostics || {};
  const liveMode = String(feedMode || audit.feedMode || "").toUpperCase() === "LIVE";
  const liveTs =
    audit.lastSuccessfulFetchAt ||
    liveFeed.lastSuccessfulFetchAt ||
    audit.ingestionTimestamp ||
    audit.renderedBoardTimestamp ||
    audit.providerAuditTimestamp ||
    "";

  if (liveMode) {
    return liveTs || lastUpdated || audit.boardCacheTimestamp || "";
  }

  return lastUpdated || liveTs || audit.boardCacheTimestamp || "";
}

/**
 * After a successful live refresh, clear stale cache flags and stamp fresh timestamps.
 */
export function clearStaleBoardCacheIfLiveFetchSucceeds({
  livePropsCount = 0,
  combinedUsable = 0,
  feedMode = "",
  boardCacheTimestamp = "",
  debugInfo = null,
} = {}) {
  const liveCount = Math.max(finite(livePropsCount), finite(combinedUsable));
  const liveMode = String(feedMode || "").toUpperCase() === "LIVE" || liveCount > 0;
  if (!liveMode || liveCount <= 0) {
    const stale = isBoardCacheStale(boardCacheTimestamp || debugInfo?.boardCacheTimestamp);
    return {
      cleared: false,
      boardCacheActive: Boolean(stale && liveCount === 0),
      boardCacheTimestamp: boardCacheTimestamp || debugInfo?.boardCacheTimestamp || "",
      feedMode: feedMode || debugInfo?.providerCoverageAudit?.feedMode || "CACHE",
      cacheStale: stale,
    };
  }

  const now = new Date().toISOString();
  return {
    cleared: true,
    boardCacheActive: false,
    boardCacheTimestamp: now,
    feedMode: "LIVE",
    cacheFallbackStage: "",
    cacheBoardMessage: "",
    ingestionTimestamp: now,
    providerAuditTimestamp: now,
    renderedBoardTimestamp: now,
    lastSuccessfulFetchAt: now,
    cacheStale: false,
  };
}

export function shouldUseBoardCacheFallback({
  livePropsCount = 0,
  combinedUsable = 0,
  boardCacheTimestamp = "",
} = {}) {
  const liveCount = Math.max(finite(livePropsCount), finite(combinedUsable));
  if (liveCount > 0) return false;
  if (isBoardCacheStale(boardCacheTimestamp)) return false;
  return Boolean(boardCacheTimestamp);
}
