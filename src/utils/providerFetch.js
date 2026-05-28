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
export async function fetchProviderIsolated({ label, timeoutMs, fetchFn, emptyResult, sourceId = null }) {
  const logKey = providerLogKey(label);
  const lockSourceId = sourceId || resolveSourceId(label);
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let error = false;
  let timer = null;

  console.log(`${logKey} START`);

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

    if (result?.__providerTimeout || controller.signal.aborted) {
      return {
        label,
        result: failResult({ timedOut: true }),
        durationMs: Date.now() - startedAt,
        timedOut: true,
        error: true,
      };
    }

    console.log(`${logKey} END`);
    if (result?.error || result?.timedOut) error = true;
    return {
      label,
      result,
      durationMs: Date.now() - startedAt,
      timedOut: false,
      error,
    };
  } catch (err) {
    if (timer != null) window.clearTimeout(timer);
    const wasTimeout = timedOut || controller.signal.aborted || isAbortOrTimeoutError(err);
    if (wasTimeout) {
      if (!timedOut) console.log(`${logKey} TIMEOUT`);
    } else {
      console.log(`${logKey} END`);
    }
    return {
      label,
      result: failResult({ timedOut: wasTimeout, message: err?.message }),
      durationMs: Date.now() - startedAt,
      timedOut: wasTimeout,
      error: true,
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

const PERF_LOG_KEYS = {
  PrizePicks: "PRIZEPICKS",
  Underdog: "UNDERDOG",
  Stats: "STATS",
  SeasonStats: "SEASON_STATS",
};

/** Log per-provider durations, slowest provider, and any timeouts. */
export function logProviderFetchPerformance(entries = []) {
  const completed = entries.filter(Boolean);
  let slowest = null;
  const timedOutLabels = [];

  for (const entry of completed) {
    if (entry.skipped) continue;
    const logKey = PERF_LOG_KEYS[entry.label] || String(entry.label || "").toUpperCase().replace(/\s+/g, "_");

    if (logKey === "PRIZEPICKS") {
      console.error("PRIZEPICKS TIME:", entry.durationMs);
    } else if (logKey === "UNDERDOG") {
      console.error("UNDERDOG TIME:", entry.durationMs);
    } else if (logKey === "STATS") {
      console.error("STATS TIME:", entry.durationMs);
    } else if (logKey === "SEASON_STATS") {
      console.error("SEASON STATS TIME:", entry.durationMs);
    }

    if (entry.timedOut) {
      timedOutLabels.push(entry.label);
      console.error(`${logKey} TIMEOUT after ${entry.durationMs}ms`);
    }

    if (!slowest || entry.durationMs > slowest.durationMs) {
      slowest = entry;
    }
  }

  if (slowest && !slowest.skipped) {
    console.error("SLOWEST PROVIDER:", slowest.label, slowest.durationMs, "ms");
  }
  if (timedOutLabels.length) {
    console.error("PROVIDER TIMEOUTS:", timedOutLabels.join(", "));
  }
}

export function emptyPrizePicksProviderResult({ timedOut = false, message = "" } = {}) {
  return {
    source: "PrizePicks",
    status: "Failed",
    props: [],
    lineSourceBadge: "",
    warnings: [message || (timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "PrizePicks fetch failed")],
    error: true,
    timedOut,
  };
}

export function emptyUnderdogProviderResult({ timedOut = false, message = "" } = {}) {
  return {
    source: "Underdog",
    status: "Unavailable",
    props: [],
    parsedProps: [],
    warnings: [message || (timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Underdog fetch failed")],
    lineSourceBadge: "STALE",
    error: true,
    timedOut,
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
