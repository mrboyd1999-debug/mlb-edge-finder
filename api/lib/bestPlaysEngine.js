/**
 * Best Plays Engine — fetches MLB props + season stats, projects lines, ranks by edge.
 */

import axios from "axios";

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

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeName(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeProjection(projection) {
  const value = Number(projection);
  if (Number.isNaN(value) || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return round(value, 2);
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
    const homeTeam = event.home_team || "";
    const awayTeam = event.away_team || "";

    for (const bookmaker of event.bookmakers || []) {
      for (const market of bookmaker.markets || []) {
        if (!isPlayerPropMarketKey(market.key)) continue;

        const grouped = new Map();
        for (const outcome of market.outcomes || []) {
          const line = num(outcome.point);
          if (line == null || line <= 0) continue;

          const sideName = String(outcome.name || "").trim().toLowerCase();
          const playerId = resolveOutcomePlayerId(outcome);
          const playerName = resolvePlayerName(outcome);
          if (!playerId && !playerName) continue;

          const side = sideName.includes("under") ? "under" : sideName.includes("over") ? "over" : "over";
          const dedupeKey = [playerId || playerName, market.key, line].join("|").toLowerCase();
          const existing = grouped.get(dedupeKey) || {
            playerId,
            player: playerName,
            prop: MARKET_LABELS[market.key] || market.key,
            marketKey: market.key,
            line,
            team: "",
            homeTeam,
            awayTeam,
          };

          if (!existing.player && playerName) existing.player = playerName;
          if (!existing.playerId && playerId) existing.playerId = playerId;
          if (side === "over") existing.overLine = line;
          if (side === "under") existing.underLine = line;
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
    // fall through to event-based fetch
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

function resolveGamesPlayed(statRow = {}) {
  return (
    num(statRow.Games) ??
    num(statRow.GamesPlayed) ??
    num(statRow.Appearances) ??
    num(statRow.Started) ??
    0
  );
}

function computePerGameByPropType(statRow = {}, propType = "", marketKey = "") {
  const games = resolveGamesPlayed(statRow);
  if (!games || games <= 0) return null;

  const label = String(propType || MARKET_LABELS[marketKey] || marketKey || "").toLowerCase();

  if (/strikeout/.test(label)) {
    const total = num(statRow.PitchingStrikeouts) ?? num(statRow.Strikeouts);
    return total != null ? total / games : null;
  }
  if (/total bases/.test(label)) {
    const total = num(statRow.TotalBases);
    return total != null ? total / games : null;
  }
  if (/home run/.test(label)) {
    const total = num(statRow.HomeRuns);
    return total != null ? total / games : null;
  }
  if (/rbi/.test(label)) {
    const total = num(statRow.RunsBattedIn) ?? num(statRow.RBI);
    return total != null ? total / games : null;
  }
  if (/^runs$|runs scored/.test(label)) {
    const total = num(statRow.Runs);
    return total != null ? total / games : null;
  }
  if (/hits allowed/.test(label)) {
    const total = num(statRow.PitchingHits);
    return total != null ? total / games : null;
  }
  if (/walk/.test(label)) {
    const total = num(statRow.PitchingWalks) ?? num(statRow.Walks);
    return total != null ? total / games : null;
  }
  if (/hit/.test(label)) {
    const total = num(statRow.Hits);
    return total != null ? total / games : null;
  }

  return null;
}

function computeProjectionByPropType(statRow = {}, propType = "", marketKey = "") {
  const perGame = computePerGameByPropType(statRow, propType, marketKey);
  if (perGame == null) return null;

  const games = resolveGamesPlayed(statRow);
  const sampleFactor = 0.6 + 0.4 * Math.min(games / 25, 1);
  return sanitizeProjection(perGame * sampleFactor);
}

function buildStatsIndex(seasonStats = []) {
  const byPlayerId = new Map();
  for (const row of seasonStats) {
    const playerId = num(row.PlayerID);
    if (playerId != null) byPlayerId.set(playerId, row);
  }
  return byPlayerId;
}

function findStatRow(seasonStats = [], { playerId = null, playerName = "" } = {}, statsByPlayerId = new Map()) {
  if (playerId != null && statsByPlayerId.has(playerId)) {
    return statsByPlayerId.get(playerId);
  }

  const query = normalizeName(playerName);
  if (!query) return null;

  let stat = seasonStats.find((row) => normalizeName(row.Name) === query);
  if (stat) return stat;

  stat = seasonStats.find((row) => {
    const candidate = normalizeName(row.Name);
    return candidate.includes(query) || query.includes(candidate);
  });
  return stat || null;
}

function resolveInvalidReason(row = {}) {
  if (!row.player) return "missing player";
  if (!row.line || row.line <= 0) return "missing line";
  if (row.projection == null) return row.matchReason || "missing projection";
  return "";
}

function enrichPropRows(propRows = [], seasonStats = [], statsByPlayerId = new Map()) {
  const enriched = [];

  for (const row of propRows) {
    const statRow = findStatRow(
      seasonStats,
      { playerId: num(row.playerId), playerName: row.player },
      statsByPlayerId
    );

    const projection = statRow
      ? computeProjectionByPropType(statRow, row.prop, row.marketKey)
      : null;

    enriched.push({
      player: row.player,
      prop: row.prop,
      propType: row.prop,
      line: row.line,
      team: statRow ? String(statRow.Team || row.team || "").trim() : row.team || "",
      projection,
      games: statRow ? resolveGamesPlayed(statRow) : 0,
      matched: Boolean(statRow),
      matchReason: statRow ? "matched" : "no stat row match",
      direction:
        projection != null && row.line
          ? projection >= row.line
            ? "OVER"
            : "UNDER"
          : null,
      invalidReason: "",
    });
  }

  for (const row of enriched) {
    row.invalidReason = resolveInvalidReason(row);
    if (row.projection != null && row.line) {
      const diff = row.projection - row.line;
      const percentEdge = diff / row.line;
      const games = row.games || 0;
      const confidenceWeight = games > 20 ? 1.2 : games > 10 ? 1.0 : 0.7;
      const stability = Math.min(games / 25, 1);
      row.edgeScore = round(percentEdge * confidenceWeight * stability, 4);
      row.verifiedProbability = Math.max(
        50,
        Math.min(95, Math.round(50 + Math.abs(row.edgeScore) * 100))
      );
      row.verified = row.verifiedProbability >= 65;
      row.confidence = games >= 20 ? "HIGH" : games >= 8 ? "MED" : "LOW";
    } else {
      row.edgeScore = 0;
      row.verifiedProbability = 50;
      row.verified = false;
      row.confidence = "LOW";
    }
  }

  return enriched;
}

/**
 * Fetch live MLB props, merge with season stats, rank by edge magnitude, return top 10.
 */
export async function buildBestPlays() {
  const oddsKey = resolveOddsApiKey();
  const sportsKey = resolveSportsDataKey();

  const [propRows, seasonStats] = await Promise.all([
    fetchOddsPlayerProps(oddsKey),
    fetchPlayerSeasonStats(sportsKey),
  ]);

  console.log("RAW ODDS:", propRows.length);

  const statsByPlayerId = buildStatsIndex(seasonStats);
  const enriched = enrichPropRows(propRows, seasonStats, statsByPlayerId);

  console.log("NORMALIZED:", enriched.length);
  console.log(
    "WITH PROJECTIONS:",
    enriched.filter((p) => Number(p.projection) > 0).length
  );

  const filtered = enriched.filter((p) => p.player && p.line && p.projection);
  console.log("AFTER FILTER:", filtered.length);

  const ranked = [...filtered].sort(
    (a, b) => Number(b.verifiedProbability ?? 0) - Number(a.verifiedProbability ?? 0)
  );
  const topPlays = ranked.slice(0, TOP_N);
  const sample = enriched.slice(0, DEBUG_SAMPLE_SIZE);
  const invalidReasons = enriched.reduce((acc, row) => {
    const reason = row.invalidReason || "unknown";
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
