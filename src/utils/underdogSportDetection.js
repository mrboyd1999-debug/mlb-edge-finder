/**
 * Underdog-specific sport detection — never defaults to MLB.
 */

import {
  inferSportFromText,
  normalizeSportLabel,
  sportFromUnderdogGame,
  UNDERDOG_SPORT_SLUGS,
} from "./sportMappings.js";

const NBA_TEAM_ABBRS = new Set([
  "ATL", "BKN", "BOS", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL",
  "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
]);

const MLB_TEAM_ABBRS = new Set([
  "ARI", "ATL", "BAL", "BOS", "CHC", "CIN", "CLE", "COL", "CWS", "DET", "HOU", "KC", "LAA", "LAD", "MIA", "MIL",
  "MIN", "NYM", "NYY", "OAK", "PHI", "PIT", "SD", "SEA", "SF", "STL", "TB", "TEX", "TOR", "WSH",
]);

const NBA_PLAYER_HINTS =
  /\b(wembanyama|gilgeous-alexander|doncic|antetokounmpo|tatum|curry|lebron|jokic|embiid|luka|durant|booker|edwards|brunson|haliburton|maxey|morant|fox|adebayo|banchero|holmgren|siakam|randle|brunson|kyrie|harden|kawhi|paul george|zion|lamelo|trae young|de'aaron fox)\b/i;

const BASKETBALL_STAT = /\b(points?|pts|rebounds?|rebs?|assists?|asts?|pra|3s|threes?|3pm|steals?|blocks?|double double|triple double|fantasy score)\b/i;
const BASEBALL_STAT = /\b(hits?|runs?|rbis?|strikeouts?|pitcher|total bases|walks?|home runs?|hrs?|innings?|earned runs?)\b/i;

function attrsOf(raw = {}) {
  return raw.attributes || raw.over_under || raw.overUnder || raw;
}

function tokenizeAbbrs(text = "") {
  return String(text || "")
    .toUpperCase()
    .match(/\b[A-Z]{2,4}\b/g) || [];
}

function slugSport(value = "") {
  const compact = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return UNDERDOG_SPORT_SLUGS[compact] || "";
}

function canonicalizeSport(value = "", league = "") {
  const normalized = normalizeSportLabel(value, league);
  if (normalized) return normalized;
  const inferred = inferSportFromText(`${value} ${league}`.trim());
  return inferred || "";
}

function sportFromTeams(team = "", opponent = "", matchup = "") {
  const tokens = [...tokenizeAbbrs(team), ...tokenizeAbbrs(opponent), ...tokenizeAbbrs(matchup)];
  let nbaHits = 0;
  let mlbHits = 0;
  for (const token of tokens) {
    if (NBA_TEAM_ABBRS.has(token)) nbaHits += 1;
    if (MLB_TEAM_ABBRS.has(token) && !NBA_TEAM_ABBRS.has(token)) mlbHits += 1;
  }
  if (nbaHits > mlbHits && nbaHits > 0) return "NBA";
  if (mlbHits > nbaHits && mlbHits > 0) return "MLB";
  if (nbaHits > 0 && mlbHits === 0) return "NBA";
  if (mlbHits > 0 && nbaHits === 0) return "MLB";
  return "";
}

function sportFromStatType(statType = "") {
  const stat = String(statType || "");
  if (BASKETBALL_STAT.test(stat) && !BASEBALL_STAT.test(stat)) return "NBA";
  if (BASEBALL_STAT.test(stat) && !BASKETBALL_STAT.test(stat)) return "MLB";
  return "";
}

function collectSportText(raw = {}, lookup = {}, context = {}) {
  const attrs = attrsOf(raw);
  const { games, appearances } = lookup;
  let game = {};
  if (games?.size && appearances?.size) {
    const appearanceId = attrs.appearance_id || raw.appearance_id;
    const appearance = appearances.get(String(appearanceId)) || {};
    game = games.get(String(appearance.game_id || appearance.match_id || attrs.game_id)) || {};
  }

  const pieces = [
    raw.sport,
    raw.league,
    raw.sport_name,
    raw.event_title,
    raw.game,
    raw.matchup,
    raw.teams,
    attrs.sport,
    attrs.league,
    attrs.sport_name,
    attrs.sport_id,
    attrs.event_title,
    attrs.title,
    raw.title,
    raw.description,
    game.sport,
    game.sport_id,
    game.league,
    game.title,
    game.short_title,
    game.competition_name,
    context.team,
    context.opponent,
    context.matchup,
    context.player,
    context.statType,
  ];

  try {
    pieces.push(JSON.stringify(raw));
  } catch {
    // ignore
  }

  return pieces.filter(Boolean).join(" ");
}

/**
 * Detect canonical sport for a raw Underdog record. Returns "" when unknown — never MLB by default.
 */
export function detectUnderdogSport(raw = {}, lookup = {}, context = {}) {
  const attrs = attrsOf(raw);
  const directCandidates = [
    raw.sport,
    raw.league,
    raw.sport_name,
    attrs.sport,
    attrs.league,
    attrs.sport_name,
    attrs.sport_id,
  ];

  for (const candidate of directCandidates) {
    const slug = slugSport(candidate);
    if (slug) return slug;
    const canon = canonicalizeSport(candidate);
    if (canon) return canon;
  }

  const { games, appearances } = lookup;
  if (games?.size && appearances?.size) {
    const appearanceId = attrs.appearance_id || raw.appearance_id;
    const appearance = appearances.get(String(appearanceId)) || {};
    const game = games.get(String(appearance.game_id || appearance.match_id || attrs.game_id)) || {};
    const fromGame = sportFromUnderdogGame(game, attrs);
    if (fromGame) return canonicalizeSport(fromGame) || fromGame;
  }

  const blob = collectSportText(raw, lookup, context);
  const fromBlob = inferSportFromText(blob, context);
  if (fromBlob) return fromBlob;

  const fromTeams = sportFromTeams(context.team, context.opponent, context.matchup);
  if (fromTeams) return fromTeams;

  if (NBA_PLAYER_HINTS.test(String(context.player || ""))) return "NBA";

  const fromStat = sportFromStatType(context.statType);
  if (fromStat) return fromStat;

  return "";
}

export function resolvePropSportLabel(prop = {}) {
  return canonicalizeSport(prop.sport || prop.league || prop.classifiedSport || "") || String(prop.sport || "").trim();
}

export function isUnderdogSport(prop = {}, sport = "MLB") {
  if (prop.normalizedSource !== "underdog") return false;
  const want = canonicalizeSport(sport) || sport;
  const got = resolvePropSportLabel(prop);
  return Boolean(want && got && want === got);
}

export function filterUnderdogPropsBySport(props = [], sport = "MLB") {
  const want = canonicalizeSport(sport) || sport;
  return (props || []).filter((prop) => prop.normalizedSource === "underdog" && resolvePropSportLabel(prop) === want);
}

export function countUnderdogPropsBySport(props = []) {
  const ud = (props || []).filter((p) => p.normalizedSource === "underdog");
  const count = (sport) => {
    if (sport === "Tennis") {
      return ud.filter((p) => /tennis/i.test(resolvePropSportLabel(p))).length;
    }
    return filterUnderdogPropsBySport(ud, sport).length;
  };
  return {
    MLB: count("MLB"),
    NBA: count("NBA"),
    WNBA: count("WNBA"),
    NHL: count("NHL"),
    Soccer: count("Soccer"),
    Tennis: count("Tennis"),
  };
}
