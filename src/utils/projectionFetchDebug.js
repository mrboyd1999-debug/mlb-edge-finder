/**
 * Runtime projection provider tracing — endpoints, responses, failures.
 */

import { getSportsDataApiKey } from "../config/apiConfig.js";
import { PROJECTION_DATA_UNAVAILABLE_MESSAGE } from "./projectionAvailability.js";

const state = {
  attempts: [],
  summary: null,
};

function safeSample(value, maxLen = 1200) {
  if (value == null) return null;
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text.length > maxLen ? `${text.slice(0, maxLen)}…[truncated]` : text;
  } catch {
    return String(value).slice(0, maxLen);
  }
}

export function resetProjectionFetchDebug() {
  state.attempts = [];
  state.summary = null;
}

export function recordProjectionFetchAttempt(row = {}) {
  const entry = {
    at: new Date().toISOString(),
    provider: row.provider || "unknown",
    endpoint: row.endpoint || "",
    sport: row.sport || "MLB",
    ok: Boolean(row.ok),
    statusCode: row.statusCode ?? null,
    responseCount: Number.isFinite(Number(row.responseCount)) ? Number(row.responseCount) : null,
    error: row.error || "",
    warnings: Array.isArray(row.warnings) ? row.warnings.filter(Boolean) : [],
    rawSample: row.rawSample ?? null,
  };
  state.attempts.push(entry);

  console.error("########## PROJECTION FETCH DEBUG START ##########");
  console.error("PROVIDER:", entry.provider);
  console.error("SPORT:", entry.sport);
  console.error("ENDPOINT:", entry.endpoint || "—");
  console.error("SUCCESS:", entry.ok);
  console.error("STATUS CODE:", entry.statusCode ?? "—");
  console.error("RESPONSE COUNT:", entry.responseCount ?? "—");
  if (entry.error) console.error("FETCH ERROR:", entry.error);
  if (entry.warnings.length) console.error("WARNINGS:", entry.warnings);
  if (entry.rawSample != null) console.error("RAW RESPONSE SAMPLE:", safeSample(entry.rawSample));
  console.error("########## PROJECTION FETCH DEBUG END ##########");

  return entry;
}

function countProfilesWithProjection(statsMap) {
  if (!(statsMap instanceof Map)) return 0;
  let count = 0;
  statsMap.forEach((profile) => {
    if (!profile || profile.sparse || profile.fallback) return;
    if (Number(profile.projection) > 0) count += 1;
  });
  return count;
}

function countMergedWithProjection(props = []) {
  return (props || []).filter((prop) => Number(prop?.projection ?? prop?.projectedValue) > 0).length;
}

function resolveUnavailableReason({
  sportsDataConfigured,
  statsTimedOut,
  statsEnrichmentFailed,
  statsEnrichmentError,
  withProfileProjection,
  seasonStatRows,
  mergedWithProjection,
  attempts,
}) {
  if (mergedWithProjection > 0 && !statsEnrichmentFailed) return "";

  if (statsEnrichmentFailed) {
    return statsEnrichmentError || PROJECTION_DATA_UNAVAILABLE_MESSAGE;
  }

  const seasonAttempt = [...attempts].reverse().find((row) => /season/i.test(row.provider));
  const mlbAttempt = [...attempts].reverse().find((row) => /MLB StatsAPI|mlb/i.test(row.provider));

  if (!sportsDataConfigured && withProfileProjection === 0 && seasonStatRows === 0) {
    return "SportsDataIO API key not configured — season stat projections unavailable.";
  }
  if (statsTimedOut) {
    return "Player stats fetch timed out before projections could load.";
  }
  if (seasonAttempt && !seasonAttempt.ok) {
    return seasonAttempt.error || "SportsDataIO season stats request failed.";
  }
  if (mlbAttempt && !mlbAttempt.ok) {
    return mlbAttempt.error || "MLB Stats API game-log fetch failed.";
  }
  if (withProfileProjection === 0 && seasonStatRows === 0) {
    return "No projection rows returned from MLB Stats API or SportsDataIO.";
  }
  if (withProfileProjection === 0 && seasonStatRows > 0) {
    return "Season stats loaded but merge produced zero prop projections — check player/stat key matching.";
  }
  return "Projection provider returned no usable values for current props.";
}

/** Build UI + debug summary after fetch/merge completes. */
export function buildProjectionProviderSummary({
  statsMap = null,
  seasonStats = [],
  mergeDebug = null,
  mergedProps = [],
  statsTimedOut = false,
  statsEnrichmentFailed = false,
  statsEnrichmentError = "",
} = {}) {
  const withProfileProjection = countProfilesWithProjection(statsMap);
  const mergedWithProjection = countMergedWithProjection(mergedProps);
  const seasonStatRows = Array.isArray(seasonStats) ? seasonStats.length : 0;
  const sportsDataConfigured = Boolean(getSportsDataApiKey());
  const unavailable = mergedWithProjection === 0 || statsEnrichmentFailed;
  const reason = unavailable
    ? resolveUnavailableReason({
        sportsDataConfigured,
        statsTimedOut,
        statsEnrichmentFailed,
        statsEnrichmentError,
        withProfileProjection,
        seasonStatRows,
        mergedWithProjection,
        attempts: state.attempts,
      })
    : "";

  state.summary = {
    unavailable,
    reason,
    sportsDataConfigured,
    statsTimedOut,
    statsEnrichmentFailed,
    statsEnrichmentError,
    statsMapSize: statsMap instanceof Map ? statsMap.size : 0,
    withProfileProjection,
    seasonStatRows,
    mergedWithProjection,
    mergeMatchCount: mergeDebug?.matchCount ?? null,
    projectionLookupCount: mergeDebug?.projectionLookupCount ?? null,
    attempts: [...state.attempts],
    updatedAt: new Date().toISOString(),
  };

  console.error("########## PROJECTION PROVIDER SUMMARY START ##########");
  console.error("FETCH SUCCESS:", !unavailable);
  console.error("UNAVAILABLE:", unavailable);
  console.error("REASON:", reason || "projections loaded");
  console.error("STATS MAP SIZE:", state.summary.statsMapSize);
  console.error("PROFILES WITH PROJECTION:", withProfileProjection);
  console.error("SEASON STAT ROWS:", seasonStatRows);
  console.error("MERGED WITH PROJECTION:", mergedWithProjection);
  console.error("MERGE MATCH COUNT:", state.summary.mergeMatchCount ?? "—");
  console.error("########## PROJECTION PROVIDER SUMMARY END ##########");

  return state.summary;
}

export function getProjectionProviderSummary() {
  return state.summary;
}

export function getProjectionFetchAttempts() {
  return [...state.attempts];
}
