import fs from "node:fs";
import path from "node:path";

/** Minimum interval between live PrizePicks upstream calls (90s). */
export const PRIZEPICKS_SERVER_COOLDOWN_MS = 90_000;

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "prizepicks-last.json");

let memoryCache = { savedAt: 0, data: null };
let lastUpstreamAt = 0;
let inFlight = null;

function readFileCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (!parsed?.data) return null;
    return { savedAt: parsed.savedAt || 0, data: parsed.data };
  } catch {
    return null;
  }
}

function writeFileCache(data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const savedAt = Date.now();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ savedAt, data }), "utf8");
    memoryCache = { savedAt, data };
    return savedAt;
  } catch {
    return 0;
  }
}

function hydrateMemoryFromDisk() {
  if (memoryCache.data) return memoryCache;
  const file = readFileCache();
  if (file) memoryCache = file;
  return memoryCache;
}

export function getCachedPrizePicksPayload() {
  const cache = hydrateMemoryFromDisk();
  return cache.data || null;
}

export function getCachedPrizePicksSavedAt() {
  const cache = hydrateMemoryFromDisk();
  return cache.savedAt || 0;
}

export function savePrizePicksPayload(data) {
  if (!data) return 0;
  lastUpstreamAt = Date.now();
  return writeFileCache(data) || Date.now();
}

export function markPrizePicksUpstreamAttempt() {
  lastUpstreamAt = Date.now();
}

export function isPrizePicksServerCooldown() {
  if (!lastUpstreamAt) return false;
  return Date.now() - lastUpstreamAt < PRIZEPICKS_SERVER_COOLDOWN_MS;
}

export function getPrizePicksServerCooldownRemainingMs() {
  if (!lastUpstreamAt) return 0;
  return Math.max(0, lastUpstreamAt + PRIZEPICKS_SERVER_COOLDOWN_MS - Date.now());
}

export function buildPrizePicksFallbackPayload(cachedData, { rateLimited = true, message = "" } = {}) {
  const data = cachedData || getCachedPrizePicksPayload();
  if (!data) return null;
  const msg = message || (rateLimited ? "Rate limited. Showing cached props." : "Showing cached props.");
  return {
    ok: true,
    source: "PrizePicks",
    fallback: true,
    rateLimited: Boolean(rateLimited),
    cached: true,
    data,
    props: extractPropsArray(data),
    message: msg,
    cachedAt: getCachedPrizePicksSavedAt() || new Date().toISOString(),
  };
}

function extractPropsArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.props)) return data.props;
  return [];
}

export async function withPrizePicksServerLock(fn) {
  if (inFlight) return inFlight;
  inFlight = Promise.resolve()
    .then(fn)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
