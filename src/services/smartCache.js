/** Persistent cache TTLs for MLB engine layers. */

export const CACHE_TTL = {
  PROPS_MS: 3 * 60 * 1000,
  PROJECTIONS_MS: 10 * 60 * 1000,
  STATS_MS: 30 * 60 * 1000,
  BOARD_MS: 3 * 60 * 1000,
  MLB_BOARD_MS: 8 * 60 * 1000,
  MLB_VERIFIED_CACHE_MS: 8 * 60 * 1000,
  MLB_STALE_WARNING_MS: 12 * 60 * 1000,
  MLB_EXPIRED_MS: 15 * 60 * 1000,
  STALE_MULTIPLIER: 2,
};

const STORAGE_PREFIX = "dfs-smart-cache:";

function nowMs() {
  return Date.now();
}

function readEntry(key) {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEntry(key, value) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify({ ...value, savedAt: nowMs() }));
  } catch {
    // ignore storage failures
  }
}

export function resolveCacheLayer(savedAt = 0, ttlMs = CACHE_TTL.PROPS_MS) {
  if (!savedAt) return "EMPTY";
  const age = nowMs() - savedAt;
  if (age <= ttlMs) return "LIVE";
  if (age <= ttlMs * CACHE_TTL.STALE_MULTIPLIER) return "CACHED";
  return "STALE";
}

export function formatCacheLayerLabel(layer = "") {
  const key = String(layer || "").toUpperCase();
  if (key === "LIVE" || key === "FRESH") return "LIVE";
  if (key === "VERIFIED_CACHE" || key === "VERIFIED-CACHE" || key === "VERIFIED CACHE") return "VERIFIED CACHE";
  if (key === "CACHED") return "CACHED";
  if (key === "STALE_WARNING" || key === "STALE-WARNING") return "STALE WARNING";
  if (key === "STALE") return "STALE";
  if (key === "EXPIRED") return "EXPIRED";
  if (key === "EMPTY") return "—";
  return key || "—";
}

export function readSmartCache(namespace, key) {
  const entry = readEntry(`${namespace}:${key}`);
  if (!entry) return null;
  return entry;
}

export function writeSmartCache(namespace, key, payload, meta = {}) {
  writeEntry(`${namespace}:${key}`, { payload, meta });
}

export function readSmartCacheIfFresh(namespace, key, ttlMs) {
  const entry = readEntry(`${namespace}:${key}`);
  if (!entry?.payload) return null;
  const savedAt = Number(entry.savedAt || 0);
  if (!savedAt || nowMs() - savedAt > ttlMs) return null;
  return {
    payload: entry.payload,
    savedAt,
    layer: resolveCacheLayer(savedAt, ttlMs),
    meta: entry.meta || {},
  };
}

export function readSmartCacheAllowStale(namespace, key, ttlMs) {
  const entry = readEntry(`${namespace}:${key}`);
  if (!entry?.payload) return null;
  const savedAt = Number(entry.savedAt || 0);
  const layer = resolveCacheLayer(savedAt, ttlMs);
  if (layer === "STALE" && nowMs() - savedAt > ttlMs * CACHE_TTL.STALE_MULTIPLIER * 1.5) return null;
  return {
    payload: entry.payload,
    savedAt,
    layer,
    meta: entry.meta || {},
  };
}

export function isBoardCacheFresh(updatedAt = "", ttlMs = CACHE_TTL.BOARD_MS) {
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return nowMs() - ts <= ttlMs;
}
