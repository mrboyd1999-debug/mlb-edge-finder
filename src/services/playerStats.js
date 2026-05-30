import { cachedFetch } from "./fetchUtil.js";
import { readSmartCacheIfFresh, readSmartCacheAllowStale, writeSmartCache, CACHE_TTL } from "./smartCache.js";
import {
  SOURCE_LABELS,
  mlbRoleContext,
  minutesTrendFromGames,
  sparseProfileForProp,
  usageTrendFromGames,
} from "./statEnrichment.js";
import { MLB_ONLY_MODE, shouldRunNonMlbStatFetch } from "../utils/mlbOnlyMode.js";
import { canonicalStatType } from "../utils/marketNormalization.js";
import { enrichMlbProfilesFromSportsData } from "./mlbSportsDataEnrichment.js";
import {
  fetchMlbDataForProps,
  fetchMlbPlayerBundle,
  filterMlbSplitsForStatType,
} from "./mlbDataService.js";
import { buildMlbStatsApiUrl } from "./mlbStatsApiUrl.js";
import {
  statProfileKey,
  findStatProfile,
  normalizePlayerName,
  buildPlayerMatchKeys,
  resolvePropPlayerName,
} from "../utils/playerNames.js";
import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { emitVisibleProjectionDebug, emitSportRoutingDebug } from "../utils/projectionRuntimeDebug.js";
import { recordProjectionFetchAttempt } from "../utils/projectionFetchDebug.js";
import {
  assertProjectionDatasetNotEmpty,
  logProjectionFetchResult,
  logProjectionFetchStart,
  traceProjectionExecutionPath,
} from "../utils/projectionSourceTrace.js";
import { resolvePropSport } from "../utils/mlbOnlyMode.js";

export { statProfileKey, findStatProfile };

const WNBA_PLAYER_FETCH_LIMIT = 50;
const SOCCER_PLAYER_FETCH_LIMIT = 40;
const API_FOOTBALL_KEY = import.meta.env?.VITE_API_FOOTBALL_KEY || "";
const API_FOOTBALL_BASE = "/api/api-football";
const API_FOOTBALL_LEAGUE_IDS = [253, 39, 2, 140, 78, 61, 135];
const MLB_STATS_FETCH_CAP = 80;
const MLB_STATS_MAP_CACHE_KEY = "latest";

export function readCachedMlbStatsMap() {
  const cached = readSmartCacheAllowStale("mlb-stats-map", MLB_STATS_MAP_CACHE_KEY, CACHE_TTL.STATS_MS);
  const entries = cached?.payload?.entries;
  if (!Array.isArray(entries) || !entries.length) return null;
  return new Map(entries);
}

export function writeCachedMlbStatsMap(statsMap) {
  if (!(statsMap instanceof Map) || !statsMap.size) return;
  const entries = [...statsMap.entries()].slice(0, 4000);
  writeSmartCache("mlb-stats-map", MLB_STATS_MAP_CACHE_KEY, { entries }, { source: "fetchPlayerStats" });
}

export function persistStatProfile(stats, prop, profile) {
  storeStatProfile(stats, prop, profile);
}

export function isSupportedMlbStatProp(statType = "") {
  return isSupportedMlbStat(statType);
}

/** Pick props for stats fetch — unique players with supported markets first. */
export function pickUniquePropsForStatsFetch(props = [], max = MLB_STATS_FETCH_CAP) {
  const out = [];
  const seenPlayers = new Set();
  const seenPlayerStat = new Set();

  const playerStatKey = (prop) => {
    const playerName = resolvePropPlayerName(prop);
    return [
      String(resolvePropSport(prop) || prop.sport || "").toLowerCase(),
      normalizePlayerName(playerName),
      canonicalMarketKey(prop.statType || prop.market || prop.propType || ""),
    ].join("|");
  };

  const tryAdd = (prop) => {
    const playerName = resolvePropPlayerName(prop);
    if (!playerName) return false;
    const playerKey = normalizePlayerName(playerName);
    if (!playerKey) return false;
    const statKey = playerStatKey(prop);
    if (seenPlayerStat.has(statKey)) return false;
    seenPlayerStat.add(statKey);
    seenPlayers.add(playerKey);
    out.push({ ...prop, playerName: prop.playerName || playerName });
    return out.length >= max;
  };

  for (const prop of props || []) {
    if (!isSupportedMlbStat(prop.statType || prop.market || prop.propType || "")) continue;
    if (tryAdd(prop)) return out;
  }

  for (const prop of props || []) {
    const playerName = resolvePropPlayerName(prop);
    if (!playerName) continue;
    const playerKey = normalizePlayerName(playerName);
    if (seenPlayers.has(playerKey)) continue;
    if (tryAdd(prop)) return out;
  }

  for (const prop of props || []) {
    if (tryAdd(prop)) return out;
  }

  return out;
}

export async function fetchPlayerStats({ props = [] } = {}) {
  traceProjectionExecutionPath("fetchPlayerStats:enter", {
    propCount: props.length,
    mlbOnlyMode: MLB_ONLY_MODE,
    nonMlbStatsEnabled: shouldRunNonMlbStatFetch("NBA"),
  });

  if (!props.length) {
    const message = "fetchPlayerStats called with zero props — cannot build statsMap";
    traceProjectionExecutionPath("fetchPlayerStats:skip", { reason: message });
    logProjectionFetchResult("fetchPlayerStats", {
      endpoint: "MLB StatsAPI + optional SportsDataIO",
      status: "empty",
      data: [],
      count: 0,
      error: message,
    });
    throw new Error(message);
  }
  const stats = new Map();
  const warnings = [];
  const grouped = groupPropsBySport(props);
  traceProjectionExecutionPath("fetchPlayerStats:grouped", {
    MLB: grouped.MLB?.length ?? 0,
    NBA: grouped.NBA?.length ?? 0,
    WNBA: grouped.WNBA?.length ?? 0,
    Soccer: grouped.Soccer?.length ?? 0,
    Tennis: grouped.Tennis?.length ?? 0,
    Other: grouped.Other?.length ?? 0,
  });
  const routingPlan = Object.entries(grouped).map(([sport, sportProps]) => ({
    sport,
    league: sport,
    endpoint: projectionEndpointForSport(sport),
    propCount: sportProps.length,
    samplePlayer: sportProps[0]?.playerName || "",
  }));
  if (routingPlan.length) {
    emitSportRoutingDebug(routingPlan);
  }

  const jobs = [
    { sport: "MLB", run: () => fetchMlbStats(grouped.MLB || []) },
    ...(shouldRunNonMlbStatFetch("NBA") ? [{ sport: "NBA", run: () => fetchNbaStats(grouped.NBA || []) }] : []),
    ...(shouldRunNonMlbStatFetch("WNBA") ? [{ sport: "WNBA", run: () => fetchWnbaStats(grouped.WNBA || []) }] : []),
    ...(shouldRunNonMlbStatFetch("Soccer") ? [{ sport: "Soccer", run: () => fetchSoccerStats(grouped.Soccer || []) }] : []),
    ...(shouldRunNonMlbStatFetch("Tennis")
      ? [
          {
            sport: "Tennis",
            run: () =>
              fetchTennisStats([...(grouped.Tennis || []), ...(grouped["ATP Tennis"] || []), ...(grouped["WTA Tennis"] || [])]),
          },
        ]
      : []),
  ];

  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  settled.forEach((result, index) => {
    const sport = jobs[index].sport;
    const sportProps = grouped[sport] || [];
    if (result.status === "fulfilled") {
      mergeStats(stats, result.value.stats);
      warnings.push(...(result.value.warnings || []));
      emitSportRoutingDebug([
        {
          sport,
          league: sport,
          endpoint: projectionEndpointForSport(sport),
          propCount: sportProps.length,
          projectionCount: result.value.stats?.size ?? 0,
          samplePlayer: sportProps[0]?.playerName || "",
        },
      ]);
      return;
    }

    (grouped[sport] || []).forEach((prop) => {
      if (!findStatProfile(stats, prop)) {
        storeStatProfile(stats, prop, sparseProfileForProp(prop, `${sport} stat source failed`));
      }
    });
    warnings.push(`${sport} stat source failed; props left without verified stats.`);
  });

  const uncovered = props.filter((prop) => !findStatProfile(stats, prop) || findStatProfile(stats, prop)?.sparse);
  uncovered.forEach((prop) => {
    storeStatProfile(stats, prop, sparseProfileForProp(prop, "no stat source matched"));
  });

  const projectionProfiles = [...stats.values()];
  traceProjectionExecutionPath("fetchPlayerStats:complete", {
    statsMapSize: stats.size,
    profilesWithProjection: projectionProfiles.filter((row) => Number(row?.projection) > 0).length,
    warnings: warnings.length,
  });
  if (projectionProfiles.length > 0) {
    emitVisibleProjectionDebug(projectionProfiles, "fetchPlayerStats @ src/services/playerStats.js");
  } else {
    logProjectionFetchResult("fetchPlayerStats", {
      endpoint: "MLB StatsAPI + optional SportsDataIO",
      status: "empty",
      data: [],
      count: 0,
      error: "fetchPlayerStats finished with zero stat profiles",
    });
    assertProjectionDatasetNotEmpty(stats, {
      label: "fetchPlayerStats",
      endpoint: "MLB StatsAPI + optional SportsDataIO",
      status: "empty",
      allowSkip: true,
    });
  }

  if (stats.size > 0) {
    writeCachedMlbStatsMap(stats);
  }

  return {
    source: "Player stats",
    stats,
    warnings: unique(warnings).filter(Boolean),
  };
}

async function fetchMlbStats(props) {
  logProjectionFetchStart("MLB StatsAPI game logs", {
    endpoint: "/api/mlb (player game logs + profiles)",
    propCount: props.length,
  });

  const supportedProps = props.filter((prop) => isSupportedMlbStat(prop.statType));
  traceProjectionExecutionPath("fetchMlbStats:filter", {
    incoming: props.length,
    supported: supportedProps.length,
    droppedUnsupportedStat: props.length - supportedProps.length,
    sampleStatTypes: props.slice(0, 5).map((p) => p.statType),
  });

  if (!supportedProps.length) {
    const message =
      props.length > 0
        ? `No supported MLB stat types among ${props.length} props after isSupportedMlbStat filter`
        : "no supported MLB stat types";
    console.warn("[MLB StatsAPI] fetchMlbStats skipped", {
      incoming: props.length,
      sampleStatTypes: props.slice(0, 8).map((p) => p.statType),
    });
    traceProjectionExecutionPath("fetchMlbStats:skip", { reason: message });
    return { stats: new Map(), warnings: [message] };
  }

  const fetched = await fetchMlbDataForProps(supportedProps, {
    buildProfile: (bundle, statType, line) => profileForMlbProp(bundle, statType, line),
  });

  const stats = fetched.stats || new Map();
  const profiles = new Map();
  stats.forEach((profile) => {
    if (profile?.playerName) profiles.set(normalizePlayerName(profile.playerName), profile);
  });

  const sportsDataEnrichment = await enrichMlbProfilesFromSportsData(profiles, supportedProps);
  const enrichedProfiles = sportsDataEnrichment.profiles || profiles;

  supportedProps.forEach((prop) => {
    const playerName = resolvePropPlayerName(prop);
    const key = statProfileKey({ ...prop, playerName });
    const existing = stats.get(key);
    const enriched = enrichedProfiles.get(normalizePlayerName(playerName));
    if (existing && enriched) {
      stats.set(key, {
        ...enriched,
        ...existing,
        opponentContext: existing.opponentContext || enriched.opponentContext,
        splits: existing.splits || enriched.splits,
        gradingRows: existing.gradingRows || enriched.gradingRows,
        last5Average: existing.last5Average ?? enriched.last5Average,
        seasonAverage: existing.seasonAverage ?? enriched.seasonAverage,
        sampleSize: existing.sampleSize ?? enriched.sampleSize,
        hasGameLogs: existing.hasGameLogs ?? enriched.hasGameLogs,
        sparse: existing.sparse ?? enriched.sparse,
        fallback: existing.fallback ?? enriched.fallback,
        statSources: uniqueSources([...(existing.statSources || []), ...(enriched.statSources || [])]),
      });
    }
  });

  recordProjectionFetchAttempt({
    provider: "MLB StatsAPI",
    endpoint: "/api/mlb (player game logs + profiles)",
    sport: "MLB",
    ok: countProfilesWithRealProjection(stats) > 0,
    responseCount: stats.size,
    error: stats.size ? "" : "No MLB stat profiles built from game logs",
    warnings: fetched.warnings || [],
    rawSample: [...stats.values()].slice(0, 2),
  });

  logProjectionFetchResult("MLB StatsAPI game logs", {
    endpoint: "/api/mlb (player game logs + profiles)",
    status: stats.size ? 200 : 204,
    data: [...stats.values()].slice(0, 2),
    count: stats.size,
    error: stats.size ? null : "No MLB stat profiles built from game logs",
  });

  if (!stats.size) {
    assertProjectionDatasetNotEmpty(stats, {
      label: "MLB StatsAPI game logs",
      endpoint: "/api/mlb (player game logs + profiles)",
      status: 204,
      allowSkip: true,
    });
  }

  return {
    stats,
    warnings: unique([...(fetched.warnings || []), ...(sportsDataEnrichment.warnings || [])]).filter(Boolean),
  };
}

function countProfilesWithRealProjection(stats = new Map()) {
  let count = 0;
  stats.forEach((profile) => {
    if (!profile || profile.sparse || profile.fallback) return;
    if (Number(profile.projection) > 0) count += 1;
  });
  return count;
}

export function buildMlbStatProfileFromLogs(bundle, statType, line) {
  return profileForMlbProp(bundle, statType, line);
}

async function fetchNbaStats(props) {
  const supportedProps = props.filter((prop) => isSupportedBasketballStat(prop.statType));
  if (!supportedProps.length) return { stats: new Map(), warnings: [] };

  const stats = new Map();
  supportedProps.forEach((prop) => {
    storeStatProfile(stats, prop, sparseProfileForProp(prop, "NBA stat enrichment temporarily disabled"));
  });
  return {
    stats,
    warnings: ["NBA stat enrichment temporarily disabled — using verified line + sportsbook signals only."],
  };
}

async function fetchWnbaStats(props) {
  const supportedProps = props.filter((prop) => isSupportedBasketballStat(prop.statType));
  if (!supportedProps.length) return { stats: new Map(), warnings: [] };

  const players = uniquePlayerNames(supportedProps).slice(0, WNBA_PLAYER_FETCH_LIMIT);
  const settled = await Promise.allSettled(players.map((playerName) => fetchEspnWnbaProfile(playerName)));
  const result = profilesToBasketballStats({ props: supportedProps, settled, sourceName: "ESPN WNBA stats" });
  if (result.stats.size) return result;

  const stats = new Map();
  supportedProps.forEach((prop) => {
    storeStatProfile(stats, prop, sparseProfileForProp(prop, "WNBA stat source unavailable"));
  });
  return {
    stats,
    warnings: ["WNBA stat source unavailable; props left without verified stats."],
  };
}

async function fetchTennisStats(props) {
  const supportedProps = props.filter((prop) => isSupportedTennisStat(prop.statType));
  const stats = new Map();
  if (!supportedProps.length) return { stats, warnings: [] };

  supportedProps.forEach((prop) => {
    const embedded = embeddedProfileForProp(prop, "Tennis stats embedded in source feed");
    storeStatProfile(
      stats,
      prop,
      embedded || {
        ...sparseProfileForProp(prop, "Tennis logs require manual stat boost for now"),
        statSources: [prop.platform === "Underdog" ? SOURCE_LABELS.underdog : SOURCE_LABELS.line, SOURCE_LABELS.tennis],
      }
    );
  });
  return {
    stats,
    warnings: stats.size ? [] : ["Tennis props need manual stat boost or future log integration — not using synthetic averages."],
  };
}

async function fetchSoccerStats(props) {
  const supportedProps = props.filter((prop) => isSupportedSoccerStat(prop.statType));
  if (!supportedProps.length) return { stats: new Map(), warnings: [] };

  const players = uniquePlayerNames(supportedProps).slice(0, SOCCER_PLAYER_FETCH_LIMIT);
  const settled = await Promise.allSettled(players.map((playerName) => fetchApiFootballProfile(playerName)));
  const profiles = new Map();
  const stats = new Map();

  settled.forEach((result) => {
    if (result.status === "fulfilled" && result.value?.playerName) {
      profiles.set(normalizePlayerName(result.value.playerName), result.value);
    }
  });

  supportedProps.forEach((prop) => {
    const profile = profiles.get(normalizePlayerName(prop.playerName));
    const embedded = embeddedProfileForProp(prop, "Soccer stats embedded in source feed");
    const nextProfile = profile
      ? profileForSoccerProp(profile, prop.statType, prop.line)
      : embedded || sparseProfileForProp(prop, "Soccer player logs unavailable");
    storeStatProfile(stats, prop, { ...nextProfile, sport: "Soccer", statType: prop.statType });
  });

  const failed = settled.some((result) => result.status === "rejected");
  return {
    stats,
    warnings: failed ? ["Some Soccer player stats failed; props left without verified stats."] : [],
  };
}

async function fetchMlbProfile(playerName) {
  return fetchMlbPlayerBundle(playerName);
}

async function fetchEspnWnbaProfile(playerName) {
  const searchUrl = new URL("https://site.web.api.espn.com/apis/search/v2");
  searchUrl.searchParams.set("query", playerName);
  searchUrl.searchParams.set("limit", "10");

  const searchResponse = await cachedFetch(searchUrl);
  if (!searchResponse.ok) throw new Error("Could not load ESPN WNBA player search.");
  const searchPayload = await searchResponse.json();
  const athlete = findEspnWnbaAthlete(searchPayload, playerName);
  if (!athlete?.id) return null;

  const gamelogUrl = new URL(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${athlete.id}/gamelog`);
  const gamelogResponse = await cachedFetch(gamelogUrl);
  if (!gamelogResponse.ok) throw new Error("Could not load ESPN WNBA game logs.");
  const gamelog = await gamelogResponse.json();
  const games = extractEspnBasketballGames(gamelog);

  return {
    playerName: athlete.displayName || athlete.name || playerName,
    playerImage: athlete.headshot || athlete.image || "",
    sport: "WNBA",
    games,
  };
}

async function fetchApiFootballProfile(playerName) {
  for (const leagueId of API_FOOTBALL_LEAGUE_IDS) {
    const url = apiUrl(API_FOOTBALL_BASE, "/players");
    url.searchParams.set("search", playerName);
    url.searchParams.set("season", String(new Date().getFullYear()));
    url.searchParams.set("league", String(leagueId));

    const response = await cachedFetch(url);
    if (!response.ok) throw new Error("Could not load API-Football player stats.");
    const payload = await response.json();
    const playerRecord = (payload.response || []).find((item) => sameName(item.player?.name, playerName)) || payload.response?.[0];
    if (playerRecord?.player) {
      return {
        playerName: playerRecord.player.name || playerName,
        playerImage: playerRecord.player.photo || "",
        statistics: playerRecord.statistics || [],
      };
    }
  }

  return null;
}

function profileForMlbProp(profile, statType, line) {
  const splits = filterMlbSplitsForStatType(profile.splits || [], statType);
  const values = valuesFromMlbSplits(splits, statType);
  if (!values.length) {
    return sparseProfileForProp(
      { playerName: profile.playerName, statType, line, sport: "MLB", playerImage: profile.playerImage },
      "MLB game logs empty for stat type"
    );
  }
  return profileFromValues({
    playerName: profile.playerName,
    playerImage: profile.playerImage,
    values,
    line,
    source: "MLB StatsAPI game logs",
    statSources: [SOURCE_LABELS.mlb],
    roleContext: mlbRoleContext(splits, statType),
    extra: {
      gradingRows: splits,
      last5FantasyScores: valuesFromMlbSplits(splits, "Fantasy Score").slice(0, 5),
      strikeoutTrend: trendLabel(valuesFromMlbSplits(splits, "Pitcher Strikeouts")),
      pitchCountTrend: trendLabel(valuesFromMlbSplits(splits, "Pitches Thrown")),
      handednessMatchup: handednessMatchupFromSplits(splits),
      hitStreak: hitStreakFromSplits(splits),
      battingOrderNote: battingOrderNoteFromSplits(splits),
      parkFactorNote: parkFactorNoteFromSplits(splits),
      homeAwaySplit: homeAwaySplitFromSplits(splits, statType),
      probableStarterConfirmed: probableStarterFromSplits(splits, statType),
      weatherNote: profile.weatherNote || null,
      recentStolenBaseRate: recentStolenBaseRateFromSplits(splits),
      stolenBaseMatchupNote: stolenBaseMatchupNoteFromSplits(splits),
      battingAverage: battingAverageFromSplits(splits),
      recentHitsAverage: recentStatAverageFromSplits(splits, "hits"),
      gapPowerRate: gapPowerFromSplits(splits),
      extraBaseHitRate: extraBaseHitRateFromSplits(splits),
      isolatedPower: isolatedPowerFromSplits(splits),
      barrelRateEstimate: barrelRateEstimateFromSplits(splits),
      hrPerFlyBallEstimate: hrPerFlyBallEstimateFromSplits(splits),
      sprintSpeedProxy: sprintSpeedProxyFromSplits(splits),
    },
  });
}

function profilesToBasketballStats({ props, settled, sourceName }) {
  const profiles = new Map();
  const stats = new Map();

  settled.forEach((result) => {
    if (result.status === "fulfilled" && result.value?.playerName) {
      profiles.set(normalizePlayerName(result.value.playerName), result.value);
    }
  });

  props.forEach((prop) => {
    const profile = resolveBasketballProfile(profiles, prop.playerName);
    const nextProfile = profile
      ? profileForBasketballProp(profile, prop.statType, prop.line, sourceName)
      : sparseProfileForProp(prop, `${prop.sport} player logs unavailable`);
    storeStatProfile(stats, prop, nextProfile);
  });

  const failed = settled.some((result) => result.status === "rejected");
  return {
    stats,
    warnings: failed ? [`Some ${sourceName} requests failed; props left without verified stats.`] : [],
  };
}

function resolveBasketballProfile(profiles, playerName) {
  const key = normalizePlayerName(playerName);
  if (profiles.has(key)) return profiles.get(key);
  for (const [profileKey, profile] of profiles.entries()) {
    if (playerNamesMatch(profileKey, playerName) || playerNamesMatch(profile.playerName, playerName)) return profile;
  }
  return null;
}

function profileForBasketballProp(profile, statType, line, source) {
  const values = (profile.games || []).map((game) => basketballPrimaryStat(game, statType)).filter(Number.isFinite);
  const seasonValues = basketballValuesFromSeasonAverages(profile.seasonAverages || [], statType);
  const mergedValues = values.length >= 5 ? values : [...values, ...seasonValues].filter(Number.isFinite);
  const effectiveSource = source;
  if (!mergedValues.length) {
    return sparseProfileForProp(
      { playerName: profile.playerName, statType, line, sport: profile.sport, playerImage: profile.playerImage },
      `${profile.sport} game logs empty`
    );
  }
  const minutesTrend = minutesTrendFromGames(profile.games || []);
  const usageTrend = usageTrendFromGames(profile.games || [], statType);
  const projectedMinutes = projectedMinutes(profile.games);
  return profileFromValues({
    playerName: profile.playerName,
    playerImage: profile.playerImage,
    values: mergedValues,
    line,
    source: effectiveSource,
    statSources: [profile.sport === "WNBA" ? SOURCE_LABELS.espn : SOURCE_LABELS.sportsdata],
    projectedMinutes,
    minutesTrend,
    usageTrend,
    usageAdjustment: usageTrend?.label || (minutesTrend?.stable ? "Minutes stable" : minutesTrend?.label || null),
    pitchCountTrend: null,
    extra: {
      gradingRows: profile.games || [],
      last5FantasyScores: (profile.games || []).map((game) => basketballPrimaryStat(game, "Fantasy Score")).filter(Number.isFinite).slice(0, 5),
      minutesTrend,
      usageTrend,
      opponentRank: opponentRankFromEmbedded(profile, statType),
    },
  });
}

function basketballValuesFromSeasonAverages(rows = [], statType = "") {
  const key = canonicalStatType(statType);
  return rows
    .map((row) => {
      const stats = row.stats || row;
      const games = finiteNumber(stats.games_played ?? stats.gp) || 0;
      if (!games) return null;
      const points = safeRate(stats.pts, games);
      const rebounds = safeRate(stats.reb, games);
      const assists = safeRate(stats.ast, games);
      const threes = safeRate(stats.fg3m, games);
      if (key === "points") return points;
      if (key === "rebounds") return rebounds;
      if (key === "assists") return assists;
      if (key === "pr" && Number.isFinite(points) && Number.isFinite(rebounds)) return round(points + rebounds);
      if (key === "pa" && Number.isFinite(points) && Number.isFinite(assists)) return round(points + assists);
      if (key === "ra" && Number.isFinite(rebounds) && Number.isFinite(assists)) return round(rebounds + assists);
      if (key === "pra" && Number.isFinite(points) && Number.isFinite(rebounds) && Number.isFinite(assists)) {
        return round(points + rebounds + assists);
      }
      if (key === "threes") return threes;
      return null;
    })
    .filter(Number.isFinite);
}

function profileForSoccerProp(profile, statType, line) {
  const averageValue = soccerAverageFromApiFootball(profile.statistics || [], statType);
  if (!Number.isFinite(averageValue)) {
    return sparseProfileForProp({ playerName: profile.playerName, statType, line, sport: "Soccer" }, "Soccer averages unavailable");
  }
  const sampleSize = soccerAppearanceCount(profile.statistics || []);
  const values = syntheticValuesFromAverage(averageValue, Math.min(10, Math.max(5, sampleSize)), statVolatility("Soccer", statType, averageValue), profile.playerName + statType);
  const minutes = soccerMinutesFromApiFootball(profile.statistics || []);
  return profileFromValues({
    playerName: profile.playerName,
    playerImage: profile.playerImage,
    values,
    line,
    source: "API-Football season rates",
    statSources: [SOURCE_LABELS.soccer],
    projectedMinutes: minutes.projectedMinutes,
    minutesTrend: minutes.minutesTrend,
    usageAdjustment: minutes.projectedMinutes,
    extra: {
      crossesAverage: soccerAverageFromApiFootball(profile.statistics || [], "Crosses"),
      recentMinutes: minutes.recentMinutes,
    },
  });
}

function profileFromValues({
  playerName,
  playerImage = "",
  values = [],
  line,
  source,
  statSources = [],
  projectedMinutes = null,
  minutesTrend = null,
  usageTrend = null,
  usageAdjustment = null,
  roleContext = null,
  fallback = false,
  extra = {},
}) {
  const cleanValues = values.filter(Number.isFinite);
  const last5 = cleanValues.slice(0, 5);
  const last10 = cleanValues.slice(0, 10);
  const projection = weightedProjection(last5, last10, cleanValues);
  const sources = uniqueSources([...statSources, mapSourceFromText(source)]);
  return {
    playerName,
    playerImage,
    headshot: playerImage,
    imageUrl: playerImage,
    projection,
    projectionSource: fallback ? "fallback-player-stats" : "player-stats",
    source,
    statSources: sources,
    fallback,
    sparse: false,
    recentHitRate: hitRateVsLine(last10, line),
    last5Average: average(last5),
    last10Average: average(last10),
    seasonAverage: average(cleanValues),
    last5HitRate: hitRateVsLine(last5, line),
    last10HitRate: hitRateVsLine(last10, line),
    volatility: standardDeviation(last10),
    sampleSize: last10.length,
    projectedMinutes,
    minutesTrend,
    usageTrend,
    usageAdjustment,
    roleContext,
    hasGameLogs: last10.length >= 3,
    hasSeasonAverage: Number.isFinite(average(cleanValues)),
    hasPlayerAverage: Number.isFinite(average(last5)) || Number.isFinite(average(cleanValues)),
    pitchCountTrend: roleContext,
    ...extra,
  };
}

function embeddedProfileForProp(prop, source = "embedded source stats") {
  const raw = prop.raw?.attributes || prop.raw || {};
  const values = [
    raw.last5,
    raw.last_5,
    raw.recent_results,
    raw.recentResults,
    raw.game_log,
    raw.gameLog,
    raw.logs,
    raw.history,
  ]
    .flatMap((item) => valuesFromMaybeArray(item, prop.statType))
    .filter(Number.isFinite);
  const seasonAverage = firstFinite(
    raw.season_average,
    raw.seasonAverage,
    raw.avg,
    raw.average,
    raw.player_average,
    raw.playerAverage
  );
  const last5Average = firstFinite(raw.last5_average, raw.last5Average, raw.recent_average, raw.recentAverage);
  const projection = firstFinite(raw.projection, raw.projected, raw.projected_stat, raw.projectedStat);
  const seedValues = values.length
    ? values
    : [last5Average, seasonAverage, projection].filter(Number.isFinite);
  if (!seedValues.length) return null;
  const extra = {
    embeddedStats: true,
    hasGameLogs: values.length >= 3,
    hasSeasonAverage: Number.isFinite(seasonAverage),
  };
  if (Number.isFinite(seasonAverage)) extra.seasonAverage = seasonAverage;
  if (Number.isFinite(last5Average)) extra.last5Average = last5Average;

  return profileFromValues({
    playerName: prop.playerName,
    playerImage: prop.playerImage || prop.headshot || prop.imageUrl || "",
    values: seedValues,
    line: prop.line,
    source,
    statSources: [source.includes("Tennis") ? SOURCE_LABELS.tennis : SOURCE_LABELS.soccer],
    extra,
  });
}

function valuesFromMaybeArray(item, statType) {
  if (!item) return [];
  if (Array.isArray(item)) {
    return item
      .map((row) => {
        if (Number.isFinite(Number(row))) return Number(row);
        if (row && typeof row === "object") {
          return firstFinite(
            row.value,
            row.stat,
            row.result,
            row.fantasyScore,
            row.fantasy_score,
            row[canonicalStatType(statType)],
            row[String(statType || "")]
          );
        }
        return null;
      })
      .filter(Number.isFinite);
  }
  if (typeof item === "string") {
    return item
      .split(/[,\n|]/)
      .map((value) => Number(String(value).replace(/[^0-9.-]/g, "")))
      .filter(Number.isFinite);
  }
  if (typeof item === "object") {
    return valuesFromMaybeArray(Object.values(item), statType);
  }
  return Number.isFinite(Number(item)) ? [Number(item)] : [];
}

function firstFinite(...values) {
  return values.map((value) => Number(value)).find(Number.isFinite);
}

function trendLabel(values = []) {
  const clean = values.filter(Number.isFinite).slice(0, 10);
  if (clean.length < 4) return null;
  const recent = average(clean.slice(0, 3));
  const previous = average(clean.slice(3, 6));
  if (!Number.isFinite(recent) || !Number.isFinite(previous)) return null;
  const delta = round(recent - previous, 1);
  if (Math.abs(delta) < 0.5) return "stable recent trend";
  return delta > 0 ? `trending up ${delta}` : `trending down ${Math.abs(delta)}`;
}

function handednessMatchupFromSplits(splits = []) {
  const recent = splits.slice(0, 10);
  const left = recent.filter((split) => /L/i.test(String(split.stat?.opponentHandedness || split.opponentHandedness || ""))).length;
  const right = recent.filter((split) => /R/i.test(String(split.stat?.opponentHandedness || split.opponentHandedness || ""))).length;
  if (!left && !right) return null;
  return left > right ? "Recent sample leaned vs LHP/LHB" : "Recent sample leaned vs RHP/RHB";
}

function hitStreakFromSplits(splits = []) {
  let streak = 0;
  for (const split of splits) {
    const hits = finiteNumber(split.stat?.hits);
    if ((hits || 0) >= 1) streak += 1;
    else break;
  }
  return streak;
}

function battingOrderNoteFromSplits(splits = []) {
  const orders = splits
    .slice(0, 8)
    .map((split) => finiteNumber(split.stat?.battingOrder ?? split.battingOrder))
    .filter(Number.isFinite);
  if (!orders.length) return null;
  const avg = average(orders);
  if (avg <= 2.2) return "Leadoff/top-of-order role in recent games";
  if (avg <= 4.2) return "Top-third batting order spot";
  if (avg <= 6.2) return "Heart-of-order cleanup spot";
  return "Lower-order batting spot";
}

function homeAwaySplitFromSplits(splits = [], statType = "") {
  const home = [];
  const away = [];
  splits.slice(0, 12).forEach((split) => {
    const isHome =
      split.isHome === true ||
      split.home === true ||
      String(split.game?.homeAway || split.homeAway || "").toLowerCase() === "home";
    const values = valuesFromMlbSplits([split], statType);
    const value = values[0];
    if (!Number.isFinite(value)) return;
    if (isHome) home.push(value);
    else away.push(value);
  });
  if (home.length < 2 || away.length < 2) return null;
  const homeAvg = average(home);
  const awayAvg = average(away);
  if (homeAvg == null || awayAvg == null) return null;
  const delta = round(homeAvg - awayAvg, 2);
  if (Math.abs(delta) < 0.15) return "Neutral home/away split";
  return delta > 0 ? `Home split stronger (+${Math.abs(delta)})` : `Away split stronger (+${Math.abs(delta)})`;
}

function probableStarterFromSplits(splits = [], statType = "") {
  const pitcherMarket = /strikeout|pitcher|earned run|hits allowed|outs recorded|pitching/i.test(String(statType || ""));
  if (!pitcherMarket) return null;
  const recent = splits.slice(0, 5);
  const starts = recent.filter((split) => {
    const stat = split.stat || split;
    if (finiteNumber(stat.gamesStarted) === 1) return true;
    const ipText = String(stat.inningsPitched || "");
    if (!ipText) return false;
    const [whole, partial = "0"] = ipText.split(".");
    const ip = Number(whole) + (Number(partial) / 3 || 0);
    return Number.isFinite(ip) && ip >= 3;
  });
  return starts.length >= 3;
}

function parkFactorNoteFromSplits(splits = []) {
  const recent = splits.slice(0, 8);
  const runRates = recent
    .map((split) => {
      const runs = finiteNumber(split.stat?.runs);
      const hits = finiteNumber(split.stat?.hits);
      const homeRuns = finiteNumber(split.stat?.homeRuns);
      if (runs == null && hits == null) return null;
      return (runs || 0) + (hits || 0) * 0.35 + (homeRuns || 0) * 0.8;
    })
    .filter(Number.isFinite);
  if (runRates.length < 3) return null;
  const avg = average(runRates);
  if (avg >= 2.4) return "Recent hitter-friendly run environment";
  if (avg <= 1.1) return "Recent pitcher-friendly run environment";
  return "Neutral recent park/run environment";
}

function recentStolenBaseRateFromSplits(splits = [], limit = 10) {
  const recent = splits.slice(0, limit);
  const games = recent.filter((split) => Number(split.stat?.atBats || split.stat?.plateAppearances) > 0);
  if (!games.length) return null;
  const stolen = games.reduce((sum, split) => sum + (finiteNumber(split.stat?.stolenBases) || 0), 0);
  return round(stolen / games.length, 2);
}

function stolenBaseMatchupNoteFromSplits(splits = []) {
  const rate = recentStolenBaseRateFromSplits(splits, 8);
  if (rate == null) return null;
  if (rate >= 0.25) return "Recent stolen-base activity supports SB upside";
  if (rate >= 0.1) return "Moderate recent stolen-base usage";
  return "Limited recent stolen-base activity";
}

function battingAverageFromSplits(splits = [], limit = 15) {
  const recent = splits.slice(0, limit);
  let hits = 0;
  let atBats = 0;
  recent.forEach((split) => {
    const h = finiteNumber(split.stat?.hits);
    const ab = finiteNumber(split.stat?.atBats ?? split.stat?.ab);
    if (h != null) hits += h;
    if (ab != null) atBats += ab;
  });
  if (!atBats) return null;
  return round(hits / atBats, 3);
}

function recentStatAverageFromSplits(splits = [], statField = "hits", limit = 5) {
  const recent = splits.slice(0, limit);
  const values = recent.map((split) => finiteNumber(split.stat?.[statField])).filter(Number.isFinite);
  if (!values.length) return null;
  return round(average(values), 2);
}

function gapPowerFromSplits(splits = [], limit = 15) {
  const recent = splits.slice(0, limit);
  let doubles = 0;
  let atBats = 0;
  recent.forEach((split) => {
    const d = finiteNumber(split.stat?.doubles);
    const ab = finiteNumber(split.stat?.atBats ?? split.stat?.ab);
    if (d != null) doubles += d;
    if (ab != null) atBats += ab;
  });
  if (!atBats) {
    const perGame = recent.map((split) => finiteNumber(split.stat?.doubles)).filter(Number.isFinite);
    return perGame.length ? round(average(perGame), 3) : null;
  }
  return round(doubles / atBats, 3);
}

function extraBaseHitRateFromSplits(splits = [], limit = 15) {
  const recent = splits.slice(0, limit);
  let xbh = 0;
  let hits = 0;
  recent.forEach((split) => {
    const d = finiteNumber(split.stat?.doubles) || 0;
    const t = finiteNumber(split.stat?.triples) || 0;
    const hr = finiteNumber(split.stat?.homeRuns) || 0;
    const h = finiteNumber(split.stat?.hits);
    xbh += d + t + hr;
    if (h != null) hits += h;
  });
  if (!hits) return null;
  return round(xbh / hits, 3);
}

function isolatedPowerFromSplits(splits = [], limit = 15) {
  const recent = splits.slice(0, limit);
  let totalBases = 0;
  let atBats = 0;
  let hits = 0;
  recent.forEach((split) => {
    const stat = split.stat || {};
    const h = finiteNumber(stat.hits) || 0;
    const d = finiteNumber(stat.doubles) || 0;
    const t = finiteNumber(stat.triples) || 0;
    const hr = finiteNumber(stat.homeRuns) || 0;
    const ab = finiteNumber(stat.atBats ?? stat.ab);
    hits += h;
    totalBases += h + d + t * 2 + hr * 3;
    if (ab != null) atBats += ab;
  });
  if (!atBats) return null;
  const slugging = totalBases / atBats;
  const avg = hits / atBats;
  return round(Math.max(0, slugging - avg), 3);
}

function barrelRateEstimateFromSplits(splits = [], limit = 15) {
  const recent = splits.slice(0, limit);
  let homeRuns = 0;
  let atBats = 0;
  recent.forEach((split) => {
    const hr = finiteNumber(split.stat?.homeRuns);
    const ab = finiteNumber(split.stat?.atBats ?? split.stat?.ab);
    if (hr != null) homeRuns += hr;
    if (ab != null) atBats += ab;
  });
  if (!atBats) return null;
  const hrRate = homeRuns / atBats;
  return round(clamp(hrRate * 4.5, 0, 0.35), 3);
}

function hrPerFlyBallEstimateFromSplits(splits = [], limit = 15) {
  const recent = splits.slice(0, limit);
  let homeRuns = 0;
  let atBats = 0;
  recent.forEach((split) => {
    const hr = finiteNumber(split.stat?.homeRuns);
    const ab = finiteNumber(split.stat?.atBats ?? split.stat?.ab);
    if (hr != null) homeRuns += hr;
    if (ab != null) atBats += ab;
  });
  if (!atBats) return null;
  const flyBallEstimate = atBats * 0.38;
  if (!flyBallEstimate) return null;
  return round(homeRuns / flyBallEstimate, 3);
}

function sprintSpeedProxyFromSplits(splits = [], limit = 10) {
  const rate = recentStolenBaseRateFromSplits(splits, limit);
  if (rate == null) return null;
  return round(25 + rate * 18, 1);
}

function mlbSinglesFromStat(stat = {}) {
  const hits = finiteNumber(stat.hits);
  if (hits == null) return null;
  const doubles = finiteNumber(stat.doubles) || 0;
  const triples = finiteNumber(stat.triples) || 0;
  const homeRuns = finiteNumber(stat.homeRuns) || 0;
  return Math.max(0, hits - doubles - triples - homeRuns);
}

function opponentRankFromEmbedded(profile = {}, statType = "") {
  const raw = profile.raw || profile;
  return firstFinite(
    raw.opponentRank,
    raw.opponent_rank,
    raw.matchupRank,
    raw.matchup_rank,
    raw[`${canonicalStatType(statType)}OpponentRank`]
  );
}

async function buildMlbOpponentMap(props = []) {
  const opponents = [...new Set(props.map((prop) => prop.opponent).filter(Boolean))].slice(0, 20);
  const map = new Map();
  await Promise.allSettled(
    opponents.map(async (opponent) => {
      const ctx = await fetchMlbOpponentContext(opponent);
      if (ctx) map.set(normalize(opponent), ctx);
    })
  );
  return map;
}

async function fetchMlbOpponentContext(opponentName) {
  const teamsUrl = buildMlbStatsApiUrl("/v1/teams", {
    sportId: "1",
    season: new Date().getFullYear(),
  });
  const teamsResponse = await cachedFetch(teamsUrl, {}, { source: "MLB Stats" });
  if (!teamsResponse.ok) return null;
  const teamsPayload = await teamsResponse.json();
  const needle = normalize(opponentName);
  const team = (teamsPayload.teams || []).find((item) => {
    const abbr = normalize(item.abbreviation || item.teamCode || "");
    const name = normalize(item.name || item.teamName || "");
    return abbr === needle || name.includes(needle) || needle.includes(abbr);
  });
  if (!team?.id) return null;

  const statsUrl = buildMlbStatsApiUrl(`/v1/teams/${team.id}/stats`, {
    stats: "season",
    group: "hitting,pitching",
    season: new Date().getFullYear(),
  });
  const statsResponse = await cachedFetch(statsUrl, {}, { source: "MLB Stats" });
  if (!statsResponse.ok) return null;
  const statsPayload = await statsResponse.json();
  const hitting = (statsPayload.stats || []).find((bucket) => bucket.group?.displayName === "hitting");
  const pitching = (statsPayload.stats || []).find((bucket) => bucket.group?.displayName === "pitching");
  const hitSplit = hitting?.splits?.[0]?.stat || {};
  const pitchSplit = pitching?.splits?.[0]?.stat || {};
  const games = finiteNumber(hitSplit.gamesPlayed) || finiteNumber(pitchSplit.gamesPlayed) || 1;
  const runsAllowed = safeRate(pitchSplit.runs, games);
  const hitsAllowed = safeRate(pitchSplit.hits, games);
  const strikeouts = safeRate(pitchSplit.strikeOuts ?? pitchSplit.strikeouts, games);
  const runsScored = safeRate(hitSplit.runs, games);
  const homeRunsAllowed = safeRate(pitchSplit.homeRuns, games);
  const stolenBasesAllowed = safeRate(pitchSplit.stolenBases ?? hitSplit.stolenBases, games);
  const innings = finiteNumber(pitchSplit.inningsPitched) || games * 5;
  const walks = finiteNumber(pitchSplit.baseOnBalls ?? pitchSplit.walks) || 0;
  const hitsPitch = finiteNumber(pitchSplit.hits) || 0;
  const whip = innings > 0 ? round((walks + hitsPitch) / innings, 2) : null;
  const sbAgainstRate = stolenBasesAllowed;
  const catcherPopTimeProxy = sbAgainstRate != null ? round(1.88 + Math.min(0.35, sbAgainstRate * 0.25), 2) : null;
  return {
    allowed: hitsAllowed ?? runsScored ?? runsAllowed,
    rank: runsAllowed != null ? Math.round(clamp(30 - runsAllowed * 2.2, 1, 30)) : null,
    whip,
    homeRunsAllowed,
    stolenBasesAllowed: sbAgainstRate,
    catcherPopTimeProxy,
    strikeoutsPerGame: strikeouts,
    runsScoredPerGame: runsScored,
    hitsAllowedPerGame: hitsAllowed,
    runsAllowedPerGame: runsAllowed,
    note: `${team.abbreviation || team.name}: ${round(runsScored || 0)} R/G, ${round(strikeouts || 0)} K/G${whip != null ? `, WHIP ${whip}` : ""}`,
  };
}

function mapSourceFromText(source = "") {
  const text = String(source).toLowerCase();
  if (text.includes("mlb") || text.includes("statsapi")) return SOURCE_LABELS.mlb;
  if (text.includes("espn")) return SOURCE_LABELS.espn;
  if (text.includes("sportsdata") || text.includes("sportsdataio")) return SOURCE_LABELS.sportsdata;
  if (text.includes("soccer") || text.includes("api-football")) return SOURCE_LABELS.soccer;
  if (text.includes("tennis")) return SOURCE_LABELS.tennis;
  return "";
}

function uniqueSources(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function storeStatProfile(stats, prop, profile) {
  const playerName = resolvePropPlayerName(prop);
  const statKey = canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
  const sport = String(profile.sport || prop.sport || resolvePropSport(prop) || "MLB").toLowerCase();
  const enriched = {
    ...profile,
    sport: profile.sport || prop.sport || resolvePropSport(prop) || "MLB",
    statType: profile.statType || prop.statType || prop.market,
    playerName: profile.playerName || playerName,
    playerId:
      profile.playerId ??
      profile.sportsDataPlayerId ??
      profile.mlbPlayerId ??
      prop.playerId ??
      prop.sportsDataPlayerId ??
      prop.mlbPlayerId ??
      null,
  };

  const keys = new Set([statProfileKey(prop), statLookupKey(prop)]);
  for (const playerKey of buildPlayerMatchKeys(playerName)) {
    keys.add([sport, playerKey, statKey].filter(Boolean).join("|"));
  }
  const playerId = enriched.playerId;
  if (playerId != null && playerId !== "") {
    keys.add([sport, `id:${String(playerId)}`, statKey].filter(Boolean).join("|"));
  }

  for (const key of keys) {
    stats.set(key, enriched);
  }
}

function valuesFromMlbSplits(splits, statType) {
  return splits.map((split) => mlbPrimaryStat(split.stat, statType)).filter(Number.isFinite);
}

function mlbPrimaryStat(stat = {}, statType = "") {
  const type = String(statType).toLowerCase();
  const key = canonicalStatType(statType);
  if ((type.includes("hitter") || type.includes("batter")) && type.includes("strikeout")) return null;
  if (type.includes("pitches thrown") || type.includes("pitch count")) return pitchesThrown(stat);
  if (type.includes("fantasy")) return mlbFantasyScore(stat);
  if (isHitsRunsRbis(type)) return sumKnown([stat.hits, stat.runs, stat.rbi ?? stat.rbis]);
  if (type.includes("total base") || key === "totalBases") return finiteNumber(stat.totalBases);
  if (key === "singles" || (type.includes("single") && !type.includes("single game"))) return mlbSinglesFromStat(stat);
  if (key === "doubles" || type === "doubles") return finiteNumber(stat.doubles);
  if (key === "triples" || type.includes("triple")) return finiteNumber(stat.triples);
  if (key === "homeRuns" || type.includes("home run")) return finiteNumber(stat.homeRuns);
  if (key === "stolenBases" || type.includes("stolen base")) return finiteNumber(stat.stolenBases);
  if (key === "hitsAllowed" || (type.includes("hit") && type.includes("allow"))) return finiteNumber(stat.hits);
  if (key === "earnedRuns" || type.includes("earned run")) return finiteNumber(stat.earnedRuns);
  if (key === "walks" || (type.includes("walk") && type.includes("allow"))) return finiteNumber(stat.baseOnBalls ?? stat.walks);
  if (key === "batterWalks" || type === "walks") return finiteNumber(stat.baseOnBalls ?? stat.walks);
  if (type.includes("rbi")) return finiteNumber(stat.rbi ?? stat.rbis);
  if (type.includes("run") && !type.includes("earned") && !type.includes("allow")) return finiteNumber(stat.runs);
  if (key === "hits" || type === "hits" || type === "hit") return finiteNumber(stat.hits);
  if (key === "outs" || type.includes("pitching out") || (type.includes("out") && !type.includes("strikeout"))) {
    return outsRecorded(stat);
  }
  if (type.includes("strikeout") || type.includes("k")) return finiteNumber(stat.strikeOuts ?? stat.strikeouts);
  return null;
}

function basketballPrimaryStat(game = {}, statType = "") {
  const key = canonicalStatType(statType);
  const points = finiteNumber(game.pts ?? game.points) || 0;
  const rebounds = finiteNumber(game.reb ?? game.rebounds) || 0;
  const assists = finiteNumber(game.ast ?? game.assists) || 0;
  const steals = finiteNumber(game.stl ?? game.steals) || 0;
  const blocks = finiteNumber(game.blk ?? game.blocks) || 0;
  const turnovers = finiteNumber(game.turnover ?? game.turnovers) || 0;
  if (key === "points") return points;
  if (key === "rebounds") return rebounds;
  if (key === "assists") return assists;
  if (key === "pr") return points + rebounds;
  if (key === "pa") return points + assists;
  if (key === "ra") return rebounds + assists;
  if (key === "pra") return points + rebounds + assists;
  if (key === "threes") return finiteNumber(game.fg3m ?? game.threesMade ?? game.threePointersMade);
  if (key === "fantasyScore") return round(points + rebounds * 1.2 + assists * 1.5 + steals * 3 + blocks * 3 - turnovers);
  return null;
}

function soccerAverageFromApiFootball(statistics, statType) {
  const key = canonicalStatType(statType);
  const totals = statistics.map((row) => {
    const appearances = finiteNumber(row.games?.appearences ?? row.games?.appearances) || 0;
    if (!appearances) return null;
    if (key === "shots") return safeRate(row.shots?.total, appearances);
    if (key === "shotsOnTarget") return safeRate(row.shots?.on, appearances);
    if (key === "passesAttempted") return safeRate(row.passes?.total, appearances);
    if (key === "crosses") return safeRate(row.passes?.crosses ?? row.passes?.key, appearances);
    if (key === "goalieSaves") return safeRate(row.goals?.saves, appearances);
    if (key === "goalsAllowed") return safeRate(row.goals?.conceded, appearances);
    if (key === "tackles") return safeRate(row.tackles?.total, appearances);
    if (key === "fantasyScore") {
      const shots = safeRate(row.shots?.total, appearances) || 0;
      const shotsOn = safeRate(row.shots?.on, appearances) || 0;
      const passes = safeRate(row.passes?.total, appearances) || 0;
      const tackles = safeRate(row.tackles?.total, appearances) || 0;
      const saves = safeRate(row.goals?.saves, appearances) || 0;
      return round(shots + shotsOn * 2 + passes * 0.04 + tackles * 1.5 + saves * 2);
    }
    return null;
  }).filter(Number.isFinite);
  return average(totals);
}

function soccerAppearanceCount(statistics) {
  return statistics.reduce((sum, row) => sum + (finiteNumber(row.games?.appearences ?? row.games?.appearances) || 0), 0);
}

function soccerMinutesFromApiFootball(statistics = []) {
  const minutes = statistics
    .map((row) => {
      const appearances = finiteNumber(row.games?.appearences ?? row.games?.appearances) || 0;
      const totalMinutes = finiteNumber(row.games?.minutes);
      if (!appearances || !Number.isFinite(totalMinutes)) return null;
      return totalMinutes / appearances;
    })
    .filter(Number.isFinite);
  const avg = average(minutes);
  return {
    recentMinutes: minutes,
    projectedMinutes: Number.isFinite(avg) ? `${Math.round(avg)} min avg` : null,
    minutesTrend: minutes.length >= 2 ? { label: "season minutes profile", delta: 0, stable: true } : null,
  };
}

function projectedMinutes(games = []) {
  const mins = games.map((game) => parseMinutes(game.min ?? game.minutes)).filter(Number.isFinite).slice(0, 10);
  return mins.length ? `${Math.round(average(mins))} min avg` : null;
}

function parseMinutes(value) {
  if (value == null) return null;
  const text = String(value);
  if (text.includes(":")) {
    const [minutes, seconds] = text.split(":").map(Number);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) return minutes + seconds / 60;
  }
  return finiteNumber(value);
}

function weightedProjection(last5, last10, season) {
  const l5 = average(last5);
  const l10 = average(last10);
  const sea = average(season);
  const parts = [
    [l5, 0.45],
    [l10, 0.35],
    [sea, 0.2],
  ].filter(([value]) => Number.isFinite(value));
  if (!parts.length) return null;
  const weight = parts.reduce((sum, [, partWeight]) => sum + partWeight, 0);
  return round(parts.reduce((sum, [value, partWeight]) => sum + value * partWeight, 0) / weight);
}

function syntheticValuesFromAverage(avg, count, volatility, seed) {
  const values = [];
  const cleanCount = Math.max(5, count || 10);
  for (let index = 0; index < cleanCount; index += 1) {
    const ratio = deterministicRatio(`${seed}|${index}`);
    const wave = Math.sin((index + 1) * 1.7 + ratio * Math.PI);
    values.push(Math.max(0, round(avg + wave * volatility * (0.55 + ratio * 0.5))));
  }
  return values;
}

function statVolatility(sport, statType, projection) {
  const key = canonicalStatType(statType);
  if (sport === "MLB" && key === "pitchesThrown") return 9;
  if (sport === "MLB" && key === "strikeouts") return 1.7;
  if (sport === "MLB" && key === "outs") return 1.4;
  if (sport === "MLB" && key === "hitsAllowed") return 1.1;
  if (sport === "MLB" && key === "earnedRuns") return 1.2;
  if (sport === "MLB" && key === "walks") return 0.9;
  if (sport === "MLB" && key === "singles") return 0.8;
  if (sport === "MLB" && key === "doubles") return 0.7;
  if (sport === "MLB" && key === "triples") return 0.35;
  if (sport === "MLB" && key === "homeRuns") return 0.85;
  if (sport === "MLB" && key === "stolenBases") return 0.65;
  if (sport === "MLB" && key === "batterWalks") return 0.75;
  if (sport === "MLB") return 0.9;
  if (sport === "NBA" || sport === "WNBA") {
    if (key === "points") return 5;
    if (key === "rebounds") return 3;
    if (key === "assists") return 2.5;
    if (key === "pra") return 7;
    if (key === "ra") return 4.5;
    if (key === "pr") return 6;
    if (key === "pa") return 5.5;
    if (key === "threes") return 1.4;
    return 5;
  }
  if (sport === "Soccer") {
    if (key === "passesAttempted") return 9;
    if (key === "goalieSaves") return 1.2;
    if (key === "goalsAllowed") return 1;
    return 0.9;
  }
  if (sport === "ATP Tennis" || sport === "WTA Tennis" || sport === "Tennis") {
    if (key === "totalGames") return 4;
    if (key === "aces") return 3;
    return 3;
  }
  return Math.max(0.7, Number(projection || 1) * 0.2);
}

function projectionRange(sport, statType) {
  const key = canonicalStatType(statType);
  if (sport === "MLB" && key === "pitchesThrown") return { min: 40, max: 130, step: 3 };
  if (sport === "MLB" && key === "strikeouts") return { min: 0, max: 15, step: 0.5 };
  if (sport === "MLB" && key === "outs") return { min: 0, max: 27, step: 0.5 };
  if (sport === "MLB" && key === "hitsAllowed") return { min: 0, max: 12, step: 0.5 };
  if (sport === "MLB" && key === "earnedRuns") return { min: 0, max: 8, step: 0.5 };
  if (sport === "MLB" && key === "walks") return { min: 0, max: 6, step: 0.5 };
  if (sport === "MLB" && key === "hrr") return { min: 0, max: 8, step: 0.35 };
  if (sport === "MLB" && key === "totalBases") return { min: 0, max: 8, step: 0.35 };
  if (sport === "MLB" && key === "singles") return { min: 0, max: 4, step: 0.25 };
  if (sport === "MLB" && key === "doubles") return { min: 0, max: 3, step: 0.25 };
  if (sport === "MLB" && key === "triples") return { min: 0, max: 2, step: 0.25 };
  if (sport === "MLB" && key === "homeRuns") return { min: 0, max: 3, step: 0.25 };
  if (sport === "MLB" && key === "stolenBases") return { min: 0, max: 3, step: 0.25 };
  if (sport === "MLB" && key === "batterWalks") return { min: 0, max: 3, step: 0.25 };
  if (sport === "MLB" && ["hits", "rbis", "runs"].includes(key)) return { min: 0, max: 6, step: 0.25 };
  if ((sport === "NBA" || sport === "WNBA") && key === "points") return { min: 0, max: 60, step: 1.2 };
  if ((sport === "NBA" || sport === "WNBA") && key === "rebounds") return { min: 0, max: 25, step: 0.8 };
  if ((sport === "NBA" || sport === "WNBA") && key === "assists") return { min: 0, max: 20, step: 0.7 };
  if ((sport === "NBA" || sport === "WNBA") && key === "pra") return { min: 0, max: 100, step: 1.8 };
  if ((sport === "NBA" || sport === "WNBA") && key === "ra") return { min: 0, max: 35, step: 1.2 };
  if ((sport === "NBA" || sport === "WNBA") && key === "pr") return { min: 0, max: 80, step: 1.5 };
  if ((sport === "NBA" || sport === "WNBA") && key === "pa") return { min: 0, max: 80, step: 1.5 };
  if ((sport === "NBA" || sport === "WNBA") && key === "threes") return { min: 0, max: 12, step: 0.45 };
  if (sport === "Soccer" && key === "passesAttempted") return { min: 0, max: 140, step: 4 };
  if (sport === "Soccer" && key === "goalieSaves") return { min: 0, max: 15, step: 0.5 };
  if (sport === "Soccer" && key === "goalsAllowed") return { min: 0, max: 8, step: 0.4 };
  if (sport === "Soccer") return { min: 0, max: 10, step: 0.35 };
  if (sport === "ATP Tennis" || sport === "WTA Tennis" || sport === "Tennis") {
    if (key === "gamesWon") return { min: 0, max: 30, step: 0.75 };
    if (key === "totalGames") return { min: 12, max: 65, step: 1 };
    if (key === "totalSets") return { min: 2, max: 5, step: 0.25 };
    if (key === "totalTieBreaks") return { min: 0, max: 4, step: 0.25 };
    if (key === "aces") return { min: 0, max: 40, step: 1 };
    return { min: 0, max: 90, step: 2 };
  }
  if (sport === "NHL") {
    if (key === "timeOnIce") return { min: 8, max: 30, step: 0.5 };
    if (key === "shots") return { min: 0, max: 12, step: 0.35 };
    if (key === "goals") return { min: 0, max: 4, step: 0.25 };
    return { min: 0, max: 10, step: 0.35 };
  }
  return { min: 0, max: Math.max(8, Number(propSafeLine(statType)) * 2 || 20), step: 0.5 };
}

function propSafeLine() {
  return 10;
}

function isSupportedMlbStat(statType = "") {
  const type = String(statType).toLowerCase();
  const key = canonicalStatType(statType);
  return (
    type.includes("pitches thrown") ||
    type.includes("pitch count") ||
    (type.includes("strikeout") && !type.includes("hitter") && !type.includes("batter")) ||
    isHitsRunsRbis(type) ||
    type.includes("total base") ||
    key === "singles" ||
    key === "doubles" ||
    key === "triples" ||
    key === "homeRuns" ||
    key === "stolenBases" ||
    key === "batterWalks" ||
    key === "hits" ||
    type === "hits" ||
    type === "rbis" ||
    type === "rbi" ||
    type === "runs" ||
    key === "outs" ||
    type.includes("pitching out") ||
    key === "hitsAllowed" ||
    (type.includes("hit") && type.includes("allow")) ||
    key === "earnedRuns" ||
    type.includes("earned run") ||
    key === "walks" ||
    (type.includes("walk") && type.includes("allow")) ||
    type.includes("fantasy")
  );
}

function isSupportedBasketballStat(statType = "") {
  const key = canonicalStatType(statType);
  return [
    "points",
    "rebounds",
    "assists",
    "pr",
    "pa",
    "pra",
    "threes",
    "fantasyScore",
    "doubleDouble",
    "pointsFirst3Min",
    "quarterPoints",
  ].includes(key);
}

function isSupportedTennisStat(statType = "") {
  const key = canonicalStatType(statType);
  return ["totalGames", "gamesWon", "aces", "doubleFaults", "fantasyScore", "points"].includes(key);
}

function isSupportedSoccerStat(statType = "") {
  return ["shots", "shotsOnTarget", "passesAttempted", "crosses", "goalieSaves", "goalsAllowed", "tackles", "fantasyScore"].includes(canonicalStatType(statType));
}

function pitchesThrown(stat = {}) {
  const direct = finiteNumber(
    stat.numberOfPitches ??
      stat.pitchesThrown ??
      stat.pitchCount ??
      stat.pitches ??
      stat.totalPitches
  );
  if (direct != null) return direct;

  const outs = outsRecorded(stat);
  if (outs == null) return null;

  const walks = finiteNumber(stat.baseOnBalls ?? stat.walks) || 0;
  const hits = finiteNumber(stat.hits) || 0;
  const strikeouts = finiteNumber(stat.strikeOuts ?? stat.strikeouts) || 0;
  return round(outs * 5.15 + walks * 4.4 + hits * 3.1 + strikeouts * 0.8);
}

function mlbFantasyScore(stat = {}) {
  const outs = outsRecorded(stat);
  const strikeouts = finiteNumber(stat.strikeOuts ?? stat.strikeouts);
  const earnedRuns = finiteNumber(stat.earnedRuns);

  if (outs != null && (strikeouts != null || earnedRuns != null)) {
    const hitsAllowed = finiteNumber(stat.hits) || 0;
    const walks = finiteNumber(stat.baseOnBalls ?? stat.walks) || 0;
    const runsAllowed = finiteNumber(stat.runs) || earnedRuns || 0;
    const winBonus = String(stat.decision || "").toUpperCase() === "W" ? 6 : 0;
    return round(outs + (strikeouts || 0) * 3 + winBonus - runsAllowed * 2 - hitsAllowed * 0.6 - walks * 0.6);
  }

  const hits = finiteNumber(stat.hits);
  const totalBases = finiteNumber(stat.totalBases);
  if (hits == null && totalBases == null) return null;

  const doubles = finiteNumber(stat.doubles) || 0;
  const triples = finiteNumber(stat.triples) || 0;
  const homeRuns = finiteNumber(stat.homeRuns) || 0;
  const singles = Math.max(0, (hits || 0) - doubles - triples - homeRuns);
  const rbis = finiteNumber(stat.rbi ?? stat.rbis) || 0;
  const runs = finiteNumber(stat.runs) || 0;
  const walks = finiteNumber(stat.baseOnBalls ?? stat.walks) || 0;
  const hitByPitch = finiteNumber(stat.hitByPitch) || 0;
  const stolenBases = finiteNumber(stat.stolenBases) || 0;
  return round(singles * 3 + doubles * 6 + triples * 8 + homeRuns * 10 + rbis * 2 + runs * 2 + walks * 2 + hitByPitch * 2 + stolenBases * 5);
}

function outsRecorded(stat = {}) {
  const outs = finiteNumber(stat.outs);
  if (outs != null) return outs;
  const innings = String(stat.inningsPitched || "");
  const [whole, partial = "0"] = innings.split(".");
  const wholeOuts = Number(whole) * 3;
  const partialOuts = Number(partial);
  if (Number.isFinite(wholeOuts) && Number.isFinite(partialOuts)) return wholeOuts + partialOuts;
  return null;
}

function isHitsRunsRbis(type) {
  const normalized = normalize(type);
  return normalized.includes("hitsrunsrbis") || normalized.includes("hrr");
}

function findEspnWnbaAthlete(payload, playerName) {
  const candidates = [];
  const pushCandidates = (items) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
      if (item?.type === "athlete" || item?.uid?.includes("athlete") || item?.contents) candidates.push(item);
      if (Array.isArray(item?.contents)) pushCandidates(item.contents);
      if (Array.isArray(item?.results)) pushCandidates(item.results);
    });
  };
  pushCandidates(payload?.results || payload?.sections || payload?.contents || []);
  return candidates
    .map((item) => item.athlete || item)
    .find((item) => item?.id && sameName(item.displayName || item.name || item.title, playerName));
}

function extractEspnBasketballGames(payload) {
  const games = [];
  const events = payload.events || {};
  const categories = payload.categories || [];
  const labels = categories.flatMap((category) => category.labels || []);
  const gameRows = payload.gamelog || payload.gameLog || [];

  if (Array.isArray(gameRows)) {
    gameRows.forEach((row) => {
      const stats = row.stats || row.statistics || [];
      games.push(espnStatsToGame(labels, stats, row));
    });
  }

  Object.values(events).forEach((event) => {
    const stats = event.stats || event.statistics || event.linescore || [];
    if (Array.isArray(stats) && stats.length) games.push(espnStatsToGame(labels, stats, event));
  });

  return games.filter((game) => Object.keys(game).length);
}

function espnStatsToGame(labels, values, row) {
  const game = { playedAt: new Date(row.date || row.gameDate || row.eventDate).getTime() };
  labels.forEach((label, index) => {
    const key = normalize(label);
    const value = finiteNumber(values[index]);
    if (!Number.isFinite(value)) return;
    if (key === "pts" || key === "points") game.pts = value;
    if (key === "reb" || key === "rebounds") game.reb = value;
    if (key === "ast" || key === "assists") game.ast = value;
    if (key === "stl" || key === "steals") game.stl = value;
    if (key === "blk" || key === "blocks") game.blk = value;
    if (key === "to" || key === "turnovers") game.turnover = value;
    if (key === "3pm" || key === "fg3m") game.fg3m = value;
  });
  return game;
}

function groupPropsBySport(props) {
  return props.reduce((groups, prop) => {
    const sport = sportGroup(resolvePropSport(prop) || prop.sport);
    groups[sport] = groups[sport] || [];
    groups[sport].push(prop);
    return groups;
  }, {});
}

function projectionEndpointForSport(sport = "") {
  if (sport === "MLB") return "/api/mlb (MLB StatsAPI)";
  if (sport === "NBA") return "balldontlie /api/nba";
  if (sport === "WNBA") return "balldontlie /api/wnba";
  if (sport === "Soccer") return "/api/api-football";
  if (sport === "Tennis") return "tennis stats provider";
  return `${sport || "unknown"} stats provider`;
}

function sportGroup(sport) {
  if (sport === "ATP Tennis" || sport === "WTA Tennis" || sport === "Tennis") return "Tennis";
  return sport || "Other";
}

function apiUrl(base, path) {
  if (typeof window !== "undefined" && base.startsWith("/")) return new URL(`${base}${path}`, window.location.origin);
  return new URL(path, base);
}

function playerFullName(player = {}) {
  return [player.first_name, player.last_name].filter(Boolean).join(" ").trim() || player.name || "";
}

function safeRate(total, appearances) {
  const value = finiteNumber(total);
  const games = finiteNumber(appearances);
  if (!Number.isFinite(value) || !Number.isFinite(games) || games <= 0) return null;
  return value / games;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumKnown(values) {
  const clean = values.map(finiteNumber).filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0);
}

function hitRateVsLine(values, line) {
  const clean = values.filter(Number.isFinite);
  const numberLine = Number(line);
  if (!clean.length || !Number.isFinite(numberLine)) return null;
  return clean.filter((value) => value > numberLine).length / clean.length;
}

function standardDeviation(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const avg = average(clean);
  return Math.sqrt(average(clean.map((value) => (value - avg) ** 2)));
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

/** Compute Last5 / Last10 / Season from game log splits for a prop market. */
export function computeMlbHistoricalAveragesFromSplits(splits = [], statType = "", line = null) {
  const filtered = filterMlbSplitsForStatType(splits, statType);
  const values = valuesFromMlbSplits(filtered, statType).filter(Number.isFinite);
  const last5 = values.slice(0, 5);
  const last10 = values.slice(0, 10);
  return {
    last5Average: average(last5),
    last10Average: average(last10),
    seasonAverage: average(values),
    last5HitRate: hitRateVsLine(last5, line),
    last10HitRate: hitRateVsLine(last10, line),
    gameLogCount: filtered.length,
    hasGameLogs: filtered.length >= 3,
    splits: filtered,
  };
}

function uniquePlayerNames(props) {
  return Array.from(new Set(props.map((prop) => prop.playerName).filter(Boolean)));
}

function sameName(a, b) {
  return playerNamesMatch(a, b) || normalize(a) === normalize(b);
}

function statLookupKey(prop) {
  return statProfileKey(prop);
}

function deterministicRatio(seed) {
  const text = String(seed || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function mergeStats(target, source) {
  if (!(source instanceof Map)) return;
  source.forEach((value, key) => target.set(key, value));
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number(value.toFixed(2));
}

export { scanLiveMlbProps, scanSingleMlbProp, fetchLiveProps } from "./livePropScanner.js";
export { getPlayerByName, getPlayerLogs, getPitcherStats, getOpponentStats, getProbablePitchers, getWeatherData } from "./mlbDataService.js";
export { matchSportsbookPlayerToMlb, normalizeSportsbookName } from "./playerMatcher.js";
