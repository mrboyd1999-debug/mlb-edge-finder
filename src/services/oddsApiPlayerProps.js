/**
 * Fetch + parse Odds API player props into a normalized display schema.
 * Used to populate allDisplayProps without requiring DFS props first.
 */
import { fetchJsonSafe, getCacheTtlMs } from "./fetchUtil.js";
import { ENRICHMENT_MAX_RETRIES, getApiTimeoutMs } from "../utils/apiTimeout.js";
import { getOddsApiKey as getRuntimeOddsApiKey } from "../config/apiConfig.js";
import {
  SOURCE_IDS,
  cachedLinesMessage,
  isSourceInCooldown,
  markSourceCached,
  recordSource429,
  recordSourceSuccess,
  withSourceRequestLock,
} from "./sourceRateLimit.js";

const ODDS_PROPS_CACHE_KEY = "dfs-odds-api-player-props-v1";
const ODDS_PROPS_CACHE_MAX_MS = 60 * 60 * 1000;
const MAX_EVENTS = 8;

const SPORT_KEYS = {
  MLB: "baseball_mlb",
  NBA: "basketball_nba",
  WNBA: "basketball_wnba",
};

const BASKETBALL_MARKETS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_points_rebounds_assists",
  "player_pra",
  "player_points_rebounds",
  "player_points_assists",
];

const MLB_MARKETS = [
  "player_strikeouts",
  "batter_total_bases",
  "batter_hits",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
];

const MARKET_PROP_TYPE = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers Made",
  player_points_rebounds_assists: "Points + Rebounds + Assists",
  player_pra: "Points + Rebounds + Assists",
  player_points_rebounds: "Points + Rebounds",
  player_points_assists: "Points + Assists",
  player_strikeouts: "Strikeouts",
  batter_total_bases: "Total Bases",
  batter_hits: "Hits",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
};

export async function fetchOddsApiDisplayProps({ sport = "all" } = {}) {
  return withSourceRequestLock(SOURCE_IDS.ODDS_API, () => fetchOddsApiDisplayPropsInternal({ sport }));
}

async function fetchOddsApiDisplayPropsInternal({ sport = "all" } = {}) {
  const apiKey = getOddsApiKey();
  if (!apiKey) {
    return { props: [], warnings: ["Missing Odds API key."], parsedCount: 0 };
  }

  if (isSourceInCooldown(SOURCE_IDS.ODDS_API)) {
    const cached = readOddsPropsCache();
    if (cached?.props?.length) {
      return {
        props: cached.props,
        warnings: [cachedLinesMessage(cached.savedAt)],
        cached: true,
        parsedCount: cached.props.length,
        lastSuccessfulFetchAt: cached.savedAt,
      };
    }
    return { props: [], warnings: ["Odds API rate limited."], rateLimited: true, parsedCount: 0 };
  }

  const sports =
    sport === "all"
      ? Object.keys(SPORT_KEYS)
      : SPORT_KEYS[sport]
        ? [sport]
        : [];

  const settled = await Promise.allSettled(sports.map((s) => fetchSportPlayerProps(apiKey, s)));
  const rawRows = settled.filter((r) => r.status === "fulfilled").flatMap((r) => r.value.rows);
  const warnings = settled
    .filter((r) => r.status === "rejected")
    .map((r) => String(r.reason?.message || r.reason || "Odds API fetch failed"));

  const props = normalizeOddsApiPropRows(rawRows);
  if (props.length) {
    writeOddsPropsCache(props);
    recordSourceSuccess(SOURCE_IDS.ODDS_API);
    return {
      props,
      warnings,
      parsedCount: props.length,
      lastSuccessfulFetchAt: new Date().toISOString(),
    };
  }

  if (warnings.some((w) => /429|rate limit/i.test(w))) {
    recordSource429(SOURCE_IDS.ODDS_API);
    const cached = readOddsPropsCache();
    if (cached?.props?.length) {
      markSourceCached(SOURCE_IDS.ODDS_API, cached.savedAt);
      return {
        props: cached.props,
        warnings: [cachedLinesMessage(cached.savedAt), ...warnings],
        cached: true,
        parsedCount: cached.props.length,
        lastSuccessfulFetchAt: cached.savedAt,
      };
    }
  }

  const cached = readOddsPropsCache();
  if (cached?.props?.length) {
    return {
      props: cached.props,
      warnings: [cachedLinesMessage(cached.savedAt), ...warnings],
      cached: true,
      parsedCount: cached.props.length,
      lastSuccessfulFetchAt: cached.savedAt,
    };
  }

  return { props: [], warnings, parsedCount: 0 };
}

async function fetchSportPlayerProps(apiKey, sport) {
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) return { rows: [] };
  const markets = sport === "MLB" ? MLB_MARKETS : BASKETBALL_MARKETS;
  const eventsUrl = sportsbookProxyUrl(`/v4/sports/${sportKey}/events`, { apiKey });
  const result = await fetchJsonSafe(eventsUrl.toString(), {}, {
    source: "Odds API events",
    ttlMs: getCacheTtlMs(),
    maxRetries: ENRICHMENT_MAX_RETRIES,
    skip429Retry: true,
    enrichment: true,
    timeoutMs: getApiTimeoutMs({ enrichment: true }),
  });
  if (!result.ok) {
    if (result.rateLimited) throw new Error("Odds API rate limit (429)");
    throw new Error(result.error || "Odds API events failed");
  }
  const events = Array.isArray(result.data) ? result.data : [];
  const now = Date.now();
  const upcoming = events
    .filter((e) => new Date(e.commence_time).getTime() > now)
    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
    .slice(0, MAX_EVENTS);

  const settled = await Promise.allSettled(
    upcoming.map((event) => fetchEventOddsRows(apiKey, sportKey, sport, event.id, markets, event.commence_time))
  );
  return { rows: settled.filter((r) => r.status === "fulfilled").flatMap((r) => r.value) };
}

async function fetchEventOddsRows(apiKey, sportKey, sport, eventId, markets, gameTime) {
  const url = sportsbookProxyUrl(`/v4/sports/${sportKey}/events/${eventId}/odds`, {
    apiKey,
    regions: "us",
    markets: markets.join(","),
    oddsFormat: "american",
  });
  const result = await fetchJsonSafe(url.toString(), {}, {
    source: "Odds API player props",
    ttlMs: getCacheTtlMs(),
    maxRetries: ENRICHMENT_MAX_RETRIES,
    skip429Retry: true,
    enrichment: true,
    timeoutMs: getApiTimeoutMs({ enrichment: true }),
  });
  if (!result.ok) {
    if (result.rateLimited) throw new Error("Odds API rate limit (429)");
    return [];
  }
  const event = result.data;
  if (!event || event.error) return [];

  const rows = [];
  (event.bookmakers || []).forEach((book) => {
    (book.markets || []).forEach((market) => {
      (market.outcomes || []).forEach((outcome) => {
        const parsed = parseOutcomeRow({
          sport,
          gameTime,
          marketKey: market.key,
          outcome,
          source: "OddsAPI",
        });
        if (parsed) rows.push(parsed);
      });
    });
  });
  return rows;
}

function parseOutcomeRow({ sport, gameTime, marketKey, outcome, source }) {
  const line = Number(outcome.point);
  if (!Number.isFinite(line) || line <= 0) return null;

  const name = String(outcome.name || "").trim();
  const description = String(outcome.description || outcome.participant || outcome.player || "").trim();
  let side = "";
  let player = "";

  if (/over|under/i.test(name)) {
    side = name.toLowerCase().includes("under") ? "under" : "over";
    player = description;
  } else if (/over|under/i.test(description)) {
    side = description.toLowerCase().includes("under") ? "under" : "over";
    player = name;
  } else {
    player = description || name;
    side = "over";
  }

  if (!player || player.length < 2 || /^over$|^under$/i.test(player)) return null;

  return {
    player,
    playerName: player,
    team: "",
    sport,
    propType: MARKET_PROP_TYPE[marketKey] || marketKey,
    statType: MARKET_PROP_TYPE[marketKey] || marketKey,
    market: MARKET_PROP_TYPE[marketKey] || marketKey,
    line,
    side,
    price: outcome.price,
    overOdds: side === "over" ? outcome.price : null,
    underOdds: side === "under" ? outcome.price : null,
    source,
    platform: "OddsAPI",
    gameTime: gameTime || null,
    startTime: gameTime || null,
  };
}

/** Merge over/under rows into single prop records. */
export function normalizeOddsApiPropRows(rows = []) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = [row.sport, row.player, row.propType, row.line].join("|").toLowerCase();
    const existing = grouped.get(key) || {
      player: row.player,
      playerName: row.playerName,
      team: row.team || "",
      sport: row.sport,
      propType: row.propType,
      statType: row.statType,
      market: row.market,
      line: row.line,
      overOdds: null,
      underOdds: null,
      source: row.source,
      platform: row.platform,
      gameTime: row.gameTime,
      startTime: row.startTime,
    };
    if (row.overOdds != null) existing.overOdds = row.overOdds;
    if (row.underOdds != null) existing.underOdds = row.underOdds;
    if (row.side === "over") existing.overOdds = row.price;
    if (row.side === "under") existing.underOdds = row.price;
    grouped.set(key, existing);
  });

  return Array.from(grouped.values()).filter((prop) => {
    const player = String(prop.player || "").trim();
    const line = Number(prop.line);
    return player.length >= 2 && Number.isFinite(line) && line > 0;
  });
}

function sportsbookProxyUrl(path, params = {}) {
  const url = new URL("/api/sportsbookOdds", window.location.origin);
  url.searchParams.set("path", path);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, value);
  });
  return url;
}

function getOddsApiKey() {
  return getRuntimeOddsApiKey();
}

function writeOddsPropsCache(props = []) {
  try {
    window.localStorage.setItem(
      ODDS_PROPS_CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), props: props.slice(0, 400) })
    );
  } catch {
    // ignore
  }
}

function readOddsPropsCache() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(ODDS_PROPS_CACHE_KEY) || "null");
    if (!cached?.props?.length) return null;
    if (Date.now() - new Date(cached.savedAt).getTime() > ODDS_PROPS_CACHE_MAX_MS) return null;
    return cached;
  } catch {
    return null;
  }
}
