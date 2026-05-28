import {
  ENRICHMENT_TIMEOUT_MESSAGE,
  getMlbStatsFetchTimeoutMs,
  getSportsDataTimeoutMs,
  MLB_STATS_FETCH_TIMEOUT_MS,
  PRIZEPICKS_PROVIDER_TIMEOUT_MS,
  UNDERDOG_PROVIDER_TIMEOUT_MS,
  withFetchTimeout,
} from "./apiTimeout.js";

export {
  PRIZEPICKS_PROVIDER_TIMEOUT_MS,
  UNDERDOG_PROVIDER_TIMEOUT_MS,
  MLB_STATS_FETCH_TIMEOUT_MS,
};

/**
 * Fetch one provider with an independent timeout. Never throws — returns { result, error, timedOut, durationMs }.
 */
export async function fetchProviderIsolated({ label, timeoutMs, fetchFn, emptyResult }) {
  const startedAt = Date.now();
  let timedOut = false;
  let error = false;
  let result = null;

  try {
    result = await withFetchTimeout(fetchFn, timeoutMs, {
      label,
      fallback: () => {
        timedOut = true;
        return typeof emptyResult === "function"
          ? emptyResult({ timedOut: true, error: true })
          : { error: true, timedOut: true, data: [] };
      },
    });
    if (result?.error || result?.timedOut) {
      error = true;
    }
  } catch (err) {
    error = true;
    result =
      typeof emptyResult === "function"
        ? emptyResult({ timedOut: false, error: true, message: err?.message })
        : { error: true, data: [], message: err?.message };
  }

  return {
    label,
    result,
    durationMs: Date.now() - startedAt,
    timedOut,
    error,
  };
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
