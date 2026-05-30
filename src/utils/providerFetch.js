import {
  ENRICHMENT_TIMEOUT_MESSAGE,
  getMlbStatsFetchTimeoutMs,
  getSportsDataTimeoutMs,
  isAbortOrTimeoutError,
  MLB_STATS_FETCH_TIMEOUT_MS,
  PRIZEPICKS_PROVIDER_TIMEOUT_MS,
  UNDERDOG_PROVIDER_TIMEOUT_MS,
} from "./apiTimeout.js";
import { SOURCE_IDS, releaseSourceRequestLock } from "../services/sourceRateLimit.js";
import { updatePrizePicksDiagnostics } from "./prizepicksDiagnostics.js";
import {
  PROVIDER_SLOW_THRESHOLD_MS,
  recordProviderFetchMetrics,
  updateProviderFetchDiagnostics,
} from "./providerFetchDiagnostics.js";
import {
  logPpFetchFailed,
  logPpFetchStart,
  logPpFetchSuccess,
  logUdFetchFailed,
  logUdFetchStart,
  logUdFetchSuccess,
} from "./providerRefreshDiagnostics.js";

export {
  PRIZEPICKS_PROVIDER_TIMEOUT_MS,
  UNDERDOG_PROVIDER_TIMEOUT_MS,
  MLB_STATS_FETCH_TIMEOUT_MS,
};

const PROVIDER_LOG_KEYS = {
  PrizePicks: "PRIZEPICKS",
  Underdog: "UNDERDOG",
};

const PROVIDER_SOURCE_IDS = {
  PrizePicks: SOURCE_IDS.PRIZEPICKS,
  Underdog: SOURCE_IDS.UNDERDOG,
};

function providerLogKey(label = "") {
  return PROVIDER_LOG_KEYS[label] || String(label || "PROVIDER").toUpperCase().replace(/\s+/g, "_");
}

function resolveSourceId(label = "") {
  return PROVIDER_SOURCE_IDS[label] || label;
}

/**
 * Fetch one provider with an independent AbortController + Promise.race timeout.
 * Never throws — returns { result, error, timedOut, durationMs }.
 */
export async function fetchProviderIsolated({ label, timeoutMs, fetchFn, emptyResult, sourceId = null, preflight } = {}) {
  const logKey = providerLogKey(label);
  const lockSourceId = sourceId || resolveSourceId(label);
  const startedAt = Date.now();

  if (typeof preflight === "function") {
    const pre = preflight();
    if (pre?.skip) {
      const notConfigured = Boolean(pre.notConfigured) || /not configured|proxy url missing/i.test(String(pre.reason || ""));
      console.log(notConfigured ? `${logKey} NOT CONFIGURED` : `${logKey} SKIPPED`);
      console.log(`${logKey} TIME MS`, 0);
      if (notConfigured) {
        console.info(`${logKey} detail:`, pre.reason || "Not configured");
      }
      if (label === "PrizePicks" && notConfigured) {
        updatePrizePicksDiagnostics({
          proxyConfigured: false,
          proxyMode: "none — blocked before fetch",
          httpExecuted: false,
          providerStatus: "Not configured",
          uiConnectionTier: "Not configured",
          failureClass: "MISSING_PROXY",
          lastError: pre.reason || "PrizePicks proxy URL missing",
          missingConfiguration: pre.missingConfiguration || pre.config?.missingConfiguration || "VITE_PRIZEPICKS_PROXY_URL",
          configKeysChecked: pre.config?.keysChecked || [],
          expectedFormat: pre.config?.expectedFormat || "",
          exampleProxyUrl: pre.config?.exampleProxyUrl || "",
        });
      }
      return {
        label,
        skipped: true,
        result:
          typeof emptyResult === "function"
            ? emptyResult({
                timedOut: false,
                error: true,
                notConfigured,
                message: pre.reason || pre.status || "Not configured",
              })
            : { error: true, notConfigured: true, status: pre.status || "Not configured", warnings: [pre.reason] },
        durationMs: 0,
        timedOut: false,
        error: true,
        notConfigured,
        statusReason: pre.reason || "",
      };
    }
  }

  const controller = new AbortController();
  let timedOut = false;
  let error = false;
  let timer = null;

  console.log(`${logKey} START`);
  if (label === "PrizePicks") logPpFetchStart({ timeoutMs });
  if (label === "Underdog") logUdFetchStart({ timeoutMs });

  const failResult = (opts = {}) => {
    error = true;
    return typeof emptyResult === "function"
      ? emptyResult({ timedOut: Boolean(opts.timedOut), error: true, message: opts.message || "" })
      : { error: true, timedOut: Boolean(opts.timedOut), data: [] };
  };

  try {
    const result = await Promise.race([
      Promise.resolve().then(async () => {
        const value = await fetchFn({ signal: controller.signal });
        if (controller.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return value;
      }),
      new Promise((resolve) => {
        timer = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
          if (lockSourceId) releaseSourceRequestLock(lockSourceId);
          console.log(`${logKey} TIMEOUT`);
          resolve({ __providerTimeout: true });
        }, timeoutMs);
      }),
    ]);

    if (timer != null) window.clearTimeout(timer);
    const durationMs = Date.now() - startedAt;

    if (result?.__providerTimeout || timedOut) {
      console.log(`${logKey} FAILED`);
      console.log(`${logKey} TIME MS`, durationMs);
      const timeoutMessage = `Timed out after ${timeoutMs}ms`;
      recordProviderFetchMetrics(label, {
        responseTimeMs: durationMs,
        timedOut: true,
        slow: durationMs >= PROVIDER_SLOW_THRESHOLD_MS,
        lastError: timeoutMessage,
        failureReason: timeoutMessage,
        failureCategory: "OUTER_TIMEOUT",
      });
      if (label === "PrizePicks") {
        const outerStep = "outer provider wrapper (fetchProviderIsolated)";
        console.warn("[PrizePicks Timeout] step:", outerStep, { timeoutMs, durationMs });
        console.warn("[PP TIMEOUT] step:", outerStep, { timeoutMs, durationMs });
        logPpFetchFailed({ reason: timeoutMessage, step: outerStep, durationMs });
        updatePrizePicksDiagnostics({
          outerTimeout: true,
          timedOut: true,
          lastTimeoutLocation: outerStep,
          responseTimeMs: durationMs,
          finalPropsCount: 0,
          parsedPropsCount: 0,
          providerStatus: "Failed",
          lastError: timeoutMessage,
          failureReason: `Provider wrapper timed out after ${Math.round(timeoutMs / 1000)}s — request may not have completed.`,
        });
      }
      if (label === "Underdog") {
        const outerStep = "outer provider wrapper (fetchProviderIsolated)";
        console.warn("[UD TIMEOUT] step:", outerStep, { timeoutMs, durationMs });
        logUdFetchFailed({ reason: timeoutMessage, step: outerStep, durationMs });
      }
      console.warn(`[Provider] ${label} timed out after ${durationMs}ms (limit ${timeoutMs}ms)`);
      return {
        label,
        result: failResult({ timedOut: true, message: timeoutMessage }),
        durationMs,
        timedOut: true,
        error: true,
        statusReason: `Timed out after ${Math.round(timeoutMs / 1000)}s`,
      };
    }

    if (result?.error || result?.timedOut) {
      error = true;
      console.log(`${logKey} FAILED`);
      if (label === "PrizePicks") {
        logPpFetchFailed({
          reason: result?.warnings?.[0] || result?.timedOut ? "timed out" : "fetch error",
          durationMs,
          props: result?.props?.length ?? 0,
        });
      }
      if (label === "Underdog") {
        logUdFetchFailed({
          reason: result?.warnings?.[0] || result?.timedOut ? "timed out" : "fetch error",
          durationMs,
          props: result?.props?.length ?? result?.parsedProps?.length ?? 0,
        });
      }
    } else {
      console.log(`${logKey} SUCCESS`);
      if (label === "PrizePicks") {
        logPpFetchSuccess({
          durationMs,
          props: result?.props?.length ?? 0,
          status: result?.status,
          cached: /cached/i.test(String(result?.lineSourceBadge || result?.status || "")),
        });
      }
      if (label === "Underdog") {
        logUdFetchSuccess({
          durationMs,
          props: result?.props?.length ?? result?.parsedProps?.length ?? 0,
          status: result?.status,
          cached: /cached/i.test(String(result?.lineSourceBadge || result?.status || "")),
        });
      }
    }
    console.log(`${logKey} TIME MS`, durationMs);
    if (durationMs >= PROVIDER_SLOW_THRESHOLD_MS) {
      recordProviderFetchMetrics(label, {
        responseTimeMs: durationMs,
        slow: true,
        lastError: result?.warnings?.[0] || "",
      });
      console.warn(`[Provider] ${label} slow response — ${durationMs}ms (threshold ${PROVIDER_SLOW_THRESHOLD_MS}ms)`);
    }
    updateProviderFetchDiagnostics(label, { responseTimeMs: durationMs });

    return {
      label,
      result,
      durationMs,
      timedOut: false,
      error,
    };
  } catch (err) {
    if (timer != null) window.clearTimeout(timer);
    const durationMs = Date.now() - startedAt;
    const wasTimeout = timedOut;
    const message = err?.message || String(err);
    console.log(wasTimeout ? `${logKey} TIMEOUT` : `${logKey} FAILED`);
    console.log(`${logKey} TIME MS`, durationMs);
    if (label === "PrizePicks" && !wasTimeout) {
      updatePrizePicksDiagnostics({
        networkError: true,
        responseTimeMs: durationMs,
        lastError: message,
        failureReason: `Network error before usable response (${message}).`,
      });
    }
    return {
      label,
      result: failResult({ timedOut: wasTimeout, message }),
      durationMs,
      timedOut: wasTimeout,
      error: true,
      statusReason: wasTimeout ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : message || "Fetch failed",
    };
  }
}

export function skippedProviderResult(label) {
  return Promise.resolve({
    label,
    skipped: true,
    result: null,
    durationMs: 0,
    timedOut: false,
    error: false,
  });
}

export function unwrapProviderSettled(settled) {
  if (!settled || settled.status === "rejected") {
    return {
      label: "unknown",
      result: { error: true, data: [] },
      durationMs: 0,
      timedOut: false,
      error: true,
    };
  }
  return settled.value || { label: "unknown", result: null, error: false, timedOut: false, durationMs: 0 };
}

export function logProviderFetchPerformance(entries = []) {
  const completed = entries.filter(Boolean);
  let slowest = null;
  const timedOutLabels = [];

  for (const entry of completed) {
    if (entry.skipped) continue;
    const logKey = PROVIDER_LOG_KEYS[entry.label] || String(entry.label || "").toUpperCase().replace(/\s+/g, "_");
    console.error(`${logKey} TIME:`, entry.durationMs);
    if (entry.timedOut) {
      timedOutLabels.push(entry.label);
      console.error(`${logKey} TIMEOUT after ${entry.durationMs}ms`);
    }
    if (!slowest || entry.durationMs > slowest.durationMs) slowest = entry;
  }

  if (slowest && !slowest.skipped) {
    console.error("SLOWEST PROVIDER:", slowest.label, slowest.durationMs, "ms");
  }
  if (timedOutLabels.length) {
    console.error("PROVIDER TIMEOUTS:", timedOutLabels.join(", "));
  }
}

export function emptyPrizePicksProviderResult({ timedOut = false, message = "", notConfigured = false } = {}) {
  if (timedOut || notConfigured || message) {
    updatePrizePicksDiagnostics({
      timedOut,
      outerTimeout: timedOut,
      providerStatus: notConfigured ? "Not configured" : "Failed",
      finalPropsCount: 0,
      parsedPropsCount: 0,
      lastError: message,
      failureReason:
        message ||
        (notConfigured
          ? "PrizePicks proxy URL missing — request never sent."
          : timedOut
            ? "PrizePicks provider wrapper timed out."
            : "PrizePicks fetch failed"),
    });
  }
  return {
    source: "PrizePicks",
    status: notConfigured ? "Not configured" : "Failed",
    props: [],
    lineSourceBadge: "",
    warnings: [message || (notConfigured ? "PrizePicks proxy URL missing" : timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "PrizePicks fetch failed")],
    error: true,
    timedOut,
    notConfigured,
  };
}

export function emptyUnderdogProviderResult({ timedOut = false, message = "", notConfigured = false } = {}) {
  return {
    source: "Underdog",
    status: notConfigured ? "Not configured" : "Unavailable",
    props: [],
    parsedProps: [],
    warnings: [message || (notConfigured ? "Underdog proxy URL missing or invalid." : timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Underdog fetch failed")],
    lineSourceBadge: "STALE",
    error: true,
    timedOut,
    notConfigured,
    partialDegradation: true,
  };
}

export function emptySeasonStatsProviderResult({ timedOut = false, message = "" } = {}) {
  return {
    data: [],
    error: true,
    timedOut,
    warnings: [message || (timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Season stats fetch failed")],
  };
}

export function emptyStatsProviderResult({ timedOut = false, message = "" } = {}) {
  return {
    source: "Player stats",
    stats: null,
    warnings: [message || (timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Stats fetch failed")],
    error: true,
    timedOut,
    failed: true,
  };
}

export function getDefaultProviderTimeouts() {
  return {
    prizepicks: PRIZEPICKS_PROVIDER_TIMEOUT_MS,
    underdog: UNDERDOG_PROVIDER_TIMEOUT_MS,
    stats: getMlbStatsFetchTimeoutMs(),
    seasonStats: getSportsDataTimeoutMs(),
  };
}
