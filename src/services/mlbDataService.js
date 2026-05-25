import { cachedFetch } from "./fetchUtil.js";
import { readSmartCacheIfFresh, writeSmartCache, CACHE_TTL } from "./smartCache.js";
import { SOURCE_LABELS } from "./statEnrichment.js";
import { normalizePlayerName, statProfileKey } from "../utils/playerNames.js";
import { canonicalMarketKey } from "../utils/marketNormalization.js";
import {
  logIncomingProp,
  logFetchError,
  logFetchResponse,
  logFetchStart,
  logLogsCount,
  logPropFailure,
  logProjectionExecution,
  tracePipelineStage,
} from "./mlbPipelineDebug.js";
import { buildMlbPropProjection } from "../modules/mlbProjectionService.js";
import { matchSportsbookPlayerToMlb } from "./playerMatcher.js";
import {
  computeDirectionalEdgeForSide,
  computeRawEdge,
  confidenceFromEdge,
  resolveRecommendedSide,
} from "../modules/propSideEngine.js";

const MLB_SEARCH_URL = "https://statsapi.mlb.com/api/v1/people/search";
const MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule";
const MLB_TEAMS_URL = "https://statsapi.mlb.com/api/v1/teams";

const profileInflight = new Map();
const opponentInflight = new Map();

export const MLB_DATA_FETCH_LIMIT = 120;

export function logMlbData(stage, payload = {}) {
  if (typeof console === "undefined") return;
  console.info(`[MLB Data] ${stage}`, payload);
}

export function logMlbPropScan(prop = {}, result = {}) {
  logMlbData("prop.scan", {
    sportsbookProp: {
      player: prop.playerName,
      stat: prop.statType,
      line: prop.line,
      source: prop.source || prop.platform,
      team: prop.team,
      opponent: prop.opponent,
    },
    matchedPlayer: result.matchedPlayer || null,
    matchConfidence: result.matchConfidence ?? null,
    logsFound: result.logsFound ?? 0,
    projection: result.projection ?? null,
    edge: result.edge ?? null,
    confidence: result.confidence ?? null,
    recommendation: result.recommendation ?? null,
    failureReason: result.failureReason ?? null,
    reasons: result.reasons ?? [],
  });
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function average(values = []) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function normalizeTeamKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeMlbPlayerName(name = "") {
  return normalizePlayerName(name);
}

function mlbSeasonYears(depth = 3) {
  const year = new Date().getFullYear();
  return Array.from({ length: depth }, (_, index) => year - index);
}

function tagSplitGroup(split = {}, groupName = "") {
  const group = String(groupName || split._statGroup || "").toLowerCase();
  return { ...split, _statGroup: group || split._statGroup || "" };
}

export function isPitchingSplit(split = {}) {
  const stat = split?.stat || split;
  const group = String(split?._statGroup || "").toLowerCase();
  if (group === "pitching") return true;
  const ip = stat.inningsPitched;
  if (ip != null && String(ip) !== "0.0" && String(ip) !== "0") return true;
  const ks = finiteNumber(stat.strikeOuts ?? stat.strikeouts);
  const ab = finiteNumber(stat.atBats);
  const pa = finiteNumber(stat.plateAppearances);
  return ks != null && ab == null && pa == null && ip != null;
}

export function isHittingSplit(split = {}) {
  const stat = split?.stat || split;
  const group = String(split?._statGroup || "").toLowerCase();
  if (group === "hitting") return true;
  return finiteNumber(stat.atBats) != null || finiteNumber(stat.plateAppearances) != null;
}

/** Keep pitching rows for pitcher markets and hitting rows for batter markets. */
export function filterMlbSplitsForStatType(splits = [], statType = "") {
  const key = canonicalMarketKey(statType);
  const pitcherKeys = ["strikeouts", "outs", "hitsAllowed", "earnedRuns"];
  if (pitcherKeys.includes(key)) {
    const pitching = (splits || []).filter(isPitchingSplit);
    if (pitching.length >= 1) return pitching;
    return (splits || []).filter((split) => {
      const stat = split?.stat || split;
      return finiteNumber(stat.strikeOuts ?? stat.strikeouts) != null && stat.inningsPitched != null;
    });
  }
  const hitting = (splits || []).filter(isHittingSplit);
  return hitting.length ? hitting : splits || [];
}

function summarizeLogResponse(payload = {}, season = null) {
  const buckets = (payload.stats || []).map((bucket) => ({
    group: bucket.group?.displayName || bucket.group?.groupName || "unknown",
    splits: bucket.splits?.length || 0,
  }));
  return { season, buckets, totalSplits: buckets.reduce((sum, row) => sum + row.splits, 0) };
}

export async function searchMlbPlayer(playerName = "") {
  const query = String(playerName || "").trim();
  if (!query) {
    logMlbData("search.skip", { reason: "empty player name" });
    return null;
  }

  const cacheKey = normalizePlayerName(query);
  const cached = readSmartCacheIfFresh("mlb-player-search", cacheKey, CACHE_TTL.STATS_MS);
  if (cached?.payload) return cached.payload;

  const match = await matchSportsbookPlayerToMlb(query);
  if (!match?.player?.id) {
    logMlbData("search.miss", { playerName: query, reason: match?.reason || "No StatsAPI player match" });
    return null;
  }

  const result = {
    id: match.player.id,
    fullName: match.player.fullName || query,
    primaryPosition: match.player.primaryPosition || "",
    currentTeam: match.player.currentTeam || "",
    matchConfidence: match.confidence,
  };
  writeSmartCache("mlb-player-search", cacheKey, result, { source: "mlb-stats-api" });
  logMlbData("search.hit", { playerName: query, matched: result.fullName, mlbId: result.id, confidence: match.confidence });
  return result;
}

/** Spec API: resolve MLB player by sportsbook name. */
export async function getPlayerByName(playerName = "") {
  const match = await matchSportsbookPlayerToMlb(playerName);
  if (!match?.player?.id) return null;
  return match.player;
}

/** Spec API: fetch recent game logs (current + prior season). */
export async function getPlayerLogs(playerRef, options = {}) {
  if (typeof playerRef === "object" && playerRef?.id) {
    return fetchMlbGameLogs(playerRef.id, options);
  }
  const player = await getPlayerByName(String(playerRef || ""));
  if (!player?.id) return [];
  return fetchMlbGameLogs(player.id, options);
}

/** Spec API: pitcher K / IP summary from logs. */
export async function getPitcherStats(playerRef, options = {}) {
  const logs = await getPlayerLogs(playerRef, { ...options, group: "pitching" });
  const ks = logs
    .map((split) => finiteNumber(split.stat?.strikeOuts ?? split.stat?.strikeouts))
    .filter(Number.isFinite);
  const ip = logs
    .map((split) => {
      const raw = split.stat?.inningsPitched;
      if (raw == null) return null;
      const [whole, frac = "0"] = String(raw).split(".");
      return Number(whole) + Number(frac) / 3;
    })
    .filter(Number.isFinite);

  return {
    gameCount: logs.length,
    last5Ks: average(ks.slice(0, 5)),
    seasonKs: average(ks),
    last5Ip: average(ip.slice(0, 5)),
    seasonIp: average(ip),
    logs,
  };
}

/** Spec API: opponent team K rate and run environment. */
export async function getOpponentStats(opponentName = "") {
  return fetchMlbOpponentMatchup(opponentName);
}

/** Spec API: probable starters for a matchup date. */
export async function getProbablePitchers(options = {}) {
  return fetchMlbProbablePitchers(options);
}

/** Spec API: weather from MLB schedule when available — never fabricated. */
export async function getWeatherData({ team = "", opponent = "", date = new Date() } = {}) {
  const dateText = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  const cacheKey = `weather|${dateText}|${normalizeTeamKey(team)}|${normalizeTeamKey(opponent)}`;
  const cached = readSmartCacheIfFresh("mlb-weather", cacheKey, CACHE_TTL.STATS_MS);
  if (cached?.payload !== undefined) return cached.payload;

  const url = new URL(MLB_SCHEDULE_URL);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("date", dateText);
  url.searchParams.set("hydrate", "team,venue,weather");

  const response = await cachedFetch(url);
  if (!response.ok) {
    logMlbData("weather.failed", { date: dateText, status: response.status });
    return null;
  }

  const payload = await response.json();
  const games = payload.dates?.[0]?.games || [];
  const teamNeedle = normalizeTeamKey(team);
  const oppNeedle = normalizeTeamKey(opponent);

  const game =
    games.find((item) => {
      const home = normalizeTeamKey(item.teams?.home?.team?.abbreviation || item.teams?.home?.team?.name);
      const away = normalizeTeamKey(item.teams?.away?.team?.abbreviation || item.teams?.away?.team?.name);
      const involvesTeam =
        !teamNeedle || home.includes(teamNeedle) || away.includes(teamNeedle) || teamNeedle.includes(home) || teamNeedle.includes(away);
      const involvesOpp =
        !oppNeedle || home.includes(oppNeedle) || away.includes(oppNeedle) || oppNeedle.includes(home) || oppNeedle.includes(away);
      return involvesTeam && involvesOpp;
    }) || games[0];

  if (!game) {
    logMlbData("weather.miss", { team, opponent, date: dateText });
    writeSmartCache("mlb-weather", cacheKey, null, { source: "mlb-stats-api" });
    return null;
  }

  const weather = game.weather || null;
  const venue = game.venue?.name || null;
  const note = weather
    ? [weather.condition, weather.temp ? `${weather.temp}F` : null, weather.wind ? `wind ${weather.wind}` : null]
        .filter(Boolean)
        .join(", ")
    : null;

  const result = weather
    ? {
        condition: weather.condition || null,
        temp: finiteNumber(weather.temp),
        wind: weather.wind || null,
        venue,
        note,
        gamePk: game.gamePk || null,
      }
    : null;

  writeSmartCache("mlb-weather", cacheKey, result, { source: "mlb-stats-api" });
  logMlbData("weather.loaded", { team, opponent, note, hasWeather: Boolean(result) });
  return result;
}

export async function fetchMlbGameLogs(playerId, { seasons = mlbSeasonYears(), group = "pitching,hitting" } = {}) {
  if (!playerId) return [];

  const cacheKey = `${playerId}|${seasons.join(",")}|${group}|v2`;
  const cached = readSmartCacheIfFresh("mlb-game-logs", cacheKey, CACHE_TTL.STATS_MS);
  if (cached?.payload?.splits) {
    logLogsCount(cached.payload.splits.length, { playerId, source: "cache" });
    return cached.payload.splits;
  }

  logFetchStart("game logs", { playerId, seasons, group });

  const allSplits = [];
  for (const season of seasons) {
    const statsUrl = new URL(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats`);
    statsUrl.searchParams.set("stats", "gameLog");
    statsUrl.searchParams.set("group", group);
    statsUrl.searchParams.set("season", String(season));
    let response;
    try {
      response = await cachedFetch(statsUrl);
    } catch (error) {
      logFetchError("game logs", { playerId, season, message: error.message });
      continue;
    }
    if (!response.ok) {
      logFetchError("game logs", { playerId, season, status: response.status, url: String(statsUrl) });
      logMlbData("logs.failed", { playerId, season, status: response.status, reason: "StatsAPI gameLog failed" });
      continue;
    }
    const payload = await response.json();
    logFetchResponse("game logs", summarizeLogResponse(payload, season));
    const splits = (payload.stats || []).flatMap((bucket) => {
      const groupName = bucket.group?.displayName || bucket.group?.groupName || "";
      return (bucket.splits || []).map((split) => tagSplitGroup(split, groupName));
    });
    allSplits.push(...splits);
  }

  const deduped = [];
  const seen = new Set();
  allSplits
    .map((split) => ({
      ...split,
      playedAt: new Date(split.date || split.game?.gameDate).getTime(),
    }))
    .filter((split) => Number.isFinite(split.playedAt))
    .sort((a, b) => b.playedAt - a.playedAt)
    .forEach((split) => {
      const key = `${split.date || split.game?.gameDate}|${split._statGroup}|${split.stat?.inningsPitched || ""}|${split.stat?.atBats || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(split);
    });

  writeSmartCache("mlb-game-logs", cacheKey, { splits: deduped }, { source: "mlb-stats-api" });
  logLogsCount(deduped.length, {
    playerId,
    pitching: deduped.filter(isPitchingSplit).length,
    hitting: deduped.filter(isHittingSplit).length,
    seasons,
  });
  logMlbData("logs.loaded", { playerId, count: deduped.length, seasons });
  return deduped;
}

export async function fetchMlbProbablePitchers({ date = new Date(), team = "", opponent = "" } = {}) {
  const dateText = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  const cacheKey = `${dateText}|${normalizeTeamKey(team)}|${normalizeTeamKey(opponent)}`;
  const cached = readSmartCacheIfFresh("mlb-probables", cacheKey, CACHE_TTL.STATS_MS);
  if (cached?.payload) return cached.payload;

  const url = new URL(MLB_SCHEDULE_URL);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("date", dateText);
  url.searchParams.set("hydrate", "probablePitcher,team");

  const response = await cachedFetch(url);
  if (!response.ok) {
    logMlbData("probables.failed", { date: dateText, status: response.status });
    return null;
  }

  const payload = await response.json();
  const games = payload.dates?.[0]?.games || [];
  const teamNeedle = normalizeTeamKey(team);
  const oppNeedle = normalizeTeamKey(opponent);

  let match = null;
  for (const game of games) {
    const home = game.teams?.home?.team || {};
    const away = game.teams?.away?.team || {};
    const homeKey = normalizeTeamKey(home.abbreviation || home.teamCode || home.name);
    const awayKey = normalizeTeamKey(away.abbreviation || away.teamCode || away.name);
    const involvesTeam =
      !teamNeedle || homeKey.includes(teamNeedle) || awayKey.includes(teamNeedle) || teamNeedle.includes(homeKey) || teamNeedle.includes(awayKey);
    const involvesOpp =
      !oppNeedle || homeKey.includes(oppNeedle) || awayKey.includes(oppNeedle) || oppNeedle.includes(homeKey) || oppNeedle.includes(awayKey);
    if (involvesTeam || involvesOpp || (!teamNeedle && !oppNeedle)) {
      match = game;
      break;
    }
  }

  if (!match) {
    logMlbData("probables.miss", { date: dateText, team, opponent });
    return null;
  }

  const homePitcher = match.teams?.home?.probablePitcher?.fullName || null;
  const awayPitcher = match.teams?.away?.probablePitcher?.fullName || null;
  const result = {
    date: dateText,
    homeTeam: match.teams?.home?.team?.abbreviation || match.teams?.home?.team?.name || "",
    awayTeam: match.teams?.away?.team?.abbreviation || match.teams?.away?.team?.name || "",
    homePitcher,
    awayPitcher,
    opponentStarterNote: homePitcher && awayPitcher ? `${awayPitcher} vs ${homePitcher}` : homePitcher || awayPitcher || null,
  };
  writeSmartCache("mlb-probables", cacheKey, result, { source: "mlb-stats-api" });
  logMlbData("probables.loaded", result);
  return result;
}

export async function fetchMlbOpponentMatchup(opponentName = "") {
  const needle = normalizeTeamKey(opponentName);
  if (!needle) return null;

  if (opponentInflight.has(needle)) return opponentInflight.get(needle);

  const task = (async () => {
    const cached = readSmartCacheIfFresh("mlb-opponent", needle, CACHE_TTL.STATS_MS);
    if (cached?.payload) return cached.payload;

    const teamsUrl = new URL(MLB_TEAMS_URL);
    teamsUrl.searchParams.set("sportId", "1");
    teamsUrl.searchParams.set("season", String(new Date().getFullYear()));
    const teamsResponse = await cachedFetch(teamsUrl);
    if (!teamsResponse.ok) {
      logMlbData("opponent.failed", { opponent: opponentName, status: teamsResponse.status });
      return null;
    }

    const teamsPayload = await teamsResponse.json();
    const team = (teamsPayload.teams || []).find((item) => {
      const abbr = normalizeTeamKey(item.abbreviation || item.teamCode || "");
      const name = normalizeTeamKey(item.name || item.teamName || "");
      return abbr === needle || name.includes(needle) || needle.includes(abbr);
    });
    if (!team?.id) {
      logMlbData("opponent.miss", { opponent: opponentName });
      return null;
    }

    const statsUrl = new URL(`https://statsapi.mlb.com/api/v1/teams/${team.id}/stats`);
    statsUrl.searchParams.set("stats", "season");
    statsUrl.searchParams.set("group", "hitting,pitching");
    statsUrl.searchParams.set("season", String(new Date().getFullYear()));
    const statsResponse = await cachedFetch(statsUrl);
    if (!statsResponse.ok) return null;

    const statsPayload = await statsResponse.json();
    const pitching = (statsPayload.stats || []).find((bucket) => bucket.group?.displayName === "pitching");
    const hitting = (statsPayload.stats || []).find((bucket) => bucket.group?.displayName === "hitting");
    const pitchSplit = pitching?.splits?.[0]?.stat || {};
    const hitSplit = hitting?.splits?.[0]?.stat || {};
    const games = finiteNumber(hitSplit.gamesPlayed) || finiteNumber(pitchSplit.gamesPlayed) || 1;
    const strikeouts = finiteNumber(pitchSplit.strikeOuts ?? pitchSplit.strikeouts);
    const walks = finiteNumber(pitchSplit.baseOnBalls ?? pitchSplit.walks) || 0;
    const hitsPitch = finiteNumber(pitchSplit.hits) || 0;
    const innings = finiteNumber(pitchSplit.inningsPitched) || games * 5;
    const whip = innings > 0 ? round((walks + hitsPitch) / innings, 2) : null;

    const context = {
      allowed: hitsPitch / games,
      rank: null,
      whip,
      strikeoutsPerGame: strikeouts != null ? round(strikeouts / games, 2) : null,
      hitsAllowedPerGame: round(hitsPitch / games, 2),
      runsScoredPerGame: round((finiteNumber(hitSplit.runs) || 0) / games, 2),
      homeRunsAllowed: round((finiteNumber(pitchSplit.homeRuns) || 0) / games, 2),
      note: `${team.abbreviation || team.name}: ${round((finiteNumber(hitSplit.runs) || 0) / games, 1)} R/G, ${round((strikeouts || 0) / games, 1)} K/G${whip != null ? `, WHIP ${whip}` : ""}`,
    };
    writeSmartCache("mlb-opponent", needle, context, { source: "mlb-stats-api" });
    logMlbData("opponent.loaded", { opponent: opponentName, strikeoutsPerGame: context.strikeoutsPerGame, whip });
    return context;
  })().finally(() => opponentInflight.delete(needle));

  opponentInflight.set(needle, task);
  return task;
}

export async function fetchMlbPlayerBundle(playerName = "") {
  const cacheKey = normalizePlayerName(playerName);
  if (!cacheKey) return null;

  if (profileInflight.has(cacheKey)) return profileInflight.get(cacheKey);

  const task = (async () => {
    const cached = readSmartCacheIfFresh("mlb-stats", cacheKey, CACHE_TTL.STATS_MS);
    if (cached?.payload?.splits?.length) return cached.payload;

    const player = await searchMlbPlayer(playerName);
    if (!player?.id) return null;

    const splits = await fetchMlbGameLogs(player.id);
    const bundle = {
      playerName: player.fullName || playerName,
      playerImage: `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${player.id}/headshot/67/current`,
      mlbId: player.id,
      playerId: player.id,
      primaryPosition: player.primaryPosition,
      currentTeam: player.currentTeam,
      splits,
      source: "MLB StatsAPI game logs",
      statSources: [SOURCE_LABELS.mlb],
      hasGameLogs: splits.length >= 3,
    };
    writeSmartCache("mlb-stats", cacheKey, bundle, { source: "mlb-stats-api" });
    return bundle;
  })().finally(() => profileInflight.delete(cacheKey));

  profileInflight.set(cacheKey, task);
  return task;
}

/**
 * Build a verified prop profile from raw MLB logs + opponent/probable context.
 * Delegates stat extraction to playerStats profile builder when available.
 */
export async function buildMlbPropDataPackage(prop = {}, { buildProfile = null } = {}) {
  logIncomingProp(prop);
  logMlbData("prop.incoming", {
    player: prop.playerName,
    stat: prop.statType,
    line: prop.line,
    team: prop.team,
    opponent: prop.opponent,
    source: prop.source || prop.platform,
  });

  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) {
    const reason = "Invalid sportsbook line";
    logPropFailure(reason, { player: prop.playerName, line: prop.line });
    return { profile: null, bundle: null, verified: false, reason };
  }

  const match = await matchSportsbookPlayerToMlb(prop.playerName);
  if (!match?.player?.id) {
    const reason = `Player not matched: ${match?.reason || "no StatsAPI match"}`;
    logPropFailure(reason, { player: prop.playerName, confidence: match?.confidence ?? 0 });
    return { profile: null, bundle: null, verified: false, reason };
  }

  const bundle = await fetchMlbPlayerBundle(prop.playerName);
  if (!bundle?.splits?.length) {
    const reason = bundle ? "No game logs returned from StatsAPI" : "MLB player bundle unavailable";
    logPropFailure(reason, { player: prop.playerName, mlbId: match.player.id });
    logMlbData("prop.unverified", { player: prop.playerName, reason });
    return {
      profile: null,
      bundle,
      opponentContext: null,
      probablePitchers: null,
      verified: false,
      reason,
    };
  }

  const relevantSplits = filterMlbSplitsForStatType(bundle.splits, prop.statType);
  logLogsCount(relevantSplits.length, {
    player: prop.playerName,
    stat: prop.statType,
    totalSplits: bundle.splits.length,
    filtered: true,
  });

  if (relevantSplits.length < 3) {
    const reason = `Insufficient ${canonicalMarketKey(prop.statType) || "market"} logs (${relevantSplits.length}/3 required)`;
    logPropFailure(reason, {
      player: prop.playerName,
      stat: prop.statType,
      pitchingLogs: bundle.splits.filter(isPitchingSplit).length,
      hittingLogs: bundle.splits.filter(isHittingSplit).length,
    });
    return {
      profile: null,
      bundle: { ...bundle, splits: relevantSplits },
      opponentContext: null,
      probablePitchers: null,
      verified: false,
      reason,
    };
  }

  const filteredBundle = { ...bundle, splits: relevantSplits, gradingRows: relevantSplits };

  const [opponentContext, probablePitchers, weather] = await Promise.all([
    prop.opponent ? getOpponentStats(prop.opponent) : Promise.resolve(null),
    getProbablePitchers({ team: prop.team, opponent: prop.opponent }),
    getWeatherData({ team: prop.team, opponent: prop.opponent }),
  ]);

  let profile = filteredBundle;
  if (typeof buildProfile === "function") {
    profile = buildProfile(filteredBundle, prop.statType, prop.line) || filteredBundle;
  }

  profile = {
    ...profile,
    playerImage: profile.playerImage || bundle.playerImage,
    mlbId: profile.mlbId || bundle.mlbId,
    playerId: profile.playerId || bundle.playerId,
    source: "MLB StatsAPI game logs",
    statSources: uniqueSources([...(profile.statSources || []), SOURCE_LABELS.mlb]),
    sparse: false,
    fallback: false,
    hasGameLogs: Boolean(profile.hasGameLogs || relevantSplits.length >= 3),
    gradingRows: profile.gradingRows || relevantSplits,
    splits: profile.splits || relevantSplits,
    opponentContext: opponentContext || profile.opponentContext || null,
    opponentPitcherWhip: opponentContext?.whip ?? profile.opponentPitcherWhip ?? null,
    opponentAllowed: opponentContext?.allowed ?? profile.opponentAllowed ?? null,
    opponentRank: opponentContext?.rank ?? profile.opponentRank ?? null,
    matchupNote: opponentContext?.note ?? profile.matchupNote ?? null,
    opponentStarterNote: probablePitchers?.opponentStarterNote || profile.opponentStarterNote || null,
    probableStarterConfirmed: profile.probableStarterConfirmed ?? null,
    hasMatchup: Boolean(opponentContext),
    weatherNote: weather?.note || profile.weatherNote || null,
    weatherData: weather || profile.weatherData || null,
  };

  logMlbData("prop.profile", {
    player: prop.playerName,
    matched: bundle.playerName,
    logs: bundle.splits.length,
    last5: profile.last5Average,
    season: profile.seasonAverage,
    opponentK: opponentContext?.strikeoutsPerGame ?? null,
    probable: probablePitchers?.opponentStarterNote ?? null,
    weather: weather?.note ?? null,
  });

  if (!profile.last5Average && !profile.seasonAverage) {
    const reason = "Logs loaded but stat values missing for market";
    logPropFailure(reason, {
      player: prop.playerName,
      stat: prop.statType,
      logs: relevantSplits.length,
    });
    return {
      profile: null,
      bundle: filteredBundle,
      opponentContext,
      probablePitchers,
      verified: false,
      reason,
    };
  }

  tracePipelineStage("prop.profile.ready", {
    player: prop.playerName,
    matched: bundle.playerName,
    logs: relevantSplits.length,
    last5: profile.last5Average,
    season: profile.seasonAverage,
  });

  return {
    profile,
    bundle: filteredBundle,
    opponentContext,
    probablePitchers,
    verified: true,
    reason: "Verified MLB logs loaded",
  };
}

export async function fetchMlbDataForProps(props = [], { buildProfile = null } = {}) {
  const stats = new Map();
  const warnings = [];
  const players = [...new Set((props || []).map((prop) => String(prop.playerName || "").trim()).filter(Boolean))].slice(
    0,
    MLB_DATA_FETCH_LIMIT
  );

  logMlbData("batch.start", { props: props.length, players: players.length });

  await Promise.allSettled(
    players.map(async (playerName) => {
      try {
        await fetchMlbPlayerBundle(playerName);
      } catch (error) {
        warnings.push(`${playerName}: ${error.message}`);
        logMlbData("batch.playerFailed", { playerName, reason: error.message });
      }
    })
  );

  for (const prop of props) {
    try {
      const data = await buildMlbPropDataPackage(prop, { buildProfile });
      if (data.profile) {
        const key = statProfileKey(prop);
        stats.set(key, { ...data.profile, sport: "MLB", statType: prop.statType });
      } else {
        warnings.push(`${prop.playerName}: ${data.reason}`);
      }
    } catch (error) {
      warnings.push(`${prop.playerName}: ${error.message}`);
      logMlbData("batch.propFailed", { player: prop.playerName, reason: error.message });
    }
  }

  logMlbData("batch.done", { profiles: stats.size, warnings: warnings.length });
  return { stats, warnings: [...new Set(warnings.filter(Boolean))] };
}

export async function analyzeMlbPropWithData(prop = {}, { buildProfile = null } = {}) {
  const data = await buildMlbPropDataPackage(prop, { buildProfile });
  const match = await matchSportsbookPlayerToMlb(prop.playerName);

  if (!data.profile) {
    logMlbPropScan(prop, {
      matchedPlayer: match?.player?.fullName || null,
      matchConfidence: match?.confidence ?? 0,
      logsFound: data.bundle?.splits?.length ?? 0,
      projection: null,
      edge: null,
      confidence: null,
      recommendation: "NO VERIFIED PLAY",
      failureReason: data.reason || "Verified MLB data unavailable",
    });
    return {
      ...prop,
      projectionUnavailable: true,
      displayStatus: "NO VERIFIED PLAY",
      statusMessage: "Awaiting projection data",
      dataFetchReason: data.reason,
    };
  }

  const context = {
    opponentContext: data.opponentContext,
    opponentStarterNote: data.probablePitchers?.opponentStarterNote,
    impliedGameTotal: data.profile.impliedGameTotal,
    weatherNote: data.profile.weatherNote,
  };

  const model = buildMlbPropProjection(prop, data.profile, context);
  logProjectionExecution({
    projection: model.projection,
    edge: model.edge,
    confidence: model.confidence,
    recommendation: model.modelPickLabel || (model.projectionUnavailable ? "NO VERIFIED PLAY" : model.passPlay ? "PASS" : null),
  });
  if (model.projectionUnavailable) {
    logPropFailure(model.statusMessage || data.reason || "Projection unavailable", {
      player: prop.playerName,
      stat: prop.statType,
      verified: model.isVerifiedProjection,
      dataStatus: model.dataStatus,
    });
  }
  logMlbPropScan(prop, {
    matchedPlayer: match?.player?.fullName || data.profile.playerName,
    matchConfidence: match?.confidence ?? null,
    logsFound: data.bundle?.splits?.length ?? data.profile?.splits?.length ?? 0,
    projection: model.projection,
    edge: model.edge,
    confidence: model.confidence,
    recommendation: model.modelPickLabel || (model.projectionUnavailable ? "NO VERIFIED PLAY" : model.passPlay ? "PASS" : null),
    failureReason: model.projectionUnavailable ? model.statusMessage || data.reason : null,
    reasons: model.reasons,
  });

  return applyModelToProp(prop, model);
}

function applyModelToProp(prop, model) {
  return {
    ...prop,
    projectedValue: model.projection,
    projection: model.projection,
    rawEdge: model.rawEdge,
    edge: model.edge ?? 0,
    edgePercent: model.edgePercent,
    bestPick: model.recommendedSide,
    side: model.recommendedSide,
    pick: model.recommendedSide,
    recommendedSide: model.modelSide,
    modelPick: model.modelPickLabel,
    modelSide: model.modelSide,
    confidence: model.confidence,
    confidenceScore: model.confidence,
    riskLevel: model.risk,
    volatilityLabel: model.volatilityLabel,
    dataStatus: model.dataStatus,
    projectionSource: model.projectionSource,
    projectionBreakdown: model.projectionBreakdown,
    projectionLabel: model.projectionLabel,
    isVerifiedProjection: model.isVerifiedProjection,
    isFallbackProjection: model.isFallbackProjection,
    projectionUnavailable: model.projectionUnavailable,
    passPlay: model.passPlay,
    displayStatus: model.displayStatus,
    statusMessage: model.statusMessage,
    whyThisPick: model.whyThisPick,
    modelReasons: model.reasons,
    analyticsReason: model.reasons?.join(" · ") || "",
    noEdge: model.passPlay || model.projectionUnavailable,
    isDisplayPlayable: !model.passPlay && !model.projectionUnavailable && Boolean(model.recommendedSide),
    bettingLabel: model.bettingLabel,
  };
}

function uniqueSources(items = []) {
  return [...new Set(items.filter(Boolean))];
}

export function calculateEdge(projection, line, side = null) {
  const resolvedSide = side || resolveRecommendedSide(projection, line);
  if (!resolvedSide) return { rawEdge: computeRawEdge(projection, line), edge: 0, recommendedSide: null };
  return {
    rawEdge: computeRawEdge(projection, line),
    edge: computeDirectionalEdgeForSide(projection, line, resolvedSide),
    recommendedSide: resolvedSide,
  };
}

export function calculateConfidence({ edge, line, volatility, marketKey, payoutType = "standard" }) {
  const absEdge = Math.abs(Number(edge) || 0);
  return confidenceFromEdge(absEdge, {
    volatility,
    payoutType,
    marketKey,
    isVerified: true,
  });
}

export function calculateVolatility(statType = "") {
  const key = canonicalMarketKey(statType);
  const table = {
    strikeouts: { tier: "LOW", score: 0.38, label: "Low variance" },
    outs: { tier: "MEDIUM", score: 0.52, label: "Medium variance" },
    hitsAllowed: { tier: "MEDIUM", score: 0.65, label: "Medium/high variance" },
    earnedRuns: { tier: "HIGH", score: 0.72, label: "High variance" },
    fantasyScore: { tier: "MEDIUM", score: 0.56, label: "Medium variance" },
    hrr: { tier: "HIGH", score: 0.82, label: "High variance" },
    totalBases: { tier: "MEDIUM", score: 0.55, label: "Medium variance" },
  };
  return table[key] || { tier: "MEDIUM", score: 0.5, label: "Medium variance" };
}

export function buildPitcherStrikeoutProjection(prop = {}, profile = {}, context = {}) {
  return buildMlbPropProjection({ ...prop, statType: prop.statType || "Pitcher Strikeouts" }, profile, context);
}

export function buildHitterProjection(prop = {}, profile = {}, context = {}) {
  return buildMlbPropProjection(prop, profile, context);
}
