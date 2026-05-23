/**
 * SportsDataIO MLB stats client.
 *
 * Routes through the local `/api/sportsdata` proxy which forwards to
 * `https://api.sportsdata.io/v3/mlb/*` with the
 * `Ocp-Apim-Subscription-Key` header sourced from `VITE_SPORTSDATA_API_KEY`.
 *
 * Every endpoint short-circuits to a safe empty response (no throw) when the
 * key is missing or the upstream fails — the accepted-prop pipeline keeps
 * working on PrizePicks + Odds API alone if SportsDataIO is unavailable.
 *
 * Endpoints implemented:
 *   - Teams                     /scores/json/Teams
 *   - Games by date             /scores/json/GamesByDate/{date}
 *   - Player game projections   /projections/json/PlayerGameProjectionStatsByDate/{date}
 *   - Player game stats         /stats/json/PlayerGameStatsByDate/{date}
 *   - Player season stats       /stats/json/PlayerSeasonStats/{season}
 *   - Pitcher splits            /stats/json/PlayerSeasonSplitStatsByPlayerID/{season}/{playerId}
 *   - Batting averages          derived from PlayerSeasonStats
 *   - Fantasy projections       PlayerGameProjectionStatsByDate (FantasyPointsDraftKings/FanDuel/Yahoo)
 */

import { getSportsDataApiKey } from "../config/apiConfig.js";
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

const SPORTSDATA_BASE = "/api/sportsdata";
const SPORTSDATA_CACHE_PREFIX = "dfs-sportsdata-cache-v1";
const SPORTSDATA_CACHE_MAX_MS = 60 * 60 * 1000;

export const SPORTSDATA_UNAVAILABLE_MESSAGE =
  "SportsDataIO temporarily unavailable. Falling back to PrizePicks + Odds API.";

function isoDate(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10).replace(/-/g, "-");
}

function currentSeason(date = new Date()) {
  return new Date(date).getFullYear();
}

function buildUrl(path, params = {}) {
  const url = new URL(`${SPORTSDATA_BASE}${path.startsWith("/") ? "" : "/"}${path}`, window.location.origin);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, value);
  });
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
          { headers: { accept: "application/json" } },
          {
            source: "SportsDataIO",
            ttlMs: getCacheTtlMs(),
            timeoutMs: 15_000,
            maxRetries: 0,
            skip429Retry: true,
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
        };
      },
      {
        maxAttempts: 3,
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
  return fetchSportsDataEndpoint(
    `game-stats-${day}`,
    buildUrl(`/stats/json/PlayerGameStatsByDate/${day}`)
  );
}

export async function fetchPlayerSeasonStats(season = currentSeason()) {
  return fetchSportsDataEndpoint(
    `season-stats-${season}`,
    buildUrl(`/stats/json/PlayerSeasonStats/${season}`)
  );
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
  };
}
