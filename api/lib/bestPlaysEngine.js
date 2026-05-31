/**
 * Best Plays Engine — fetches MLB props + season stats, projects lines, ranks by edge.
 */

import axios from "axios";
import {
  computeProjectionForProp,
  logSportsDataSample,
  resetProjectionDebugCount,
  resolveSportsDataPropLabel,
} from "./sportsDataMlbStatProjection.js";

const ODDS_API_BASE = "https://api.the-odds-api.com";
const SPORTSDATA_MLB_BASE = "https://api.sportsdata.io/v3/mlb";
const MLB_SPORT_KEY = "baseball_mlb";
const CURRENT_SEASON = 2026;
const TOP_N = 10;
const DEBUG_SAMPLE_SIZE = 25;
const MAX_EVENTS = 12;
const REQUEST_TIMEOUT_MS = 30_000;
const BEST_PLAYS_DEBUG_MODE = true;

const MLB_PLAYER_PROP_MARKETS = [
  "player_props",
  "pitcher_strikeouts",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
  "pitcher_hits_allowed",
  "pitcher_walks",
];

const MARKET_LABELS = {
  player_props: "Player Prop",
  pitcher_strikeouts: "Strikeouts",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  pitcher_hits_allowed: "Hits Allowed",
  pitcher_walks: "Walks",
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveOddsApiKey() {
  return String(process.env.ODDS_API_KEY || process.env.VITE_ODDS_API_KEY || "").trim();
}

function resolveSportsDataKey() {
  return String(
    process.env.SPORTSIO_KEY ||
      process.env.SPORTSDATA_API_KEY ||
      process.env.VITE_SPORTSDATA_API_KEY ||
      ""
  ).trim();
}

function resolveOutcomePlayerId(outcome = {}) {
  const candidates = [
    outcome.player_id,
    outcome.playerId,
    outcome.participant_id,
    outcome.participantId,
  ];
  for (const value of candidates) {
    const id = num(value);
    if (id != null && id > 0) return id;
  }
  const sid = String(outcome.sid || "").trim();
  if (/^\d+$/.test(sid)) return Number(sid);
  return null;
}

function resolvePlayerName(outcome = {}) {
  const name = String(outcome.description || outcome.participant || outcome.name || "").trim();
  if (!name || /^over$|^under$/i.test(name)) return "";
  return name;
}

function isPlayerPropMarketKey(key = "") {
  const market = String(key || "").toLowerCase();
  return market === "player_props" || /^batter_|^pitcher_|^player_/.test(market);
}

function extractPropRowsFromOddsPayload(payload = []) {
  const events = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const rows = [];

  for (const event of events) {
    for (const bookmaker of event.bookmakers || []) {
      for (const market of bookmaker.markets || []) {
        if (!isPlayerPropMarketKey(market.key)) continue;

        const grouped = new Map();
        for (const outcome of market.outcomes || []) {
          const line = num(outcome.point);
          if (line == null || line <= 0) continue;

          const playerId = resolveOutcomePlayerId(outcome);
          const playerName = resolvePlayerName(outcome);
          if (!playerId && !playerName) continue;

          const dedupeKey = [playerId || playerName, market.key, line].join("|").toLowerCase();
          const existing = grouped.get(dedupeKey) || {
            playerId,
            player: playerName,
            prop: MARKET_LABELS[market.key] || market.key,
            statType: MARKET_LABELS[market.key] || market.key,
            marketKey: market.key,
            line,
          };

          if (!existing.player && playerName) existing.player = playerName;
          grouped.set(dedupeKey, existing);
        }

        rows.push(...grouped.values());
      }
    }
  }

  return rows.filter((row) => row.player && row.line != null);
}

async function fetchOddsPlayerProps(apiKey) {
  if (!apiKey) return [];

  try {
    const primaryUrl = `${ODDS_API_BASE}/v4/sports/${MLB_SPORT_KEY}/odds`;
    const primary = await axios.get(primaryUrl, {
      params: {
        apiKey,
        regions: "us",
        markets: "player_props",
        oddsFormat: "american",
      },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (primary.status === 200 && Array.isArray(primary.data)) {
      const parsed = extractPropRowsFromOddsPayload(primary.data);
      if (parsed.length) return parsed;
    }
  } catch {
    // fall through
  }

  return fetchOddsPlayerPropsViaEvents(apiKey);
}

async function fetchOddsPlayerPropsViaEvents(apiKey) {
  try {
    const eventsUrl = `${ODDS_API_BASE}/v4/sports/${MLB_SPORT_KEY}/events`;
    const eventsRes = await axios.get(eventsUrl, {
      params: { apiKey },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (eventsRes.status !== 200 || !Array.isArray(eventsRes.data)) return [];

    const now = Date.now();
    const upcoming = eventsRes.data
      .filter((event) => {
        const start = new Date(event.commence_time).getTime();
        return Number.isFinite(start) && start > now - 60 * 60 * 1000;
      })
      .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
      .slice(0, MAX_EVENTS);

    const marketList = MLB_PLAYER_PROP_MARKETS.filter((m) => m !== "player_props").join(",");
    const settled = await Promise.allSettled(
      upcoming.map(async (event) => {
        const oddsUrl = `${ODDS_API_BASE}/v4/sports/${MLB_SPORT_KEY}/events/${event.id}/odds`;
        const oddsRes = await axios.get(oddsUrl, {
          params: {
            apiKey,
            regions: "us",
            markets: marketList,
            oddsFormat: "american",
          },
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true,
        });
        if (oddsRes.status !== 200 || !oddsRes.data) return [];
        return extractPropRowsFromOddsPayload([oddsRes.data]);
      })
    );

    return settled
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value);
  } catch {
    return [];
  }
}

async function fetchPlayerSeasonStats(apiKey) {
  if (!apiKey) return [];

  try {
    const url = `${SPORTSDATA_MLB_BASE}/stats/json/PlayerSeasonStats/${CURRENT_SEASON}`;
    const response = await axios.get(url, {
      headers: {
        accept: "application/json",
        "Ocp-Apim-Subscription-Key": apiKey,
      },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (response.status !== 200 || !Array.isArray(response.data)) return [];
    return response.data.filter((row) => row && typeof row === "object");
  } catch {
    return [];
  }
}

function enrichPropRows(propRows = [], seasonStats = []) {
  resetProjectionDebugCount();
  const enriched = [];

  for (const row of propRows) {
    const propLabel =
      resolveSportsDataPropLabel(row) ||
      resolveSportsDataPropLabel({ statType: row.marketKey, prop: row.prop });

    const computed = computeProjectionForProp(
      { ...row, playerName: row.player, statType: propLabel || row.prop, prop: propLabel || row.prop },
      seasonStats
    );
    const projection = computed.projection;

    enriched.push({
      player: row.player,
      prop: propLabel || row.prop,
      line: row.line,
      team: computed.team || "",
      projection,
      rawStat: computed.rawStat,
      games: computed.games,
      matchReason: computed.matchReason,
      projectionSource: computed.projectionSource,
      direction:
        projection != null && row.line != null
          ? projection >= row.line
            ? "OVER"
            : "UNDER"
          : null,
      invalidReason: !row.player
        ? "missing player"
        : !row.line
          ? "missing line"
          : projection == null
            ? computed.matchReason || "missing projection"
            : "",
    });
  }

  return enriched;
}

export async function buildBestPlays() {
  const oddsKey = resolveOddsApiKey();
  const sportsKey = resolveSportsDataKey();

  const [propRows, seasonStats] = await Promise.all([
    fetchOddsPlayerProps(oddsKey),
    fetchPlayerSeasonStats(sportsKey),
  ]);

  console.log("RAW ODDS:", propRows.length);
  logSportsDataSample(seasonStats);

  const enriched = enrichPropRows(propRows, seasonStats);

  console.log("NORMALIZED:", enriched.length);
  console.log(
    "WITH PROJECTIONS:",
    enriched.filter((p) => p.projection != null && Number.isFinite(Number(p.projection))).length
  );

  const filtered = enriched.filter((p) => p.projection != null && p.player && p.line != null);
  console.log("AFTER FILTER:", filtered.length);

  const ranked = [...filtered].sort((a, b) => Number(b.projection) - Number(a.projection));
  const topPlays = ranked.slice(0, TOP_N);
  const sample = enriched.slice(0, DEBUG_SAMPLE_SIZE);
  const invalidReasons = enriched.reduce((acc, row) => {
    const reason = row.invalidReason || (row.projection != null ? "eligible" : "missing projection");
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});

  const plays = topPlays.length ? topPlays : BEST_PLAYS_DEBUG_MODE ? sample : [];

  return {
    success: true,
    debugMode: BEST_PLAYS_DEBUG_MODE,
    totalProps: enriched.length,
    totalAnalyzed: enriched.length,
    filteredCount: filtered.length,
    returned: plays.length,
    invalidReasons,
    sample,
    plays,
  };
}
