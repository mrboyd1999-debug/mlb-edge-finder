/** Board-level fetch coordination — prevents duplicate concurrent refreshes. */

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const MANUAL_REFRESH_COOLDOWN_MS = 30 * 1000;

let boardFetchInFlight = false;
let queuedBoardFetch = null;
let lastAutoRefreshAt = 0;

export function getAutoRefreshIntervalMs() {
  return AUTO_REFRESH_MS;
}

export function getManualRefreshCooldownMs() {
  return MANUAL_REFRESH_COOLDOWN_MS;
}

export function isTabActive() {
  try {
    return typeof document === "undefined" || document.visibilityState === "visible";
  } catch {
    return true;
  }
}

export function canAutoRefresh(now = Date.now(), lastRefreshAt = 0) {
  if (!isTabActive()) return false;
  if (boardFetchInFlight) return false;
  if (!lastRefreshAt) return true;
  return now - lastRefreshAt >= AUTO_REFRESH_MS;
}

export function markAutoRefresh(now = Date.now()) {
  lastAutoRefreshAt = now;
}

export function getLastAutoRefreshAt() {
  return lastAutoRefreshAt;
}

export function isBoardFetchInFlight() {
  return boardFetchInFlight;
}

/**
 * Ensures only one board fetch runs at a time.
 * Queued callers receive the result of the in-flight fetch.
 */
export async function withBoardFetchLock(run) {
  if (boardFetchInFlight) {
    if (!queuedBoardFetch) {
      queuedBoardFetch = new Promise((resolve, reject) => {
        queuedBoardFetch._resolve = resolve;
        queuedBoardFetch._reject = reject;
      });
    }
    return queuedBoardFetch;
  }

  boardFetchInFlight = true;
  try {
    const result = await run();
    if (queuedBoardFetch?._resolve) queuedBoardFetch._resolve(result);
    return result;
  } catch (error) {
    if (queuedBoardFetch?._reject) queuedBoardFetch._reject(error);
    throw error;
  } finally {
    boardFetchInFlight = false;
    queuedBoardFetch = null;
  }
}
