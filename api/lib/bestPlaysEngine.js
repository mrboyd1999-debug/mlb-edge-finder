/**
 * Best Plays Engine — fetches MLB props + season stats, projects lines, ranks by edge.
 */

import axios from "axios";

const ODDS_API_BASE = "https://api.the-odds-api.com";
const SPORTSDATA_MLB_BASE = "https://api.sportsdata.io/v3/mlb";
const MLB_SPORT_KEY = "baseball_mlb";
const CURRENT_SEASON = 2026;
const MIN_EDGE_ABS = 0.015;
const MIN_GAMES = 5;
const TOP_N = 10;
const MAX_EVENTS = 12;
const REQUEST_TIMEOUT_MS = 30_000;

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
  pitcher_strikeouts: "Pitcher Strikeouts",
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

async function fetchPlayersDirectory(apiKey) {
  if (!apiKey) return [];

  try {
    const url = `${SPORTSDATA_MLB_BASE}/scores/json/Players`;
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

function buildNameToPlayerId(players = []) {
  const map = new Map();
  for (const row of players) {
    const playerId = num(row.PlayerID);
    if (playerId == null) continue;
    const names = [
      row.Name,
      [row.FirstName, row.LastName].filter(Boolean).join(" "),
      row.ShortName,
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    for (const name of names) {
      if (!map.has(name)) map.set(name, playerId);
    }
  }
  return map;
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

function resolveSeasonAverage(statRow = {}, marketKey = "") {
  const games = resolveGamesPlayed(statRow);
  if (!games || games <= 0) return null;

  const market = String(marketKey || "").toLowerCase();

  const totalByMarket = {
    pitcher_strikeouts: num(statRow.PitchingStrikeouts) ?? num(statRow.Strikeouts),
    batter_hits: num(statRow.Hits),
    batter_total_bases: num(statRow.TotalBases),
    batter_home_runs: num(statRow.HomeRuns),
    batter_rbis: num(statRow.RunsBattedIn) ?? num(statRow.RBI),
    batter_runs_scored: num(statRow.Runs),
    pitcher_hits_allowed: num(statRow.PitchingHits),
    pitcher_walks: num(statRow.PitchingWalks) ?? num(statRow.Walks),
    player_props: num(statRow.Hits) ?? num(statRow.PitchingStrikeouts),
  };

  const total = totalByMarket[market];
  if (total == null) return null;
  return total / games;
}

function buildStatsIndex(seasonStats = []) {
  const byPlayerId = new Map();
  for (const row of seasonStats) {
    const playerId = num(row.PlayerID);
    if (playerId != null) byPlayerId.set(playerId, row);
  }
  return byPlayerId;
}

function normalizePropRows(propRows = [], statsByPlayerId = new Map(), nameToPlayerId = new Map()) {
  const normalized = [];

  for (const row of propRows) {
    let playerId = num(row.playerId);
    const playerName = String(row.player || "").trim().toLowerCase();
    if (playerId == null && playerName) {
      playerId = nameToPlayerId.get(playerName) ?? null;
    }
    const statRow = playerId != null ? statsByPlayerId.get(playerId) : null;
    if (!statRow) continue;

    const line = num(row.line);
    const player = String(row.player || statRow.Name || "").trim();
    if (!player || line == null || line <= 0) continue;

    const games = resolveGamesPlayed(statRow);
    if (games < MIN_GAMES) continue;

    const avg = resolveSeasonAverage(statRow, row.marketKey);
    if (avg == null) continue;

    normalized.push({
      player,
      prop: row.prop,
      marketKey: row.marketKey,
      line,
      team: String(statRow.Team || row.team || "").trim(),
      avg: round(avg, 4),
      games,
      playerId,
    });
  }

  return normalized;
}

function computeProjection(avg, games) {
  const sampleFactor = 0.6 + 0.4 * Math.min(games / 25, 1);
  return round(avg * sampleFactor, 2);
}

function computeConfidence(games) {
  if (games >= 20) return "HIGH";
  if (games >= 8) return "MED";
  return "LOW";
}

function computeVerifiedProbability(edgeScore = 0) {
  const magnitude = Math.abs(Number(edgeScore) || 0);
  const probability = Math.round(50 + magnitude * 100);
  return Math.max(50, Math.min(95, probability));
}

function computeEdgeScore(projection, line, games) {
  const diff = projection - line;
  const percentEdge = diff / line;
  const confidenceWeight = games > 20 ? 1.2 : games > 10 ? 1.0 : 0.7;
  const stability = Math.min(games / 25, 1);
  return round(percentEdge * confidenceWeight * stability, 4);
}

function dedupeAnalyzedPlays(plays = []) {
  const seen = new Map();

  for (const play of plays) {
    const key = [play.playerId, play.prop, play.line].join("|").toLowerCase();
    const existing = seen.get(key);
    if (!existing || Math.abs(play.edgeScore) > Math.abs(existing.edgeScore)) {
      seen.set(key, play);
    }
  }

  return [...seen.values()];
}

function analyzeNormalizedProps(normalized = []) {
  const analyzed = [];

  for (const row of normalized) {
    const projection = computeProjection(row.avg, row.games);
    if (projection == null || row.line == null) continue;

    const edgeScore = computeEdgeScore(projection, row.line, row.games);
    if (Math.abs(edgeScore) < MIN_EDGE_ABS) continue;

    analyzed.push({
      player: row.player,
      prop: row.prop,
      line: row.line,
      team: row.team,
      projection,
      games: row.games,
      confidence: computeConfidence(row.games),
      edgeScore,
      verifiedProbability: computeVerifiedProbability(edgeScore),
      verified: computeVerifiedProbability(edgeScore) >= 65,
      direction: projection >= row.line ? "OVER" : "UNDER",
      playerId: row.playerId,
    });
  }

  return dedupeAnalyzedPlays(analyzed);
}

/**
 * Fetch live MLB props, merge with season stats, rank by edge magnitude, return top 10.
 */
export async function buildBestPlays() {
  const oddsKey = resolveOddsApiKey();
  const sportsKey = resolveSportsDataKey();

  const [propRows, seasonStats, playersDirectory] = await Promise.all([
    fetchOddsPlayerProps(oddsKey),
    fetchPlayerSeasonStats(sportsKey),
    fetchPlayersDirectory(sportsKey),
  ]);

  const statsByPlayerId = buildStatsIndex(seasonStats);
  const nameToPlayerId = buildNameToPlayerId(playersDirectory);
  const normalized = normalizePropRows(propRows, statsByPlayerId, nameToPlayerId);
  const enriched = normalized.map((row) => {
    const projection = computeProjection(row.avg, row.games);
    const edgeScore = computeEdgeScore(projection, row.line, row.games);
    return { ...row, projection, edgeScore };
  });
  const filtered = enriched.filter(
    (row) =>
      row.line &&
      row.projection &&
      row.games >= MIN_GAMES &&
      Math.abs(row.edgeScore) >= MIN_EDGE_ABS
  );

  console.log({
    rawProps: propRows.length,
    analyzed: enriched.length,
    filtered: filtered.length,
  });

  const analyzed = analyzeNormalizedProps(normalized);
  const merged =
    analyzed.length >= filtered.length
      ? analyzed
      : filtered.map((row) => ({
          player: row.player,
          prop: row.prop,
          line: row.line,
          team: row.team,
          projection: row.projection,
          games: row.games,
          confidence: computeConfidence(row.games),
          edgeScore: row.edgeScore,
          verifiedProbability: computeVerifiedProbability(row.edgeScore),
          verified: computeVerifiedProbability(row.edgeScore) >= 65,
          direction: row.projection >= row.line ? "OVER" : "UNDER",
        }));

  const ranked = merged.sort(
    (a, b) => Number(b.verifiedProbability ?? 0) - Number(a.verifiedProbability ?? 0)
  );
  const topPlays = ranked.slice(0, TOP_N).map(({ playerId, ...play }) => play);

  return {
    success: true,
    totalAnalyzed: merged.length,
    returned: topPlays.length,
    plays: topPlays,
  };
}
