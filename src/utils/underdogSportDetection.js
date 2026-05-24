/**
 * Underdog sport detection — ignores feed-type tokens (player_prop, core, etc.).
 * NBA signals win over MLB when both could apply (e.g. Fantasy Score).
 */

import {
  inferSportFromText,
  normalizeSportLabel,
  sportFromUnderdogGame,
  UNDERDOG_SPORT_SLUGS,
} from "./sportMappings.js";
import { compactMarketKey } from "./marketNormalization.js";

export const INVALID_SPORT_TOKENS = new Set([
  "playerprop",
  "player_prop",
  "core",
  "boost",
  "special",
  "prop",
  "unknown",
]);

const MLB_TEAM_ABBRS = new Set([
  "LAD", "MIL", "STL", "CIN", "SEA", "KC", "AZ", "ARI", "COL", "ATL", "WSH", "TOR", "PIT", "BAL", "DET", "CLE", "PHI",
  "NYY", "NYM", "BOS", "CHC", "CWS", "HOU", "LAA", "MIA", "MIN", "OAK", "SD", "SF", "TB", "TEX", "ATH",
]);

const NBA_ONLY_TEAM_ABBRS = new Set([
  "BKN", "CHA", "DAL", "DEN", "GSW", "IND", "LAC", "LAL", "MEM", "NOP", "NYK", "OKC", "ORL", "PHX", "POR", "SAC", "SAS", "UTA", "WAS",
]);

const MLB_PLAYER_HINTS =
  /\b(ohtani|burleson|rodriguez|marte|acuña|acuna|naylor|herrera|varsho|abrams|judge|trout|betts|freeman|tatis|soto|harper|altuve|devers|bichette|guerrero|correa|semien|seager|alvarez|witt|julio|perdomo)\b/i;

const NBA_PLAYER_HINTS =
  /\b(wembanyama|gilgeous-alexander|shai|doncic|antetokounmpo|tatum|curry|lebron|jokic|embiid|luka|durant|booker|edwards|brunson|haliburton|maxey|morant|adebayo|banchero|holmgren|siakam|randle|kyrie|harden|kawhi|zion|lamelo|trae young)\b/i;

const MLB_MARKET_PATTERN =
  /hits?\s*(\+|and)?\s*runs?\s*(\+|and)?\s*rbis?|hits?\s*\+\s*runs?|total\s*bases?|home\s*runs?|pitcher\s*strikeouts?|earned\s*runs?|walks?\s*allowed|\brbis?\b|\bdoubles?\b|\bsingles?\b/i;

const BASKETBALL_MARKET_PATTERN =
  /\b(points?|rebounds?|assists?|pra|3pm|threes?|steals?|blocks?|double double|triple double|fantasy(?:\s+score|\s+points)?)\b/i;

export const MLB_SPORT_MISMAP_MESSAGE =
  "Parsed Underdog props exist, but none mapped to MLB. Check sport mapper.";

function attrsOf(raw = {}) {
  return raw.attributes || raw.over_under || raw.overUnder || raw;
}

function sportToken(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isInvalidSportToken(value = "") {
  const token = sportToken(value);
  return !token || INVALID_SPORT_TOKENS.has(token);
}

function slugSport(value = "") {
  if (isInvalidSportToken(value)) return "";
  const compact = sportToken(value);
  return UNDERDOG_SPORT_SLUGS[compact] || "";
}

function canonicalizeSport(value = "", league = "") {
  if (isInvalidSportToken(value) && isInvalidSportToken(league)) return "";
  const normalized = normalizeSportLabel(isInvalidSportToken(value) ? league : value, league);
  if (normalized && !isInvalidSportToken(normalized)) return normalized;
  const inferred = inferSportFromText(`${value} ${league}`.trim());
  return inferred && !isInvalidSportToken(inferred) ? inferred : "";
}

function tokenizeAbbrs(text = "") {
  return String(text || "")
    .toUpperCase()
    .match(/\b[A-Z]{2,4}\b/g) || [];
}

function contextBlob(context = {}) {
  return [
    context.statType,
    context.player,
    context.team,
    context.opponent,
    context.matchup,
    context.eventTitle,
  ]
    .filter(Boolean)
    .join(" ");
}

export function hasMlbMarketSignal(...parts) {
  const blob = parts.filter(Boolean).join(" ");
  if (!blob) return false;
  if (BASKETBALL_MARKET_PATTERN.test(blob) && !MLB_MARKET_PATTERN.test(blob)) return false;
  if (MLB_MARKET_PATTERN.test(blob)) return true;
  const compact = compactMarketKey(blob);
  return (
    compact.includes("hitsrunsrbis") ||
    compact.includes("hitsrunsandrbis") ||
    compact.includes("totalbases") ||
    compact.includes("homerun") ||
    compact.includes("strikeout") ||
    compact.includes("earnedrun") ||
    compact.includes("walksallowed")
  );
}

export function hasBasketballMarketSignal(...parts) {
  const blob = parts.filter(Boolean).join(" ");
  return Boolean(blob && BASKETBALL_MARKET_PATTERN.test(blob));
}

function sportFromMlbTeams(team = "", opponent = "", matchup = "") {
  const tokens = [...tokenizeAbbrs(team), ...tokenizeAbbrs(opponent), ...tokenizeAbbrs(matchup)];
  if (!tokens.length) return "";
  const mlbHits = tokens.filter((t) => MLB_TEAM_ABBRS.has(t)).length;
  const nbaOnlyHits = tokens.filter((t) => NBA_ONLY_TEAM_ABBRS.has(t)).length;
  if (nbaOnlyHits > 0 && mlbHits === 0) return "NBA";
  if (mlbHits > 0 && nbaOnlyHits === 0) return "MLB";
  if (mlbHits > nbaOnlyHits) return "MLB";
  if (nbaOnlyHits > mlbHits) return "NBA";
  return "";
}

function sportFromEventCategory(raw = {}, lookup = {}) {
  const attrs = attrsOf(raw);
  const { games, appearances } = lookup;
  let game = {};
  if (games?.size && appearances?.size) {
    const appearanceId = attrs.appearance_id || raw.appearance_id;
    const appearance = appearances.get(String(appearanceId)) || {};
    game = games.get(String(appearance.game_id || appearance.match_id || attrs.game_id)) || {};
  }

  const options = raw.options || raw.choices || attrs.options || attrs.choices || [];
  const optionHeaders = Array.isArray(options)
    ? options.map((o) => o.selection_header || o.header || "").filter(Boolean)
    : [];

  const categoryFields = [
    raw.event_title,
    raw.category,
    raw.tab,
    raw.sport_tab,
    attrs.event_title,
    attrs.category,
    attrs.selection_header,
    attrs.group_name,
    attrs.competition_name,
    attrs.sport_name,
    isInvalidSportToken(attrs.league) ? "" : attrs.league,
    isInvalidSportToken(attrs.sport) ? "" : attrs.sport,
    isInvalidSportToken(attrs.sport_id) ? "" : attrs.sport_id,
    game.competition_name,
    isInvalidSportToken(game.league) ? "" : game.league,
    isInvalidSportToken(game.sport) ? "" : game.sport,
    isInvalidSportToken(game.sport_id) ? "" : game.sport_id,
    ...optionHeaders,
  ];

  for (const field of categoryFields) {
    if (!field || isInvalidSportToken(field)) continue;
    const slug = slugSport(field);
    if (slug) return slug;
    const canon = canonicalizeSport(field);
    if (canon && canon !== "Unsupported") return canon;
  }

  if (game && Object.keys(game).length) {
    const fromGame = sportFromUnderdogGame(game, attrs);
    if (fromGame && !isInvalidSportToken(fromGame)) return canonicalizeSport(fromGame) || fromGame;
  }

  return "";
}

export function isNbaUnderdogProp(prop = {}) {
  const player = String(prop.player || prop.playerName || "");
  const statType = prop.statType || prop.market || prop.propType || "";
  const blob = contextBlob({
    statType,
    player,
    team: prop.team,
    opponent: prop.opponent,
    matchup: prop.matchup,
  });

  if (NBA_PLAYER_HINTS.test(player)) return true;
  if (hasBasketballMarketSignal(statType, blob) && !hasMlbMarketSignal(statType, blob)) return true;
  if (sportFromMlbTeams(prop.team, prop.opponent, prop.matchup) === "NBA") return true;

  const fromEvent = sportFromEventCategory(prop.raw || {}, prop._lookup || {});
  if (fromEvent === "NBA") return true;

  const rawSport = String(prop.sport || prop.league || "").trim();
  if (!isInvalidSportToken(rawSport) && canonicalizeSport(rawSport) === "NBA") return true;

  return false;
}

export function isMlbUnderdogPropStrict(prop = {}) {
  if (isNbaUnderdogProp(prop)) return false;

  const player = String(prop.player || prop.playerName || "");
  const statType = prop.statType || prop.market || prop.propType || "";
  const blob = contextBlob({
    statType,
    player,
    team: prop.team,
    opponent: prop.opponent,
    matchup: prop.matchup,
  });

  if (hasMlbMarketSignal(statType, blob)) return true;
  if (MLB_PLAYER_HINTS.test(player)) return true;
  if (sportFromMlbTeams(prop.team, prop.opponent, prop.matchup) === "MLB") return true;

  const raw = prop.raw || {};
  const attrs = attrsOf(raw);
  if (hasMlbMarketSignal(attrs.title, attrs.selection_header, raw.event_title, raw.category)) return true;

  const fromEvent = sportFromEventCategory(raw, prop._lookup || {});
  if (fromEvent === "MLB") return true;

  const rawSport = String(prop.sport || prop.league || "").trim();
  if (!isInvalidSportToken(rawSport) && canonicalizeSport(rawSport) === "MLB") return true;

  return false;
}

/** @deprecated use isMlbUnderdogPropStrict */
export function inferMlbUnderdogProp(prop = {}) {
  return isMlbUnderdogPropStrict(prop);
}

export function detectUnderdogSport(raw = {}, lookup = {}, context = {}) {
  const selectedSport = context.selectedSport || context.selectedSportTab || "";
  const player = String(context.player || "");
  const statType = context.statType || "";

  if (NBA_PLAYER_HINTS.test(player)) return "NBA";
  if (hasBasketballMarketSignal(statType) && !hasMlbMarketSignal(statType, player, context.team)) return "NBA";

  const fromEvent = sportFromEventCategory(raw, lookup);
  if (fromEvent === "NBA" && !hasMlbMarketSignal(statType, player)) return "NBA";
  if (fromEvent === "MLB") return "MLB";
  if (fromEvent && fromEvent !== "NBA") return fromEvent;

  if (hasMlbMarketSignal(statType, player, context.team, context.opponent, context.matchup)) return "MLB";
  if (MLB_PLAYER_HINTS.test(player)) return "MLB";

  const fromTeams = sportFromMlbTeams(context.team, context.opponent, context.matchup);
  if (fromTeams === "NBA") return "NBA";
  if (fromTeams === "MLB") return "MLB";

  if (selectedSport && selectedSport !== "all" && !isInvalidSportToken(selectedSport)) {
    return canonicalizeSport(selectedSport) || selectedSport;
  }

  return "";
}

export function resolvePropSportLabel(prop = {}) {
  if (isNbaUnderdogProp(prop)) return "NBA";
  if (isMlbUnderdogPropStrict(prop)) return "MLB";

  const rawSport = String(prop.sport || prop.league || prop.classifiedSport || "").trim();
  if (!isInvalidSportToken(rawSport)) {
    const canon = canonicalizeSport(rawSport);
    if (canon === "NBA" && isNbaUnderdogProp(prop)) return "NBA";
    if (canon === "MLB" && isMlbUnderdogPropStrict(prop)) return "MLB";
    if (canon && canon !== "Unknown") return canon;
  }

  return "";
}

export function isUnderdogSport(prop = {}, sport = "MLB") {
  if (prop.normalizedSource !== "underdog") return false;
  const want = canonicalizeSport(sport) || sport;
  return resolvePropSportLabel(prop) === want;
}

export function filterUnderdogPropsBySport(props = [], sport = "MLB") {
  const want = canonicalizeSport(sport) || sport;
  return (props || []).filter((prop) => {
    if (prop.normalizedSource !== "underdog") return false;
    const label = resolvePropSportLabel(prop);
    if (want === "MLB" && isNbaUnderdogProp(prop)) return false;
    return label === want;
  });
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
