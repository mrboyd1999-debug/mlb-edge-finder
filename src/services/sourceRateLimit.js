/** Per-source rate-limit state, cooldowns, and request locks. */

export const SOURCE_IDS = {
  PRIZEPICKS: "PrizePicks",
  UNDERDOG: "Underdog",
  ODDS_API: "Odds API",
  SPORTSDATA: "SportsDataIO",
};

export const RATE_LIMIT_COOLDOWN_MESSAGE = "Rate limited. Showing cached lines until cooldown ends.";
export const VERIFIED_CACHE_FALLBACK_MESSAGE = "Using verified MLB cache while refreshing live sportsbook lines.";
export const NO_VERIFIED_AFTER_COOLDOWN_MESSAGE =
  "No verified sportsbook props available. Try again after cooldown.";

/** 429 backoff: 30s → 1m → 3m → 5m (and stays at 5m). */
const BACKOFF_MS = [30_000, 60_000, 180_000, 300_000];
const STORAGE_KEY = "dfs-source-rate-limit-v1";
export const MIN_SOURCE_CACHE_MS = 10 * 60 * 1000;

/**
 * Per-source minimum interval between two successful refreshes. Prevents the
 * frontend from hammering Underdog/PrizePicks when the user spams the refresh
 * button, which is the most common cause of 429s.
 */
const MIN_REQUEST_INTERVAL_MS = {
  PrizePicks: 45_000,
  Underdog: 5_000,
  "Odds API": 4_000,
  SportsDataIO: 2_000,
};

/** Per-source soft retry queue — exponential backoff for transient failures. */
const RETRY_QUEUE_BACKOFF_MS = [750, 1_500, 3_000, 6_000];

const inFlightPromises = new Map();
const lastDispatchAt = new Map();
let memoryState = null;
const sessionRequestCounts = {};

function bumpSessionRequestCount(sourceId) {
  sessionRequestCounts[sourceId] = (sessionRequestCounts[sourceId] || 0) + 1;
}

export function getSessionRequestCount(sourceId) {
  return sessionRequestCounts[sourceId] || 0;
}

function defaultSourceState() {
  return {
    status: "active",
    cooldownUntil: 0,
    strikeCount: 0,
    lastSuccessfulFetchAt: "",
    lastError: "",
    requestCount: 0,
    last429LoggedUntil: 0,
  };
}

function loadState() {
  if (memoryState) return memoryState;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    memoryState = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    memoryState = {};
  }
  return memoryState;
}

function saveState() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryState));
  } catch {
    // ignore storage errors
  }
}

function normalizeSourceState(raw = {}) {
  const base = defaultSourceState();
  const merged = { ...base, ...raw };
  if (isSourceInCooldownFromState(merged)) {
    merged.status = merged.status === "failed" ? "failed" : "rate_limited";
  } else if (merged.lastSuccessfulFetchAt && merged.status === "rate_limited") {
    merged.status = "cached";
  }
  return merged;
}

function isSourceInCooldownFromState(state = {}) {
  return Date.now() < Number(state.cooldownUntil || 0);
}

export function getSourceState(sourceId) {
  const state = loadState();
  return normalizeSourceState(state[sourceId] || {});
}

export function isSourceInCooldown(sourceId) {
  return isSourceInCooldownFromState(getSourceState(sourceId));
}

export function getCooldownRemainingMs(sourceId) {
  return Math.max(0, Number(getSourceState(sourceId).cooldownUntil || 0) - Date.now());
}

export function getMaxCooldownRemainingMs() {
  return Math.max(0, ...Object.values(SOURCE_IDS).map((id) => getCooldownRemainingMs(id)));
}

export function formatCooldownRemaining(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  if (totalSec >= 60) {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return sec ? `${min}m ${sec}s` : `${min}m`;
  }
  return `${totalSec}s`;
}

export function cachedLinesMessage(timestamp = "") {
  if (!timestamp) return RATE_LIMIT_COOLDOWN_MESSAGE;
  try {
    const formatted = new Date(timestamp).toLocaleString();
    return `Using cached lines from ${formatted}.`;
  } catch {
    return RATE_LIMIT_COOLDOWN_MESSAGE;
  }
}

export function cacheAgeMs(timestamp = "") {
  if (!timestamp) return null;
  const ms = new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Date.now() - ms);
}

export function formatCacheAge(timestamp = "") {
  const age = cacheAgeMs(timestamp);
  if (age == null) return "—";
  if (age < 60_000) return `${Math.round(age / 1000)}s ago`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`;
  return `${(age / 3_600_000).toFixed(1)}h ago`;
}

export function recordSource429(sourceId) {
  const state = loadState();
  const current = normalizeSourceState(state[sourceId] || {});
  const strikeIndex = Math.min(Math.max(0, current.strikeCount), BACKOFF_MS.length - 1);
  const backoffMs = BACKOFF_MS[strikeIndex];
  const cooldownUntil = Date.now() + backoffMs;

  const next = {
    ...current,
    strikeCount: Math.min(current.strikeCount + 1, BACKOFF_MS.length),
    cooldownUntil,
    status: "rate_limited",
    lastError: "Rate limited (429)",
    requestCount: current.requestCount + 1,
  };

  bumpSessionRequestCount(sourceId);
  if (Date.now() >= Number(current.last429LoggedUntil || 0)) {
    console.warn(
      `[DFS Rate Limit] ${sourceId} returned 429. Cooldown ${formatCooldownRemaining(backoffMs)}.`
    );
    next.last429LoggedUntil = cooldownUntil;
  }

  state[sourceId] = next;
  memoryState = state;
  saveState();
  return { backoffMs, cooldownUntil };
}

export function recordSourceSuccess(sourceId) {
  const state = loadState();
  const current = normalizeSourceState(state[sourceId] || {});
  const next = {
    ...current,
    status: "active",
    strikeCount: 0,
    cooldownUntil: 0,
    lastSuccessfulFetchAt: new Date().toISOString(),
    lastError: "",
    requestCount: current.requestCount + 1,
    last429LoggedUntil: 0,
  };
  state[sourceId] = next;
  memoryState = state;
  saveState();
  bumpSessionRequestCount(sourceId);
  return next;
}

export function recordSourceFailure(sourceId, error = "") {
  const state = loadState();
  const current = normalizeSourceState(state[sourceId] || {});
  const next = {
    ...current,
    status: isSourceInCooldownFromState(current) ? "rate_limited" : "failed",
    lastError: String(error || "Request failed"),
    requestCount: current.requestCount + 1,
  };
  state[sourceId] = next;
  memoryState = state;
  saveState();
  bumpSessionRequestCount(sourceId);
  return next;
}

export function markSourceCached(sourceId, lastSuccessfulFetchAt = "") {
  const state = loadState();
  const current = normalizeSourceState(state[sourceId] || {});
  const next = {
    ...current,
    status: isSourceInCooldownFromState(current) ? "rate_limited" : "cached",
    lastSuccessfulFetchAt: lastSuccessfulFetchAt || current.lastSuccessfulFetchAt,
  };
  state[sourceId] = next;
  memoryState = state;
  saveState();
  return next;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stagger consecutive calls per source. Resolves once at least
 * `MIN_REQUEST_INTERVAL_MS[sourceId]` ms have elapsed since the last dispatch.
 */
async function waitForSourceInterval(sourceId) {
  const minInterval = MIN_REQUEST_INTERVAL_MS[sourceId] || 0;
  if (!minInterval) return;
  const last = lastDispatchAt.get(sourceId) || 0;
  const wait = last + minInterval - Date.now();
  if (wait > 0) await sleep(wait);
  lastDispatchAt.set(sourceId, Date.now());
}

export async function withSourceRequestLock(sourceId, fn) {
  if (inFlightPromises.has(sourceId)) {
    return inFlightPromises.get(sourceId);
  }
  const promise = (async () => {
    await waitForSourceInterval(sourceId);
    return fn();
  })().finally(() => {
    inFlightPromises.delete(sourceId);
  });
  inFlightPromises.set(sourceId, promise);
  return promise;
}

/**
 * Retry queue with exponential backoff. The caller supplies an async
 * `attempt()` and an `isRetryable(result)` predicate. If `attempt()` throws or
 * `isRetryable()` is true, we wait and retry up to `RETRY_QUEUE_BACKOFF_MS`
 * entries. Aborts immediately when the source enters cooldown so we never
 * pile-on after a 429.
 */
export async function withSourceRetryQueue(sourceId, attempt, options = {}) {
  const { isRetryable = () => false, maxAttempts = RETRY_QUEUE_BACKOFF_MS.length + 1 } = options;
  let lastResult = null;
  let lastError = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    if (isSourceInCooldown(sourceId)) break;
    try {
      const result = await attempt(i);
      if (!isRetryable(result, null)) return result;
      lastResult = result;
    } catch (error) {
      lastError = error;
      if (!isRetryable(null, error)) throw error;
    }
    const backoff = RETRY_QUEUE_BACKOFF_MS[Math.min(i, RETRY_QUEUE_BACKOFF_MS.length - 1)];
    await sleep(backoff);
  }
  if (lastResult != null) return lastResult;
  if (lastError) throw lastError;
  return null;
}

export function isSourceRequestInFlight(sourceId) {
  return inFlightPromises.has(sourceId);
}

export function getMinRequestIntervalMs(sourceId) {
  return MIN_REQUEST_INTERVAL_MS[sourceId] || 0;
}

export function buildSourceHealthSnapshot() {
  const snapshot = {};
  Object.values(SOURCE_IDS).forEach((sourceId) => {
    const state = getSourceState(sourceId);
    snapshot[sourceId] = {
      status: state.status,
      lastSuccessfulFetchAt: state.lastSuccessfulFetchAt,
      cooldownRemainingMs: getCooldownRemainingMs(sourceId),
      cacheAge: formatCacheAge(state.lastSuccessfulFetchAt),
      requestCount: state.requestCount,
      sessionRequestCount: getSessionRequestCount(sourceId),
      lastError: state.lastError,
      inFlight: isSourceRequestInFlight(sourceId),
    };
  });
  return snapshot;
}
