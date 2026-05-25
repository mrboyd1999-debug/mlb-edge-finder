import { ENRICHMENT_MAX_RETRIES, getApiTimeoutMs } from "../utils/apiTimeout.js";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const SHORT_CACHE_MIN_MS = 60 * 1000;
const SHORT_CACHE_MAX_MS = 120 * 1000;
const DEFAULT_MAX_RETRIES = 1;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const DEV_MIN_INTERVAL_MS = 4000;

const memoryCache = new Map();
const inFlightRequests = new Map();
let lastRequestAt = 0;

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];

const ACCEPT_HEADERS = [
  "application/json, text/plain, */*",
  "application/json",
  "application/vnd.api+json, application/json",
];

const REFERER_HEADERS = [
  "https://app.prizepicks.com/",
  "https://prizepicks.com/",
  "https://underdogfantasy.com/",
  "https://app.underdogfantasy.com/",
];

const ORIGIN_HEADERS = [
  "https://app.prizepicks.com",
  "https://prizepicks.com",
  "https://underdogfantasy.com",
  "https://app.underdogfantasy.com",
];

function cacheKey(url, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  return `${method}:${url}`;
}

function freshResponse(entry) {
  return new Response(entry.bodyText, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  });
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortCacheTtlMs() {
  return SHORT_CACHE_MIN_MS + Math.floor(Math.random() * (SHORT_CACHE_MAX_MS - SHORT_CACHE_MIN_MS + 1));
}

export function isDevEnvironment() {
  try {
    if (import.meta.env?.DEV) return true;
    const host = window.location?.hostname || "";
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  } catch {
    return false;
  }
}

export function getDevThrottleMs() {
  return isDevEnvironment() ? DEV_MIN_INTERVAL_MS : 0;
}

import { getManualRefreshCooldownMs } from "./fetchCoordinator.js";

export function getRefreshCooldownMs() {
  return getManualRefreshCooldownMs();
}

export function buildRotatingHeaders(extra = {}) {
  return {
    accept: pickRandom(ACCEPT_HEADERS),
    "user-agent": pickRandom(USER_AGENTS),
    referer: pickRandom(REFERER_HEADERS),
    origin: pickRandom(ORIGIN_HEADERS),
    ...extra,
  };
}

/** Browser-like JSON headers for PrizePicks / Underdog line feeds. */
export function lineFeedJsonHeaders(extra = {}) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    ...extra,
  };
}

function readStorageCache(key, ttlMs, now = Date.now()) {
  try {
    const stored = window.localStorage.getItem(`dfs-fetch-cache:${key}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed?.bodyText == null || now - parsed.fetchedAt >= ttlMs) return null;
    return {
      bodyText: parsed.bodyText,
      status: parsed.status || 200,
      statusText: parsed.statusText || "",
      headers: new Headers({ "content-type": parsed.contentType || "application/json" }),
      fetchedAt: parsed.fetchedAt,
      fromCache: true,
      cacheLayer: "localStorage",
    };
  } catch {
    return null;
  }
}

function writeStorageCache(key, entry) {
  try {
    window.localStorage.setItem(
      `dfs-fetch-cache:${key}`,
      JSON.stringify({
        bodyText: entry.bodyText,
        status: entry.status,
        statusText: entry.statusText,
        contentType: entry.headers?.get?.("content-type") || "application/json",
        fetchedAt: entry.fetchedAt,
      })
    );
  } catch {
    // storage full — memory cache still works
  }
}

function logFetchEvent(source, event, details = {}) {
  console.info(`[DFS Fetch] ${source}`, { event, ...details });
}

async function waitForDevThrottle() {
  const throttleMs = getDevThrottleMs();
  if (!throttleMs) return;
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < throttleMs) {
    await sleep(throttleMs - elapsed);
  }
  lastRequestAt = Date.now();
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function clearApiCache({ preserveLastGood = true } = {}) {
  memoryCache.clear();
  inFlightRequests.clear();
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("dfs-fetch-cache:")) continue;
      keys.push(key);
    }
    if (!preserveLastGood) {
      keys.push(
        "dfs-prizepicks-last-good-payload",
        "dfs-underdog-last-good-payload",
        "dfs-odds-last-good-comparisons",
        "pp_cache",
        "ud_cache"
      );
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore storage errors
  }
}

export async function resilientFetch(url, init = {}, options = {}) {
  const source = options.source || "API";
  const key = cacheKey(url, init);
  const bypassCache = init.cache === "no-store" || options.ttlMs === 0;
  const ttlMs = bypassCache ? 0 : options.ttlMs ?? shortCacheTtlMs();
  const timeoutMs = options.timeoutMs ?? getApiTimeoutMs({ enrichment: Boolean(options.enrichment) });
  const maxRetries = options.maxRetries ?? (options.enrichment ? ENRICHMENT_MAX_RETRIES : DEFAULT_MAX_RETRIES);
  const retryStatuses = options.retryStatuses || RETRY_STATUSES;
  const now = Date.now();

  if (!bypassCache && ttlMs > 0) {
    const memoryEntry = memoryCache.get(key);
    if (memoryEntry && now - memoryEntry.fetchedAt < ttlMs) {
      logFetchEvent(source, "cache-hit", {
        url,
        cacheLayer: "memory",
        ageMs: now - memoryEntry.fetchedAt,
        status: memoryEntry.status,
      });
      return freshResponse(memoryEntry);
    }
    const stored = readStorageCache(key, ttlMs, now);
    if (stored) {
      memoryCache.set(key, stored);
      logFetchEvent(source, "cache-hit", {
        url,
        cacheLayer: stored.cacheLayer,
        ageMs: now - stored.fetchedAt,
        status: stored.status,
      });
      return freshResponse(stored);
    }
  }

  if (inFlightRequests.has(key)) {
    logFetchEvent(source, "dedupe-wait", { url });
    return inFlightRequests.get(key);
  }

  const run = (async () => {
    await waitForDevThrottle();
    const startedAt = Date.now();
    let lastResponse = null;
    let retries = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const headers = buildRotatingHeaders(init.headers || {});
      try {
        const response = await fetchWithTimeout(url, { ...init, headers }, timeoutMs);
        lastResponse = response;
        const skip429 = options.skip429Retry !== false && response.status === 429;
        const shouldRetry = retryStatuses.has(response.status) && attempt < maxRetries && !skip429;
        logFetchEvent(source, shouldRetry ? "retryable-status" : "response", {
          url,
          status: response.status,
          attempt: attempt + 1,
          retries,
          durationMs: Date.now() - startedAt,
          skip429,
        });
        if (shouldRetry) {
          retries += 1;
          const backoffMs =
            options.retryDelayMs ??
            Math.min(12_000, 600 * 2 ** attempt + Math.floor(Math.random() * 400));
          logFetchEvent(source, "retry-backoff", { url, status: response.status, backoffMs, retries });
          await sleep(backoffMs);
          continue;
        }
        break;
      } catch (error) {
        const retryable = attempt < maxRetries;
        logFetchEvent(source, retryable ? "retry-error" : "fetch-error", {
          url,
          attempt: attempt + 1,
          retries,
          message: error?.message || String(error),
          durationMs: Date.now() - startedAt,
        });
        if (!retryable) throw error;
        retries += 1;
        const backoffMs =
          options.retryDelayMs ??
          Math.min(12_000, 600 * 2 ** attempt + Math.floor(Math.random() * 400));
        await sleep(backoffMs);
      }
    }

    if (!lastResponse) {
      throw new Error(`${source} request failed without a response`);
    }

    const bodyText = await lastResponse.clone().text();
    const entry = {
      bodyText,
      status: lastResponse.status,
      statusText: lastResponse.statusText,
      headers: lastResponse.headers,
      fetchedAt: Date.now(),
      retries,
    };

    logFetchEvent(source, "complete", {
      url,
      status: entry.status,
      retries,
      cacheWrite: !bypassCache && lastResponse.ok,
      durationMs: Date.now() - startedAt,
    });

    if (!bypassCache && lastResponse.ok) {
      memoryCache.set(key, entry);
      writeStorageCache(key, entry);
    }

    return freshResponse(entry);
  })();

  inFlightRequests.set(key, run);
  try {
    return await run;
  } finally {
    inFlightRequests.delete(key);
  }
}

export async function cachedFetch(url, init = {}, ttlMsOrOptions = DEFAULT_TTL_MS) {
  const options =
    typeof ttlMsOrOptions === "object" && ttlMsOrOptions !== null
      ? ttlMsOrOptions
      : { ttlMs: ttlMsOrOptions };
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (ttlMs <= 0) {
    return resilientFetch(url, init, { source: options.source || init.source || "API", ttlMs: 0, ...options });
  }
  return resilientFetch(url, init, { source: options.source || init.source || "API", ttlMs, ...options });
}

export function buildNetworkErrorResult(sourceName, message, timeoutMs = getApiTimeoutMs()) {
  const error =
    message?.includes("timed out") || message?.includes("AbortError")
      ? `Request timed out after ${timeoutMs}ms`
      : message || "Failed to fetch";
  return {
    ok: false,
    source: sourceName,
    status: "failed",
    error,
    fallback: false,
    data: [],
    props: [],
    networkError: true,
    contentType: "",
    preview: "",
  };
}

export async function fetchJson(url, init = {}, options = {}) {
  const result = await safeJsonFetch(url, options.source || "API", init, options);
  if (!result.ok) {
    throw new Error(result.error || `${options.source || "API"} returned invalid JSON.`);
  }
  return { response: result.response, data: result.data, text: result.text };
}

/** Like fetchJson but never throws — returns structured error payload on network/parse failure. */
export async function fetchJsonSafe(url, init = {}, options = {}) {
  const source = options.source || "API";
  const timeoutMs = options.timeoutMs ?? getApiTimeoutMs({ enrichment: Boolean(options.enrichment) });
  try {
    return await safeJsonFetch(url, source, init, { ...options, timeoutMs, maxRetries: options.maxRetries ?? 1 });
  } catch (error) {
    return buildNetworkErrorResult(source, error?.message || String(error), timeoutMs);
  }
}

export async function safeJsonFetch(url, sourceName = "API", init = {}, options = {}) {
  const source = options.source || sourceName || "API";
  const timeoutMs = options.timeoutMs ?? getApiTimeoutMs({ enrichment: Boolean(options.enrichment) });
  let response;
  try {
    response = await cachedFetch(url, init, { ...options, timeoutMs, ttlMs: options.ttlMs ?? DEFAULT_TTL_MS });
  } catch (error) {
    return buildNetworkErrorResult(sourceName, error?.message || String(error), timeoutMs);
  }
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const preview = text.slice(0, 200).replace(/\s+/g, " ").trim();

  console.info(`[DFS Fetch] ${source}`, {
    url,
    status: response.status,
    contentType,
    preview,
  });

  if (!response.ok) {
    const unauthorized = response.status === 401 || response.status === 403;
    const error =
      /prizepicks/i.test(source) && response.status === 403
        ? "PrizePicks blocked the request (403)"
        : unauthorized && /odds|sportsbook/i.test(source)
          ? "Invalid Odds API key or subscription access."
        : response.status === 429
          ? `${source} rate limited (429)`
          : `${source} returned status ${response.status}.`;
    return {
      ok: false,
      source: sourceName,
      error,
      props: [],
      response,
      text,
      preview,
      contentType,
      rateLimited: response.status === 429,
      unauthorized,
    };
  }

  const trimmed = text.trim();
  if (!trimmed) return { ok: true, source: sourceName, data: null, props: [], response, text, preview, contentType };

  if (
    /javascript/i.test(contentType) ||
    trimmed.includes("const APIFY_PRIZEPICKS_ACTOR") ||
    /^export\s+default\b/.test(trimmed) ||
    trimmed.includes("export default async function")
  ) {
    const error = "API route is serving source/HTML instead of JSON. Check proxy/backend routing.";
    return {
      ok: false,
      source: sourceName,
      error,
      props: [],
      response,
      text,
      preview,
      contentType,
    };
  }

  if (trimmed.startsWith("<")) {
    const error = /prizepicks/i.test(source)
      ? "PrizePicks returned HTML instead of JSON"
      : "API route is serving source/HTML instead of JSON. Check proxy/backend routing.";
    return {
      ok: false,
      source: sourceName,
      error,
      props: [],
      response,
      text,
      preview,
      contentType,
    };
  }

  if (/^export\s+default\b/.test(trimmed) || trimmed.includes("export default async function")) {
    const error = /prizepicks/i.test(source)
      ? "PrizePicks returned JavaScript instead of JSON"
      : "API route is serving source/HTML instead of JSON. Check proxy/backend routing.";
    return {
      ok: false,
      source: sourceName,
      error,
      props: [],
      response,
      text,
      preview,
      contentType,
    };
  }

  try {
    return { ok: true, source: sourceName, data: JSON.parse(trimmed), props: [], response, text, preview, contentType };
  } catch {
    console.error("Non-JSON response:", trimmed.slice(0, 300));
    const message = /prizepicks/i.test(source)
      ? "PrizePicks returned non-JSON response"
      : /underdog/i.test(source)
        ? "Underdog returned non-JSON response"
        : "Non-JSON response";
    return {
      ok: false,
      source: sourceName,
      error: `${message}. First 200 chars: ${preview}`,
      props: [],
      response,
      text,
      preview,
      contentType,
    };
  }
}

export function getCacheTtlMs() {
  return DEFAULT_TTL_MS;
}

export function getShortCacheTtlMs() {
  return shortCacheTtlMs();
}
