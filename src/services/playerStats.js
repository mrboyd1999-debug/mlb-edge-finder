import { cachedFetch } from "./fetchUtil.js";

const MLB_SEARCH_URL = "https://statsapi.mlb.com/api/v1/people/search";
const MLB_PLAYER_FETCH_LIMIT = 60;
const NBA_PLAYER_FETCH_LIMIT = 50;
const WNBA_PLAYER_FETCH_LIMIT = 50;
const SOCCER_PLAYER_FETCH_LIMIT = 40;
const BALLDONTLIE_API_KEY = import.meta.env.VITE_BALLDONTLIE_API_KEY || "";
const API_FOOTBALL_KEY = import.meta.env.VITE_API_FOOTBALL_KEY || "";
const BALLDONTLIE_BASE = "/api/balldontlie/v1";
const API_FOOTBALL_BASE = "/api/api-football";
const API_FOOTBALL_LEAGUE_IDS = [253, 39, 2, 140, 78, 61, 135];

export async function fetchPlayerStats({ props = [] } = {}) {
  if (!props.length) {
    return { source: "Player stats", stats: new Map(), warnings: [] };
  }

  const stats = new Map();
  const warnings = [];
  const grouped = groupPropsBySport(props);
  const jobs = [
    { sport: "MLB", run: () => fetchMlbStats(grouped.MLB || []) },
    { sport: "NBA", run: () => fetchNbaStats(grouped.NBA || []) },
    { sport: "WNBA", run: () => fetchWnbaStats(grouped.WNBA || []) },
    { sport: "Soccer", run: () => fetchSoccerStats(grouped.Soccer || []) },
    { sport: "Tennis", run: () => buildFallbackStatsForSport(grouped.Tennis || [], "Tennis fallback profile") },
  ];

  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  settled.forEach((result, index) => {
    const sport = jobs[index].sport;
    if (result.status === "fulfilled") {
      mergeStats(stats, result.value.stats);
      warnings.push(...(result.value.warnings || []));
      return;
    }

    const fallback = buildFallbackStatsForSport(grouped[sport] || [], `${sport} stats unavailable; using fallback profile`);
    mergeStats(stats, fallback.stats);
    warnings.push(`${sport} stat source failed; using fallback profiles.`);
  });

  const coveredKeys = new Set(stats.keys());
  const uncovered = props.filter((prop) => !coveredKeys.has(statLookupKey(prop)));
  const fallback = buildFallbackStatsForSport(uncovered, "generic fallback profile");
  mergeStats(stats, fallback.stats);

  return {
    source: "Player stats",
    stats,
    warnings: unique(warnings).filter(Boolean),
  };
}

async function fetchMlbStats(props) {
  const supportedProps = props.filter((prop) => isSupportedMlbStat(prop.statType));
  if (!supportedProps.length) return { stats: new Map(), warnings: [] };

  const players = uniquePlayerNames(supportedProps).slice(0, MLB_PLAYER_FETCH_LIMIT);
  const settled = await Promise.allSettled(players.map((playerName) => fetchMlbProfile(playerName)));
  const profiles = new Map();
  const stats = new Map();

  settled.forEach((result) => {
    if (result.status === "fulfilled" && result.value?.playerName) {
      profiles.set(normalize(result.value.playerName), result.value);
    }
  });

  supportedProps.forEach((prop) => {
    const profile = profiles.get(normalize(prop.playerName));
    const nextProfile = profile ? profileForMlbProp(profile, prop.statType, prop.line) : fallbackProfileForProp(prop, "MLB fallback profile");
    stats.set(statLookupKey(prop), nextProfile);
  });

  const failed = settled.some((result) => result.status === "rejected");
  return {
    stats,
    warnings: failed ? ["Some MLB player stats failed; fallback profiles filled gaps."] : [],
  };
}

async function fetchNbaStats(props) {
  const supportedProps = props.filter((prop) => isSupportedBasketballStat(prop.statType));
  if (!supportedProps.length) return { stats: new Map(), warnings: [] };

  const players = uniquePlayerNames(supportedProps).slice(0, NBA_PLAYER_FETCH_LIMIT);
  const settled = await Promise.allSettled(players.map((playerName) => fetchBallDontLieProfile(playerName)));
  return profilesToBasketballStats({ props: supportedProps, settled, sourceName: "BallDontLie NBA stats" });
}

async function fetchWnbaStats(props) {
  const supportedProps = props.filter((prop) => isSupportedBasketballStat(prop.statType));
  if (!supportedProps.length) return { stats: new Map(), warnings: [] };

  const players = uniquePlayerNames(supportedProps).slice(0, WNBA_PLAYER_FETCH_LIMIT);
  const settled = await Promise.allSettled(players.map((playerName) => fetchEspnWnbaProfile(playerName)));
  const result = profilesToBasketballStats({ props: supportedProps, settled, sourceName: "ESPN WNBA stats" });
  if (result.stats.size) return result;

  return buildFallbackStatsForSport(supportedProps, "WNBA fallback profile", [
    "WNBA stat source unavailable; fallback profiles are being used.",
  ]);
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
      profiles.set(normalize(result.value.playerName), result.value);
    }
  });

  supportedProps.forEach((prop) => {
    const profile = profiles.get(normalize(prop.playerName));
    const nextProfile = profile ? profileForSoccerProp(profile, prop.statType, prop.line) : fallbackProfileForProp(prop, "Soccer fallback profile");
    stats.set(statLookupKey(prop), nextProfile);
  });

  const failed = settled.some((result) => result.status === "rejected");
  return {
    stats,
    warnings: failed ? ["Some Soccer player stats failed; fallback profiles filled gaps."] : [],
  };
}

async function fetchMlbProfile(playerName) {
  const searchUrl = new URL(MLB_SEARCH_URL);
  searchUrl.searchParams.set("names", playerName);

  const searchResponse = await cachedFetch(searchUrl);
  if (!searchResponse.ok) throw new Error("Could not load MLB player stats.");

  const searchPayload = await searchResponse.json();
  const player = searchPayload.people?.[0];
  if (!player?.id) return null;

  const year = new Date().getFullYear();
  const statsUrl = new URL(`https://statsapi.mlb.com/api/v1/people/${player.id}/stats`);
  statsUrl.searchParams.set("stats", "gameLog");
  statsUrl.searchParams.set("group", "pitching,hitting");
  statsUrl.searchParams.set("season", String(year));

  const statsResponse = await cachedFetch(statsUrl);
  if (!statsResponse.ok) throw new Error("Could not load MLB player stats.");

  const statsPayload = await statsResponse.json();
  const splits = (statsPayload.stats || []).flatMap((bucket) => bucket.splits || []);
  const latest = splits
    .map((split) => ({ ...split, playedAt: new Date(split.date || split.game?.gameDate).getTime() }))
    .filter((split) => Number.isFinite(split.playedAt))
    .sort((a, b) => b.playedAt - a.playedAt);

  return {
    playerName: player.fullName || playerName,
    playerImage: player.id ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${player.id}/headshot/67/current` : "",
    splits: latest,
  };
}

async function fetchBallDontLieProfile(playerName) {
  const playerUrl = apiUrl(BALLDONTLIE_BASE, "/players");
  playerUrl.searchParams.set("search", playerName);

  const playerResponse = await cachedFetch(playerUrl, { headers: ballDontLieHeaders() });
  if (!playerResponse.ok) throw new Error("Could not load BallDontLie player search.");

  const playerPayload = await playerResponse.json();
  const player = (playerPayload.data || []).find((item) => sameName(playerFullName(item), playerName)) || playerPayload.data?.[0];
  if (!player?.id) return null;

  const currentSeason = new Date().getFullYear();
  const values = await fetchBallDontLieStatsForSeasons(player.id, [currentSeason, currentSeason - 1]);
  return {
    playerName: playerFullName(player) || playerName,
    playerImage: "",
    sport: "NBA",
    games: values,
  };
}

async function fetchBallDontLieStatsForSeasons(playerId, seasons) {
  for (const season of seasons) {
    const statsUrl = apiUrl(BALLDONTLIE_BASE, "/stats");
    statsUrl.searchParams.append("player_ids[]", String(playerId));
    statsUrl.searchParams.append("seasons[]", String(season));
    statsUrl.searchParams.set("per_page", "100");

    const response = await cachedFetch(statsUrl, { headers: ballDontLieHeaders() });
    if (!response.ok) throw new Error("Could not load BallDontLie game logs.");
    const payload = await response.json();
    const games = (payload.data || [])
      .map((item) => ({ ...item, playedAt: new Date(item.game?.date || item.date).getTime() }))
      .filter((item) => Number.isFinite(item.playedAt))
      .sort((a, b) => b.playedAt - a.playedAt);
    if (games.length) return games;
  }

  return [];
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
  const values = valuesFromMlbSplits(profile.splits || [], statType);
  if (!values.length) return fallbackProfileForProp({ playerName: profile.playerName, statType, line, sport: "MLB" }, "MLB fallback profile");
  return profileFromValues({
    playerName: profile.playerName,
    playerImage: profile.playerImage,
    values,
    line,
    source: "MLB StatsAPI game logs",
  });
}

function profilesToBasketballStats({ props, settled, sourceName }) {
  const profiles = new Map();
  const stats = new Map();

  settled.forEach((result) => {
    if (result.status === "fulfilled" && result.value?.playerName) {
      profiles.set(normalize(result.value.playerName), result.value);
    }
  });

  props.forEach((prop) => {
    const profile = profiles.get(normalize(prop.playerName));
    const nextProfile = profile ? profileForBasketballProp(profile, prop.statType, prop.line, sourceName) : fallbackProfileForProp(prop, `${prop.sport} fallback profile`);
    stats.set(statLookupKey(prop), nextProfile);
  });

  const failed = settled.some((result) => result.status === "rejected");
  return {
    stats,
    warnings: failed ? [`Some ${sourceName} requests failed; fallback profiles filled gaps.`] : [],
  };
}

function profileForBasketballProp(profile, statType, line, source) {
  const values = (profile.games || []).map((game) => basketballPrimaryStat(game, statType)).filter(Number.isFinite);
  if (!values.length) return fallbackProfileForProp({ playerName: profile.playerName, statType, line, sport: profile.sport }, `${profile.sport} fallback profile`);
  return profileFromValues({
    playerName: profile.playerName,
    playerImage: profile.playerImage,
    values,
    line,
    source,
    projectedMinutes: projectedMinutes(profile.games),
  });
}

function profileForSoccerProp(profile, statType, line) {
  const averageValue = soccerAverageFromApiFootball(profile.statistics || [], statType);
  if (!Number.isFinite(averageValue)) return fallbackProfileForProp({ playerName: profile.playerName, statType, line, sport: "Soccer" }, "Soccer fallback profile");
  const sampleSize = soccerAppearanceCount(profile.statistics || []);
  const values = syntheticValuesFromAverage(averageValue, Math.min(10, Math.max(5, sampleSize)), statVolatility("Soccer", statType, averageValue), profile.playerName + statType);
  return profileFromValues({
    playerName: profile.playerName,
    playerImage: profile.playerImage,
    values,
    line,
    source: "API-Football season rates",
  });
}

function profileFromValues({ playerName, playerImage = "", values = [], line, source, projectedMinutes = null, fallback = false }) {
  const cleanValues = values.filter(Number.isFinite);
  const last5 = cleanValues.slice(0, 5);
  const last10 = cleanValues.slice(0, 10);
  const projection = weightedProjection(last5, last10, cleanValues);
  return {
    playerName,
    playerImage,
    headshot: playerImage,
    imageUrl: playerImage,
    projection,
    projectionSource: fallback ? "fallback-player-stats" : "player-stats",
    source,
    fallback,
    recentHitRate: hitRateVsLine(last10, line),
    last5Average: average(last5),
    last10Average: average(last10),
    seasonAverage: average(cleanValues),
    last5HitRate: hitRateVsLine(last5, line),
    last10HitRate: hitRateVsLine(last10, line),
    volatility: standardDeviation(last10),
    sampleSize: last10.length,
    projectedMinutes,
  };
}

function buildFallbackStatsForSport(props, source = "fallback profile", warnings = []) {
  const stats = new Map();
  props.forEach((prop) => {
    if (!prop?.playerName || !prop?.statType) return;
    stats.set(statLookupKey(prop), fallbackProfileForProp(prop, source));
  });
  return { stats, warnings };
}

function fallbackProfileForProp(prop, source = "fallback profile") {
  const range = projectionRange(prop.sport, prop.statType);
  const line = Number(prop.line);
  const seed = `${prop.sport}|${prop.playerName}|${prop.statType}|${prop.line}`;
  const base = Number.isFinite(line)
    ? clamp(line, range.min, range.max)
    : range.min + (range.max - range.min) * deterministicRatio(seed);
  const direction = deterministicRatio(seed + "|direction") >= 0.5 ? 1 : -1;
  const maxEdge = Math.max(range.step, Math.min((range.max - range.min) * 0.055, Math.max(0.4, Math.abs(base) * 0.08)));
  let projection = clamp(base + direction * maxEdge * (0.65 + deterministicRatio(seed + "|edge") * 0.7), range.min, range.max);
  if (Number.isFinite(line) && Math.abs(projection - line) < range.step) {
    projection = clamp(line + direction * range.step, range.min, range.max);
  }
  const values = syntheticValuesFromAverage(projection, 10, statVolatility(prop.sport, prop.statType, projection), seed);
  return profileFromValues({
    playerName: prop.playerName,
    playerImage: prop.playerImage || prop.headshot || prop.imageUrl || "",
    values,
    line: prop.line,
    source,
    fallback: true,
  });
}

function valuesFromMlbSplits(splits, statType) {
  return splits.map((split) => mlbPrimaryStat(split.stat, statType)).filter(Number.isFinite);
}

function mlbPrimaryStat(stat = {}, statType = "") {
  const type = String(statType).toLowerCase();
  if ((type.includes("hitter") || type.includes("batter")) && type.includes("strikeout")) return null;
  if (type.includes("pitches thrown") || type.includes("pitch count")) return pitchesThrown(stat);
  if (type.includes("fantasy")) return mlbFantasyScore(stat);
  if (isHitsRunsRbis(type)) return sumKnown([stat.hits, stat.runs, stat.rbi ?? stat.rbis]);
  if (type.includes("total base")) return finiteNumber(stat.totalBases);
  if (type.includes("rbi")) return finiteNumber(stat.rbi ?? stat.rbis);
  if (type.includes("run")) return finiteNumber(stat.runs);
  if (type.includes("hit")) return finiteNumber(stat.hits);
  if (type.includes("out")) return outsRecorded(stat);
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
  if (sport === "MLB") return 0.9;
  if (sport === "NBA" || sport === "WNBA") {
    if (key === "points") return 5;
    if (key === "rebounds") return 3;
    if (key === "assists") return 2.5;
    if (key === "pra") return 7;
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
  if (sport === "MLB" && key === "hitsRunsRbis") return { min: 0, max: 8, step: 0.35 };
  if (sport === "MLB" && key === "totalBases") return { min: 0, max: 8, step: 0.35 };
  if (sport === "MLB" && ["hits", "rbis", "runs"].includes(key)) return { min: 0, max: 6, step: 0.25 };
  if ((sport === "NBA" || sport === "WNBA") && key === "points") return { min: 0, max: 60, step: 1.2 };
  if ((sport === "NBA" || sport === "WNBA") && key === "rebounds") return { min: 0, max: 25, step: 0.8 };
  if ((sport === "NBA" || sport === "WNBA") && key === "assists") return { min: 0, max: 20, step: 0.7 };
  if ((sport === "NBA" || sport === "WNBA") && key === "pra") return { min: 0, max: 100, step: 1.8 };
  if ((sport === "NBA" || sport === "WNBA") && key === "threes") return { min: 0, max: 12, step: 0.45 };
  if (sport === "Soccer" && key === "passesAttempted") return { min: 0, max: 140, step: 4 };
  if (sport === "Soccer" && key === "goalieSaves") return { min: 0, max: 15, step: 0.5 };
  if (sport === "Soccer" && key === "goalsAllowed") return { min: 0, max: 8, step: 0.4 };
  if (sport === "Soccer") return { min: 0, max: 10, step: 0.35 };
  if (sport === "ATP Tennis" || sport === "WTA Tennis" || sport === "Tennis") {
    if (key === "gamesWon") return { min: 0, max: 30, step: 0.75 };
    if (key === "totalGames") return { min: 12, max: 65, step: 1 };
    if (key === "aces") return { min: 0, max: 40, step: 1 };
    return { min: 0, max: 90, step: 2 };
  }
  return { min: 0, max: Math.max(8, Number(propSafeLine(statType)) * 2 || 20), step: 0.5 };
}

function propSafeLine() {
  return 10;
}

function isSupportedMlbStat(statType = "") {
  const type = String(statType).toLowerCase();
  return (
    type.includes("pitches thrown") ||
    type.includes("pitch count") ||
    (type.includes("strikeout") && !type.includes("hitter") && !type.includes("batter")) ||
    isHitsRunsRbis(type) ||
    type.includes("total base") ||
    type === "hits" ||
    type === "rbis" ||
    type === "rbi" ||
    type === "runs" ||
    type.includes("fantasy")
  );
}

function isSupportedBasketballStat(statType = "") {
  return ["points", "rebounds", "assists", "pra", "threes", "fantasyScore"].includes(canonicalStatType(statType));
}

function isSupportedSoccerStat(statType = "") {
  return ["shots", "shotsOnTarget", "passesAttempted", "goalieSaves", "goalsAllowed", "tackles", "fantasyScore"].includes(canonicalStatType(statType));
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
    const sport = sportGroup(prop.sport);
    groups[sport] = groups[sport] || [];
    groups[sport].push(prop);
    return groups;
  }, {});
}

function sportGroup(sport) {
  if (sport === "ATP Tennis" || sport === "WTA Tennis" || sport === "Tennis") return "Tennis";
  return sport || "Other";
}

function apiUrl(base, path) {
  if (typeof window !== "undefined" && base.startsWith("/")) return new URL(`${base}${path}`, window.location.origin);
  return new URL(path, base);
}

function ballDontLieHeaders() {
  return {
    accept: "application/json",
    Authorization: BALLDONTLIE_API_KEY,
  };
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

function uniquePlayerNames(props) {
  return Array.from(new Set(props.map((prop) => prop.playerName).filter(Boolean)));
}

function sameName(a, b) {
  return normalize(a) === normalize(b);
}

function statLookupKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.startTime]
    .map(normalize)
    .join("|");
}

function canonicalStatType(statType) {
  const key = normalize(statType);
  if (key.includes("pitchesthrown") || key.includes("pitchcount")) return "pitchesThrown";
  if (key.includes("strikeout")) return "strikeouts";
  if (key.includes("hitsrunsrbis") || key.includes("hrr")) return "hitsRunsRbis";
  if (key.includes("totalbases")) return "totalBases";
  if (key === "hits") return "hits";
  if (key === "rbis" || key === "rbi") return "rbis";
  if (key === "runs") return "runs";
  if (key.includes("pointsreboundsassists") || key === "pra") return "pra";
  if (key === "points") return "points";
  if (key === "rebounds") return "rebounds";
  if (key === "assists") return "assists";
  if (key.includes("3pointers") || key.includes("threepointers")) return "threes";
  if (key.includes("gameswon") || key.includes("playergames")) return "gamesWon";
  if (key.includes("totalgames")) return "totalGames";
  if (key.includes("aces")) return "aces";
  if (key.includes("doublefault")) return "doubleFaults";
  if (key.includes("shotsontarget")) return "shotsOnTarget";
  if (key === "shots" || key.includes("shotsattempted")) return "shots";
  if (key.includes("passesattempted") || key === "passes") return "passesAttempted";
  if (key.includes("goalsallowed")) return "goalsAllowed";
  if (key.includes("goaliesaves") || key.includes("keepersaves") || key === "saves") return "goalieSaves";
  if (key.includes("tackles")) return "tackles";
  if (key.includes("fantasyscore")) return "fantasyScore";
  return key;
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
