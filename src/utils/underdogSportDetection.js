/**
 * Underdog sport detection — never treats feed-type tokens (player_prop, core, etc.) as leagues.
 * MLB indicators are evaluated before NBA. Unknown props are never defaulted to NBA.
 */

import {
  inferSportFromText,
  normalizeSportLabel,
  sportFromUnderdogGame,
  UNDERDOG_SPORT_SLUGS,
} from "./sportMappings.js";
import { compactMarketKey } from "./marketNormalization.js";
import {
  isMlbOnlyStatType,
  isNbaOnlyStatType,
  lockSportFromStatType,
  sportStatMismatchReason,
} from "./propStatSportLock.js";

export const INVALID_SPORT_TOKENS = new Set([
  "playerprop",
  "player_prop",
  "core",
  "boost",
  "special",
  "prop",
  "unknown",
]);

export const MLB_SPORT_MISMAP_MESSAGE =
  "Parsed Underdog props exist, but none mapped to MLB. Check sport mapper.";

const MLB_TEAMS = new Set([
  "LAD", "MIL", "ATL", "WSH", "TOR", "PIT", "STL", "CIN", "SEA", "KC", "AZ", "ARI", "COL", "DET", "BAL",
  "NYY", "NYM", "BOS", "CHC", "CWS", "HOU", "LAA", "MIA", "MIN", "OAK", "SD", "SF", "TB", "TEX", "CLE", "PHI", "ATH",
]);

const NBA_TEAMS = new Set(["OKC", "SAS", "LAL", "BOS", "NYK", "CLE", "DAL", "DEN", "SAC"]);

const MLB_STAT_PATTERN =
  /\b(hits?\s*(\+|and)?\s*runs?\s*(\+|and)?\s*rbis?|hits?\s*\+\s*runs?|total\s*bases?|home\s*runs?|\brbis?\b|\bdoubles?\b|\bsingles?\b|\bruns?\b|strikeouts?|earned\s*runs?|walks?\s*allowed)\b/i;

const NBA_STAT_PATTERN =
  /\b(points?|rebounds?|assists?|pra|3pm|threes?|steals?|blocks?|double double|triple double)\b/i;

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
  return UNDERDOG_SPORT_SLUGS[sportToken(value)] || "";
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

function countTeamHits(text = "", teamSet = new Set()) {
  return tokenizeAbbrs(text).filter((t) => teamSet.has(t)).length;
}

function playerMatches(_name = "", _hints = []) {
  return false;
}

export function hasMlbStatIndicator(...parts) {
  return parts.some((part) => isMlbOnlyStatType(part));
}

export function hasMlbMarketSignal(...parts) {
  return hasMlbStatIndicator(...parts);
}

export function hasBasketballMarketSignal(...parts) {
  return parts.some((part) => isNbaOnlyStatType(part));
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

function collectPropContext(prop = {}) {
  const raw = prop.raw || {};
  const attrs = attrsOf(raw);
  const player = String(prop.player || prop.playerName || "");
  const statType = String(prop.statType || prop.market || prop.propType || "");
  const teamText = [prop.team, prop.opponent, prop.matchup].filter(Boolean).join(" ");
  const eventText = [
    raw.event_title,
    raw.category,
    raw.tab,
    attrs.title,
    attrs.selection_header,
    attrs.group_name,
    attrs.competition_name,
  ]
    .filter(Boolean)
    .join(" ");

  return { raw, attrs, player, statType, teamText, eventText };
}

/**
 * Primary sport mapper — MLB indicators win over NBA. Returns { sport, reason }.
 */
export function inferSportFromProp(prop = {}, { selectedSport = "" } = {}) {
  const tab = selectedSport || prop.selectedSportTab || prop.selectedSport || "";
  const { raw, player, statType, teamText, eventText } = collectPropContext(prop);

  const statLock = lockSportFromStatType(statType);
  if (statLock === "NBA") {
    return { sport: "NBA", reason: "nba-only stat type lock" };
  }
  if (statLock === "MLB") {
    return { sport: "MLB", reason: "mlb-only stat type lock" };
  }

  if (hasMlbStatIndicator(statType, eventText)) {
    return { sport: "MLB", reason: "mlb stat type match" };
  }

  const fromEventMlb = sportFromEventCategory(raw, prop._lookup || {});
  if (fromEventMlb === "MLB") {
    return { sport: "MLB", reason: "event/category metadata (MLB)" };
  }

  if (countTeamHits(teamText, MLB_TEAMS) > 0) {
    return { sport: "MLB", reason: "mlb team abbreviation match" };
  }

  const rawSport = String(prop.sport || prop.league || prop.classifiedSport || "").trim();
  if (!isInvalidSportToken(rawSport)) {
    const canon = canonicalizeSport(rawSport);
    if (canon === "MLB") return { sport: "MLB", reason: "valid raw sport field" };
  }

  if (hasBasketballMarketSignal(statType, eventText) && !hasMlbStatIndicator(statType, eventText)) {
    const wnbaHint = /wnba/i.test(`${eventText} ${prop.league || ""} ${rawSport}`);
    return { sport: wnbaHint ? "WNBA" : "NBA", reason: wnbaHint ? "wnba stat type match" : "nba stat type match" };
  }

  if (countTeamHits(teamText, NBA_TEAMS) > 0 && countTeamHits(teamText, MLB_TEAMS) === 0) {
    return { sport: "NBA", reason: "nba team abbreviation match" };
  }

  if (fromEventMlb === "NBA" || fromEventMlb === "WNBA") {
    return { sport: fromEventMlb, reason: `event/category metadata (${fromEventMlb})` };
  }

  if (!isInvalidSportToken(rawSport)) {
    const canon = canonicalizeSport(rawSport);
    if (canon === "NBA") return { sport: "NBA", reason: "valid raw sport field" };
    if (canon && canon !== "Unknown" && canon !== "Unsupported") {
      return { sport: canon, reason: "valid raw sport field" };
    }
  }

  if (fromEventMlb && fromEventMlb !== "NBA") {
    return { sport: fromEventMlb, reason: "event/category metadata" };
  }

  if (tab === "MLB" && hasMlbStatIndicator(statType, eventText)) {
    return { sport: "MLB", reason: "selected MLB tab + mlb stat type fallback" };
  }

  return { sport: "", reason: "" };
}

export function validateInferredSport(prop = {}, inference = {}) {
  const statType = prop.statType || prop.market || prop.propType || "";
  const mismatch = sportStatMismatchReason(inference.sport, statType);
  if (mismatch) {
    const lock = lockSportFromStatType(statType);
    if (lock) {
      return { sport: lock, reason: `${lock.toLowerCase()}-only stat type lock (corrected)` };
    }
  }
  return inference;
}

export function isNbaUnderdogProp(prop = {}) {
  return inferSportFromProp(prop).sport === "NBA";
}

export function isMlbUnderdogPropStrict(prop = {}) {
  return inferSportFromProp(prop).sport === "MLB";
}

/** @deprecated use isMlbUnderdogPropStrict */
export function inferMlbUnderdogProp(prop = {}) {
  return isMlbUnderdogPropStrict(prop);
}

export function detectUnderdogSport(raw = {}, lookup = {}, context = {}) {
  const prop = {
    player: context.player,
    playerName: context.player,
    statType: context.statType,
    team: context.team,
    opponent: context.opponent,
    matchup: context.matchup,
    raw,
    _lookup: lookup,
    selectedSportTab: context.selectedSport || context.selectedSportTab,
  };
  const { sport } = inferSportFromProp(prop, { selectedSport: context.selectedSport || context.selectedSportTab });
  return sport;
}

export function resolvePropSportLabel(prop = {}) {
  const { sport } = inferSportFromProp(prop, {
    selectedSport: prop.selectedSportTab || prop.selectedSport,
  });
  return sport || "";
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
    if (want === "MLB" && label !== "MLB") return false;
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

export function attachSportInference(prop = {}, options = {}) {
  let inference = inferSportFromProp(prop, options);
  inference = validateInferredSport(prop, inference);
  if (!inference.sport) return prop;
  return {
    ...prop,
    sport: inference.sport,
    league: inference.sport,
    inferredSport: inference.sport,
    sportInferenceReason: inference.reason,
    classifiedSport: inference.sport,
  };
}
