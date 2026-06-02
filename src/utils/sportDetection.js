/**
 * Dynamic sport/league detection for normalized props.
 * Priority: explicit source → stat lock → league metadata → team names → player hints → inference.
 * Never defaults to MLB.
 */

import { normalizeSportLabel, sportFromPrizePicksLeague, sportFromUnderdogGame } from "./sportMappings.js";
import { classifyPropSport } from "./marketClassification.js";
import { lockSportFromStatType } from "./propStatSportLock.js";
import { inferSportFromProp, attachSportInference } from "./underdogSportDetection.js";
import { normalizePlayerName } from "./playerNames.js";

const NBA_TEAM_NAMES = [
  "hawks",
  "celtics",
  "nets",
  "hornets",
  "bulls",
  "cavaliers",
  "mavericks",
  "nuggets",
  "pistons",
  "warriors",
  "rockets",
  "pacers",
  "clippers",
  "lakers",
  "grizzlies",
  "heat",
  "bucks",
  "timberwolves",
  "pelicans",
  "knicks",
  "thunder",
  "magic",
  "76ers",
  "sixers",
  "suns",
  "blazers",
  "trail blazers",
  "kings",
  "spurs",
  "raptors",
  "jazz",
  "wizards",
];

const MLB_TEAM_NAMES = [
  "diamondbacks",
  "braves",
  "orioles",
  "red sox",
  "cubs",
  "white sox",
  "reds",
  "guardians",
  "indians",
  "rockies",
  "tigers",
  "astros",
  "royals",
  "angels",
  "dodgers",
  "marlins",
  "brewers",
  "twins",
  "mets",
  "yankees",
  "athletics",
  "a's",
  "phillies",
  "pirates",
  "padres",
  "giants",
  "mariners",
  "cardinals",
  "rays",
  "rangers",
  "blue jays",
  "nationals",
];

const NFL_TEAM_NAMES = [
  "cardinals",
  "falcons",
  "ravens",
  "bills",
  "panthers",
  "bears",
  "bengals",
  "browns",
  "cowboys",
  "broncos",
  "lions",
  "packers",
  "texans",
  "colts",
  "jaguars",
  "chiefs",
  "raiders",
  "chargers",
  "rams",
  "dolphins",
  "vikings",
  "patriots",
  "saints",
  "giants",
  "jets",
  "eagles",
  "steelers",
  "49ers",
  "niners",
  "seahawks",
  "buccaneers",
  "bucs",
  "titans",
  "commanders",
];

const KNOWN_PLAYER_SPORTS = new Map([
  [normalizePlayerName("Victor Wembanyama"), "NBA"],
  [normalizePlayerName("Aaron Judge"), "MLB"],
  [normalizePlayerName("Patrick Mahomes"), "NFL"],
  [normalizePlayerName("LeBron James"), "NBA"],
  [normalizePlayerName("Shohei Ohtani"), "MLB"],
  [normalizePlayerName("Mookie Betts"), "MLB"],
]);

function textBlob(prop = {}) {
  return [prop.team, prop.opponent, prop.matchup, prop.description].filter(Boolean).join(" ").toLowerCase();
}

function sportFromExplicitSource(prop = {}) {
  const raw = prop.raw || {};
  const attrs = raw.attributes || raw.over_under || raw;

  if (prop.classifiedSport) return { sport: prop.classifiedSport, reason: "classifiedSport" };
  if (prop.inferredSport) return { sport: prop.inferredSport, reason: "inferredSport" };

  const leagueId =
    prop.leagueId ||
    raw.league_id ||
    raw.leagueId ||
    attrs.league_id ||
    raw.relationships?.league?.data?.id ||
    "";
  if (leagueId) {
    const fromLeague = sportFromPrizePicksLeague(prop.leagueRecord || {}, leagueId);
    if (fromLeague) return { sport: fromLeague, reason: "prizepicks league id" };
  }

  const explicitSport = normalizeSportLabel(
    prop.sport || attrs.sport || raw.sport || "",
    prop.league || attrs.league || raw.league || prop.leagueName || ""
  );
  if (explicitSport && explicitSport !== "Unsupported") {
    return { sport: explicitSport, reason: "explicit sport/league field" };
  }

  const lookup = prop._lookup || {};
  if (lookup.games?.size) {
    const fromGame = sportFromUnderdogGame(
      lookup.games?.values()?.next()?.value || {},
      attrs
    );
    if (fromGame) return { sport: fromGame, reason: "underdog game metadata" };
  }

  return null;
}

function sportFromTeamNames(prop = {}) {
  const blob = textBlob(prop);
  if (!blob) return null;

  const nbaHits = NBA_TEAM_NAMES.filter((name) => blob.includes(name)).length;
  const mlbHits = MLB_TEAM_NAMES.filter((name) => blob.includes(name)).length;
  const nflHits = NFL_TEAM_NAMES.filter((name) => blob.includes(name)).length;

  if (nbaHits > 0 && nbaHits >= mlbHits && nbaHits >= nflHits) {
    return { sport: /wnba/i.test(blob) ? "WNBA" : "NBA", reason: "team name match" };
  }
  if (mlbHits > 0 && mlbHits > nbaHits && mlbHits >= nflHits) {
    return { sport: "MLB", reason: "team name match" };
  }
  if (nflHits > 0 && nflHits > nbaHits && nflHits > mlbHits) {
    return { sport: "NFL", reason: "team name match" };
  }
  return null;
}

function sportFromPlayerHint(prop = {}) {
  const player = normalizePlayerName(prop.playerName || prop.player || "");
  if (!player) return null;
  const sport = KNOWN_PLAYER_SPORTS.get(player);
  if (!sport) return null;
  return { sport, reason: "known player sport" };
}

/**
 * @returns {{ sport: string, league: string, reason: string, source: string }}
 */
export function detectPropSport(prop = {}, options = {}) {
  const statType = prop.statType || prop.market || prop.propType || "";

  const statLock = lockSportFromStatType(statType);
  if (statLock) {
    return { sport: statLock, league: statLock, reason: `${statLock.toLowerCase()}-only stat lock`, source: "statLock" };
  }

  const explicit = sportFromExplicitSource(prop);
  if (explicit?.sport) {
    return { sport: explicit.sport, league: explicit.sport, reason: explicit.reason, source: "explicit" };
  }

  const fromTeams = sportFromTeamNames(prop);
  if (fromTeams?.sport) {
    return { sport: fromTeams.sport, league: fromTeams.sport, reason: fromTeams.reason, source: "teamNames" };
  }

  const fromPlayer = sportFromPlayerHint(prop);
  if (fromPlayer?.sport) {
    return { sport: fromPlayer.sport, league: fromPlayer.sport, reason: fromPlayer.reason, source: "playerHint" };
  }

  const inferred = inferSportFromProp(prop, {
    selectedSport: options.selectedSport || prop.selectedSportTab || prop.selectedSport || "",
  });
  if (inferred?.sport) {
    return { sport: inferred.sport, league: inferred.sport, reason: inferred.reason || "prop inference", source: "inference" };
  }

  const classified = classifyPropSport(prop);
  if (classified && classified !== "Unsupported" && classified !== "Other") {
    return { sport: classified, league: classified, reason: "market classification", source: "classification" };
  }

  const residual = normalizeSportLabel(prop.sport || "", prop.league || "");
  if (residual && residual !== "Unsupported") {
    return { sport: residual, league: prop.league || residual, reason: "residual sport field", source: "residual" };
  }

  return { sport: "", league: "", reason: "unknown", source: "none" };
}

export function applyDetectedSport(prop = {}, options = {}) {
  const detected = detectPropSport(prop, options);
  if (!detected.sport) return prop;
  return {
    ...prop,
    sport: detected.sport,
    league: detected.league || detected.sport,
    classifiedSport: detected.sport,
    sportDetectionReason: detected.reason,
    sportDetectionSource: detected.source,
  };
}

export function attachDetectedSport(prop = {}, options = {}) {
  const withInference = attachSportInference(prop, options);
  return applyDetectedSport(withInference.sport ? withInference : prop, options);
}

export function emitSportDetectionDebug(prop = {}, detected = null) {
  const result = detected || detectPropSport(prop);
  console.error("########## SPORT DETECTION DEBUG START ##########");
  console.error("PLAYER:", prop.playerName || prop.player || "—");
  console.error("STAT:", prop.statType || prop.market || "—");
  console.error("DETECTED SPORT:", result.sport || "—");
  console.error("DETECTED LEAGUE:", result.league || prop.league || "—");
  console.error("DETECTION SOURCE:", result.source || "—");
  console.error("DETECTION REASON:", result.reason || "—");
  console.error("RAW SPORT:", prop.sport || "—");
  console.error("RAW LEAGUE:", prop.league || "—");
  console.error("########## SPORT DETECTION DEBUG END ##########");
  return result;
}
