/**
 * Underdog-specific sport detection — never defaults to NBA or MLB.
 * MLB signals override mislabeled NBA when baseball context is present.
 */

import {
  inferSportFromText,
  normalizeSportLabel,
  sportFromUnderdogGame,
  UNDERDOG_SPORT_SLUGS,
} from "./sportMappings.js";
import { compactMarketKey } from "./marketNormalization.js";

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
  /\b(wembanyama|gilgeous-alexander|doncic|antetokounmpo|tatum|curry|lebron|jokic|embiid|luka|durant|booker|edwards|brunson|haliburton|maxey|morant|adebayo|banchero|holmgren|siakam|randle|kyrie|harden|kawhi|zion|lamelo|trae young)\b/i;

const MLB_MARKET_PATTERN =
  /hits?\s*(\+|and)?\s*runs?\s*(\+|and)?\s*rbis?|hits?\s*\+\s*runs?|total\s*bases?|home\s*runs?|pitcher\s*strikeouts?|strikeouts?|earned\s*runs?|walks?\s*allowed|walks?|\brbis?\b|\bhits?\b|\bruns?\b|\bdoubles?\b|\bsingles?\b|fantasy(?:\s+score|\s+points)?/i;

const BASKETBALL_MARKET_PATTERN =
  /\b(points?|rebounds?|assists?|pra|3pm|threes?|steals?|blocks?|double double|triple double)\b/i;

function attrsOf(raw = {}) {
  return raw.attributes || raw.over_under || raw.overUnder || raw;
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

function tokenizeAbbrs(text = "") {
  return String(text || "")
    .toUpperCase()
    .match(/\b[A-Z]{2,4}\b/g) || [];
}

function hasMlbMarketSignal(...parts) {
  const blob = parts.filter(Boolean).join(" ");
  if (!blob) return false;
  if (MLB_MARKET_PATTERN.test(blob)) return true;
  const compact = compactMarketKey(blob);
  return (
    compact.includes("hitsrunsrbis") ||
    compact.includes("hitsrunsandrbis") ||
    compact.includes("totalbases") ||
    compact.includes("homerun") ||
    compact.includes("fantasy") ||
    compact.includes("strikeout") ||
    compact.includes("earnedrun") ||
    compact.includes("walksallowed") ||
    compact === "hits" ||
    compact === "runs" ||
    compact === "rbis" ||
    compact === "rbi"
  );
}

function hasBasketballMarketSignal(...parts) {
  const blob = parts.filter(Boolean).join(" ");
  return blob && BASKETBALL_MARKET_PATTERN.test(blob) && !hasMlbMarketSignal(blob);
}

function sportFromMlbTeams(team = "", opponent = "", matchup = "") {
  const tokens = [...tokenizeAbbrs(team), ...tokenizeAbbrs(opponent), ...tokenizeAbbrs(matchup)];
  if (!tokens.length) return "";
  const mlbHits = tokens.filter((t) => MLB_TEAM_ABBRS.has(t)).length;
  const nbaOnlyHits = tokens.filter((t) => NBA_ONLY_TEAM_ABBRS.has(t)).length;
  if (mlbHits > 0 && nbaOnlyHits === 0) return "MLB";
  if (nbaOnlyHits > 0 && mlbHits === 0) return "NBA";
  if (mlbHits > nbaOnlyHits) return "MLB";
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
    attrs.league,
    attrs.sport,
    attrs.sport_id,
    game.competition_name,
    game.league,
    game.sport,
    game.sport_id,
    ...optionHeaders,
  ];

  for (const field of categoryFields) {
    const slug = slugSport(field);
    if (slug) return slug;
    const canon = canonicalizeSport(field);
    if (canon && canon !== "Unsupported") return canon;
  }

  if (game && Object.keys(game).length) {
    const fromGame = sportFromUnderdogGame(game, attrs);
    if (fromGame) return canonicalizeSport(fromGame) || fromGame;
  }

  return "";
}

function forceMlbFromContext(context = {}) {
  const statType = context.statType || "";
  const player = context.player || "";
  const team = context.team || "";
  const opponent = context.opponent || "";
  const matchup = context.matchup || "";

  if (hasMlbMarketSignal(statType, player, team, opponent, matchup)) return "MLB";
  if (MLB_PLAYER_HINTS.test(player)) return "MLB";
  if (sportFromMlbTeams(team, opponent, matchup) === "MLB") return "MLB";
  return "";
}

function forceNbaFromContext(context = {}) {
  const statType = context.statType || "";
  const player = context.player || "";
  if (hasMlbMarketSignal(statType, player, context.team, context.opponent, context.matchup)) return "";
  if (hasBasketballMarketSignal(statType)) return "NBA";
  if (NBA_PLAYER_HINTS.test(player)) return "NBA";
  return "";
}

function limitedContextText(raw = {}, lookup = {}, context = {}) {
  const attrs = attrsOf(raw);
  const { games, appearances } = lookup;
  let game = {};
  if (games?.size && appearances?.size) {
    const appearanceId = attrs.appearance_id || raw.appearance_id;
    const appearance = appearances.get(String(appearanceId)) || {};
    game = games.get(String(appearance.game_id || appearance.match_id || attrs.game_id)) || {};
  }

  return [
    raw.sport,
    raw.league,
    raw.sport_name,
    attrs.sport,
    attrs.league,
    attrs.sport_name,
    attrs.event_title,
    game.sport,
    game.league,
    game.competition_name,
    context.statType,
    context.team,
    context.opponent,
    context.matchup,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Detect canonical sport for a raw Underdog record. Returns "" when unknown.
 */
export function detectUnderdogSport(raw = {}, lookup = {}, context = {}) {
  const mlbForced = forceMlbFromContext(context);
  if (mlbForced) return mlbForced;

  const fromEvent = sportFromEventCategory(raw, lookup);
  if (fromEvent === "MLB") return "MLB";
  if (fromEvent && fromEvent !== "NBA") return fromEvent;

  const limited = limitedContextText(raw, lookup, context);
  const limitedSport = inferSportFromText(limited, context);
  if (limitedSport === "MLB") return "MLB";

  const nbaForced = forceNbaFromContext(context);
  if (nbaForced && !hasMlbMarketSignal(context.statType, context.player)) return nbaForced;

  if (fromEvent === "NBA" && !hasMlbMarketSignal(context.statType, context.player, context.team)) {
    return "NBA";
  }

  if (limitedSport && limitedSport !== "NBA") return limitedSport;

  const fromTeams = sportFromMlbTeams(context.team, context.opponent, context.matchup);
  if (fromTeams) return fromTeams;

  if (MLB_PLAYER_HINTS.test(String(context.player || ""))) return "MLB";

  return "";
}

export function inferMlbUnderdogProp(prop = {}) {
  const statType = prop.statType || prop.market || prop.propType || "";
  const player = String(prop.player || prop.playerName || "");
  const team = prop.team || "";
  const opponent = prop.opponent || "";
  const matchup = prop.matchup || "";

  if (hasMlbMarketSignal(statType, player, team, opponent, matchup)) return true;
  if (MLB_PLAYER_HINTS.test(player)) return true;
  if (sportFromMlbTeams(team, opponent, matchup) === "MLB") return true;

  const raw = prop.raw || {};
  const attrs = attrsOf(raw);
  if (hasMlbMarketSignal(attrs.title, attrs.selection_header, raw.event_title, raw.category)) return true;

  return false;
}

export function resolvePropSportLabel(prop = {}) {
  if (prop.normalizedSource === "underdog" && inferMlbUnderdogProp(prop)) {
    return "MLB";
  }

  const rawSport = String(prop.sport || prop.league || prop.classifiedSport || "").trim();
  if (rawSport === "MLB") return "MLB";

  const fromEvent = sportFromEventCategory(prop.raw || {}, {});
  if (fromEvent === "MLB" || inferMlbUnderdogProp(prop)) return "MLB";

  const direct = canonicalizeSport(rawSport);
  if (direct && direct !== "Unknown" && direct !== "NBA") return direct;

  if (hasMlbMarketSignal(prop.statType, prop.market, prop.propType, prop.playerName, prop.player)) {
    return "MLB";
  }

  if (direct === "NBA" && inferMlbUnderdogProp(prop)) return "MLB";

  if (direct && direct !== "Unknown") return direct;
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
    return resolvePropSportLabel(prop) === want;
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

export const MLB_SPORT_MISMAP_MESSAGE =
  "Parsed Underdog props exist, but none mapped to MLB. Check sport mapper.";
