/** Shared API timeout + enrichment helpers (mobile 5s / desktop 8s). */

export const ENRICHMENT_TIMEOUT_MESSAGE = "Timed out — using base feed.";
export const ENRICHMENT_MAX_RETRIES = 1;
export const MOBILE_TIMEOUT_MS = 5_000;
export const DESKTOP_TIMEOUT_MS = 8_000;

export function isMobileViewport() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(max-width: 768px)").matches) return true;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
}

export function getApiTimeoutMs({ enrichment = false } = {}) {
  void enrichment;
  return isMobileViewport() ? MOBILE_TIMEOUT_MS : DESKTOP_TIMEOUT_MS;
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

  const timeoutResult =
    typeof fallback === "function"
      ? fallback({ timedOut: true, label })
      : fallback ?? { timedOut: true, warnings: [ENRICHMENT_TIMEOUT_MESSAGE] };

  try {
    const result = await Promise.race([
      Promise.resolve(run).then((value) => {
        settled = true;
        return value;
      }),
      new Promise((resolve) => {
        timer = window.setTimeout(() => {
          if (!settled) {
            console.warn(`[API Timeout] ${label} timed out after ${timeoutMs}ms`);
          }
          resolve(timeoutResult);
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
