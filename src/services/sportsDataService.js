/**
 * SportsDataIO MLB stats client — proxy-only (no direct browser calls to api.sportsdata.io).
 *
 * All requests go through `/api/sportsdataio/*` with the saved key sent as
 * `X-SportsData-Api-Key` to the local backend proxy. The server attaches
 * `Ocp-Apim-Subscription-Key` when calling SportsDataIO upstream.
 *
 * Health probe: `GET /api/sportsdataio/mlb-status`
 *
 * Enrichment failures never block PrizePicks / Underdog props.
 */

import { getSportsDataApiKey } from "../config/apiConfig.js";
import { ENRICHMENT_MAX_RETRIES, getSportsDataTimeoutMs } from "../utils/apiTimeout.js";
import { fetchJsonSafe, getCacheTtlMs } from "./fetchUtil.js";
import {
  SOURCE_IDS,
  cachedLinesMessage,
  isSourceInCooldown,
  markSourceCached,
  recordSource429,
  recordSourceFailure,
  recordSourceSuccess,
  withSourceRequestLock,
  withSourceRetryQueue,
} from "./sourceRateLimit.js";

export const SPORTSDATA_PROXY_HEADER = "X-SportsData-Api-Key";
export const SPORTSDATA_MLB_STATUS_ROUTE = "/api/sportsdataio/mlb-status";
const SPORTSDATA_BASE = "/api/sportsdataio";
const SPORTSDATA_CACHE_PREFIX = "dfs-sportsdata-cache-v1";
const SPORTSDATA_CACHE_MAX_MS = 60 * 60 * 1000;

export const SPORTSDATA_UNAVAILABLE_MESSAGE =
  "SportsDataIO temporarily unavailable. Falling back to PrizePicks + Odds API.";

export const SPORTSDATA_CONNECTED_VIA_PROXY = "Connected via Proxy";

function sportsDataProxyHeaders() {
  const apiKey = getSportsDataApiKey();
  return {
    accept: "application/json",
    ...(apiKey ? { [SPORTSDATA_PROXY_HEADER]: apiKey } : {}),
  };
}

function isoDate(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10).replace(/-/g, "-");
}

function currentSeason(date = new Date()) {
  return new Date(date).getFullYear();
}

function buildUrl(path) {
  const url = new URL(`${SPORTSDATA_BASE}${path.startsWith("/") ? "" : "/"}${path}`, window.location.origin);
  return url;
}

function readCache(key) {
  try {
    const raw = window.localStorage.getItem(`${SPORTSDATA_CACHE_PREFIX}:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt) return null;
    if (Date.now() - new Date(parsed.savedAt).getTime() > SPORTSDATA_CACHE_MAX_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    window.localStorage.setItem(
      `${SPORTSDATA_CACHE_PREFIX}:${key}`,
      JSON.stringify({ savedAt: new Date().toISOString(), data })
    );
  } catch {
    // ignore quota / private mode
  }
}

function emptyResult({ source = "SportsDataIO", reason = "" } = {}) {
  return {
    source,
    data: [],
    cached: false,
    warnings: reason ? [reason] : [],
    lastSuccessfulFetchAt: "",
    rateLimited: false,
  };
}

function cachedResult(cached, { source = "SportsDataIO", reason = "" } = {}) {
  return {
    source,
    data: cached?.data ?? [],
    cached: true,
    warnings: [cachedLinesMessage(cached?.savedAt) || reason || SPORTSDATA_UNAVAILABLE_MESSAGE].filter(Boolean),
    lastSuccessfulFetchAt: cached?.savedAt || "",
    rateLimited: false,
  };
}

async function fetchSportsDataEndpoint(cacheKey, url) {
  const apiKey = getSportsDataApiKey();
  if (!apiKey) {
    const cached = readCache(cacheKey);
    if (cached) return cachedResult(cached, { reason: "SportsDataIO key not configured — serving cache." });
    return emptyResult({ reason: "SportsDataIO key not configured." });
  }

  if (isSourceInCooldown(SOURCE_IDS.SPORTSDATA)) {
    const cached = readCache(cacheKey);
    if (cached) return cachedResult(cached, { reason: "SportsDataIO in cooldown — serving cache." });
    return emptyResult({ reason: "SportsDataIO in cooldown." });
  }

  return withSourceRequestLock(SOURCE_IDS.SPORTSDATA, async () => {
    return withSourceRetryQueue(
      SOURCE_IDS.SPORTSDATA,
      async () => {
        const result = await fetchJsonSafe(
          url.toString(),
          { headers: sportsDataProxyHeaders() },
          {
            source: "SportsDataIO",
            ttlMs: getCacheTtlMs(),
            timeoutMs: getSportsDataTimeoutMs(),
            maxRetries: ENRICHMENT_MAX_RETRIES,
            skip429Retry: true,
            enrichment: true,
          }
        );
        if (result.rateLimited) {
          recordSource429(SOURCE_IDS.SPORTSDATA);
          const cached = readCache(cacheKey);
          if (cached) return cachedResult(cached, { reason: "SportsDataIO rate limited — serving cache." });
          return { ...emptyResult({ reason: "SportsDataIO rate limited." }), rateLimited: true };
        }
        if (!result.ok) {
          recordSourceFailure(SOURCE_IDS.SPORTSDATA, result.error || "request failed");
          const cached = readCache(cacheKey);
          if (cached) {
            markSourceCached(SOURCE_IDS.SPORTSDATA, cached.savedAt);
            return cachedResult(cached, { reason: result.error || SPORTSDATA_UNAVAILABLE_MESSAGE });
          }
          return emptyResult({ reason: result.error || SPORTSDATA_UNAVAILABLE_MESSAGE });
        }
        const data = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
        writeCache(cacheKey, data);
        recordSourceSuccess(SOURCE_IDS.SPORTSDATA);
        return {
          source: "SportsDataIO",
          data,
          cached: false,
          warnings: [],
          lastSuccessfulFetchAt: new Date().toISOString(),
          rateLimited: false,
          proxied: true,
        };
      },
      {
        maxAttempts: 2,
        isRetryable: (res, err) => {
          if (err) return true;
          if (!res || res.cached) return false;
          if (res.rateLimited) return false;
          if (res.warnings?.length) return false;
          return false;
        },
      }
    );
  });
}

/** Proxy health probe — never calls SportsDataIO directly from the browser. */
export async function probeSportsDataMlbStatusProxy() {
  const apiKey = getSportsDataApiKey();
  if (!apiKey) {
    return {
      ok: false,
      success: false,
      proxied: true,
      responseCode: 401,
      status: "not_configured",
      message: "SportsDataIO key not configured",
      data: null,
      keyConfigured: false,
    };
  }

  const result = await fetchJsonSafe(
    SPORTSDATA_MLB_STATUS_ROUTE,
    { headers: sportsDataProxyHeaders(), cache: "no-store" },
    {
      source: "SportsDataIO status",
      ttlMs: 0,
      timeoutMs: getSportsDataTimeoutMs(),
      maxRetries: ENRICHMENT_MAX_RETRIES,
      skip429Retry: true,
      enrichment: true,
    }
  );

  const envelope = result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data : null;
  const payload = envelope?.data ?? null;
  const responseCode = Number(envelope?.responseCode ?? result.status ?? 0);
  const success = Boolean(envelope?.success ?? envelope?.ok);
  const healthOk = success && responseCode === 200 && (payload === true || payload === false || payload != null);

  return {
    ok: healthOk,
    success: healthOk,
    proxied: true,
    responseCode,
    status: envelope?.status || (healthOk ? "connected" : "failed"),
    message: envelope?.message || (healthOk ? SPORTSDATA_CONNECTED_VIA_PROXY : result.error || SPORTSDATA_UNAVAILABLE_MESSAGE),
    data: payload,
    payload,
    timedOut: Boolean(envelope?.timedOut),
    unauthorized: Boolean(envelope?.unauthorized),
    rateLimited: Boolean(envelope?.rateLimited),
    durationMs: envelope?.durationMs || 0,
    keyConfigured: true,
    preview: envelope?.message || result.error || "",
  };
}

// --- Public endpoint helpers ---------------------------------------------

export function fetchTeams() {
  return fetchSportsDataEndpoint("teams", buildUrl("/scores/json/Teams"));
}

export function fetchGamesByDate(date = new Date()) {
  const day = isoDate(date);
  return fetchSportsDataEndpoint(`games-${day}`, buildUrl(`/scores/json/GamesByDate/${day}`));
}

export function fetchTeamMatchupStats(date = new Date()) {
  return fetchGamesByDate(date);
}

export async function fetchPlayerGameProjections(date = new Date()) {
  const day = isoDate(date);
  return fetchSportsDataEndpoint(
    `projections-${day}`,
    buildUrl(`/projections/json/PlayerGameProjectionStatsByDate/${day}`)
  );
}

export async function fetchFantasyProjections(date = new Date()) {
  return fetchPlayerGameProjections(date);
}

export async function fetchPlayerGameStats(date = new Date()) {
  const day = isoDate(date);
  return fetchSportsDataEndpoint(`game-stats-${day}`, buildUrl(`/stats/json/PlayerGameStatsByDate/${day}`));
}

export async function fetchPlayerSeasonStats(season = currentSeason()) {
  return fetchSportsDataEndpoint(`season-stats-${season}`, buildUrl(`/stats/json/PlayerSeasonStats/${season}`));
}

export async function fetchBattingAverages(season = currentSeason()) {
  const result = await fetchPlayerSeasonStats(season);
  const filtered = (result.data || [])
    .filter((row) => row && typeof row === "object" && Number.isFinite(Number(row.BattingAverage)))
    .map((row) => ({
      playerId: row.PlayerID,
      name: row.Name,
      team: row.Team,
      battingAverage: Number(row.BattingAverage),
      atBats: Number(row.AtBats),
      hits: Number(row.Hits),
      onBasePercentage: Number(row.OnBasePercentage),
      sluggingPercentage: Number(row.SluggingPercentage),
    }));
  return { ...result, data: filtered };
}

export async function fetchPitcherSeasonSplits(playerId, season = currentSeason()) {
  if (!playerId) return emptyResult({ reason: "playerId required for pitcher splits." });
  return fetchSportsDataEndpoint(
    `pitcher-splits-${season}-${playerId}`,
    buildUrl(`/stats/json/PlayerSeasonSplitStatsByPlayerID/${season}/${playerId}`)
  );
}

/** Aggregate snapshot for a slate: games + projections + season stats. */
export async function fetchSlateSnapshot({ date = new Date(), season = currentSeason() } = {}) {
  const [games, projections, seasonStats] = await Promise.all([
    fetchGamesByDate(date),
    fetchPlayerGameProjections(date),
    fetchPlayerSeasonStats(season),
  ]);
  return {
    source: "SportsDataIO",
    games,
    projections,
    seasonStats,
    cached: games.cached || projections.cached || seasonStats.cached,
    warnings: [...(games.warnings || []), ...(projections.warnings || []), ...(seasonStats.warnings || [])],
    proxied: true,
  };
}
