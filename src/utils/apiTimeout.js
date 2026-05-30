/** Shared API timeout + enrichment helpers (mobile 5s / desktop 8s). */

export const ENRICHMENT_TIMEOUT_MESSAGE = "Timed out — using base feed.";
export const ENRICHMENT_MAX_RETRIES = 1;
export const MOBILE_TIMEOUT_MS = 5_000;
export const DESKTOP_TIMEOUT_MS = 8_000;
export const LINE_FEED_TIMEOUT_MS = 30_000;
export const SPORTSDATA_TIMEOUT_MS = 30_000;
/** MLB player stat profiles — must complete before projections merge. */
export const MLB_STATS_FETCH_TIMEOUT_MS = 90_000;
/** Per-provider caps — independent; do not use global mobile/desktop caps. */
export const PRIZEPICKS_RETRY_TIMEOUTS_MS = [5_000, 10_000, 15_000];
/** Startup feed cap — fail fast and fall back to cache. */
export const PRIZEPICKS_PROVIDER_TIMEOUT_MS = 5_000;
export const UNDERDOG_PROVIDER_TIMEOUT_MS = 5_000;
export const LINE_FEED_RETRY_DELAY_MS = 2_000;
export const LINE_FEED_MAX_RETRIES = 2;

export function isMobileViewport() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(max-width: 768px)").matches) return true;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
}

export function getApiTimeoutMs({ enrichment = false } = {}) {
  void enrichment;
  return isMobileViewport() ? MOBILE_TIMEOUT_MS : DESKTOP_TIMEOUT_MS;
}

/** PrizePicks / Underdog line feeds — longer timeout for flaky proxies. */
export function getLineFeedTimeoutMs() {
  return LINE_FEED_TIMEOUT_MS;
}

/** SportsDataIO enrichment — background-only, must not block core MLB feed. */
export function getSportsDataTimeoutMs() {
  return SPORTSDATA_TIMEOUT_MS;
}

/** MLB stats enrichment — blocking; do not use short mobile/desktop caps. */
export function getMlbStatsFetchTimeoutMs() {
  return MLB_STATS_FETCH_TIMEOUT_MS;
}

export function isAbortOrTimeoutError(error) {
  const message = String(error?.message || error || "");
  return error?.name === "AbortError" || /timed out|abort/i.test(message);
}

export function isTimeoutPreview(preview = "") {
  return /timed out|abort/i.test(String(preview || ""));
}

/**
 * Race a promise against a hard timeout. Returns fallback (or default enrichment shape) on timeout.
 */
export async function withFetchTimeout(promiseOrFn, timeoutMs, { fallback, label = "fetch" } = {}) {
  const run = typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn;
  let settled = false;
  let timer = null;

  const resolveTimeoutResult = () =>
    typeof fallback === "function"
      ? fallback({ timedOut: true, label })
      : fallback ?? { timedOut: true, warnings: [ENRICHMENT_TIMEOUT_MESSAGE] };

  try {
    const result = await Promise.race([
      Promise.resolve(run).then((value) => {
        settled = true;
        return value;
      }),
      new Promise((resolve, reject) => {
        timer = window.setTimeout(() => {
          if (settled) return;
          console.warn(`[API Timeout] ${label} timed out after ${timeoutMs}ms`);
          try {
            resolve(resolveTimeoutResult());
          } catch (error) {
            reject(error);
          }
        }, timeoutMs);
      }),
    ]);
    return result;
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

/** AbortController wrapper for probe-style fetches. */
export async function fetchWithAbortTimeout(url, init = {}, timeoutMs = getApiTimeoutMs()) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (isAbortOrTimeoutError(error)) {
      throw new Error(ENRICHMENT_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
