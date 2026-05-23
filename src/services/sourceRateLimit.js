/** Per-source rate-limit state, cooldowns, and request locks. */

export const SOURCE_IDS = {
  PRIZEPICKS: "PrizePicks",
  UNDERDOG: "Underdog",
  ODDS_API: "Odds API",
};

export const RATE_LIMIT_COOLDOWN_MESSAGE = "Rate limited. Showing cached lines until cooldown ends.";
export const VERIFIED_CACHE_FALLBACK_MESSAGE = "Using recently verified cached MLB props.";
export const NO_VERIFIED_AFTER_COOLDOWN_MESSAGE =
  "No verified sportsbook props available. Try again after cooldown.";

/** 429 backoff: 30s → 1m → 3m → 5m (and stays at 5m). */
const BACKOFF_MS = [30_000, 60_000, 180_000, 300_000];
const STORAGE_KEY = "dfs-source-rate-limit-v1";
export const MIN_SOURCE_CACHE_MS = 10 * 60 * 1000;

const inFlightPromises = new Map();
let memoryState = null;

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

export async function withSourceRequestLock(sourceId, fn) {
  if (inFlightPromises.has(sourceId)) {
    return inFlightPromises.get(sourceId);
  }
  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      inFlightPromises.delete(sourceId);
    });
  inFlightPromises.set(sourceId, promise);
  return promise;
}

export function isSourceRequestInFlight(sourceId) {
  return inFlightPromises.has(sourceId);
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
      lastError: state.lastError,
      inFlight: isSourceRequestInFlight(sourceId),
    };
  });
  return snapshot;
}
