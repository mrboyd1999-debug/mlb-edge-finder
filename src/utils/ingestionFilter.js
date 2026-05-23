import { APP_SPORTS } from "./marketClassification.js";
import { MLB_ONLY_MODE, shouldSilenceIngestionReject } from "./mlbOnlyMode.js";
import {
  PRIZEPICKS_LEAGUE_SPORTS,
  inferSportFromText,
  sportFromPrizePicksLeague,
  sportFromUnderdogGame,
} from "./sportMappings.js";

/** Sports allowed into the pipeline at ingestion. */
export const INGESTION_ALLOWED_SPORTS = MLB_ONLY_MODE
  ? new Set([APP_SPORTS.MLB])
  : new Set([
      APP_SPORTS.MLB,
      APP_SPORTS.NBA,
      APP_SPORTS.WNBA,
      APP_SPORTS.ATP,
      APP_SPORTS.WTA,
      APP_SPORTS.Tennis,
      APP_SPORTS.NHL,
      APP_SPORTS.Soccer,
    ]);

/** PrizePicks league ids that must never enter the pipeline. */
export const BLOCKED_PRIZEPICKS_LEAGUE_IDS = new Set([
  "266", // overseas / unsupported bucket on PrizePicks
]);

export const OVERSEAS_BLOCKED_PATTERN =
  /\b(kbo|npb|cpbl|lbp|j\.?\s*league|k\.?\s*league|k-league|australian baseball|mexican league|dominican league|caribbean series|wbc|international baseball|overseas|overseas\s+placeholder|placeholder competition|test league|demo league|mock league|fake league|sample league)\b/i;

export const PLACEHOLDER_COMPETITION_PATTERN =
  /\b(test\s+player|mock\s+player|fake\s+player|demo\s+player|sample\s+player|placeholder|unknown league|tbd league)\b/i;

/** Approved domestic/international soccer competitions. */
export const APPROVED_SOCCER_LEAGUE_PATTERN =
  /\b(epl|english premier|premier league|mls|major league soccer|laliga|la liga|bundesliga|serie a|ligue 1|ucl|uefa champions|champions league|europa league|fa cup|carabao|mls cup|concacaf|copa america|world cup|euro 20|nations league|eredivisie|primeira liga|scottish premiership|super lig|liga mx)\b/i;

export const BLOCKED_SOCCER_LEAGUE_PATTERN =
  /\b(k[-\s]?league|j[-\s]?league|japan league|chinese super|csL|indian super|a[-\s]?league|saudi pro league|qatar stars|uae pro|egyptian premier|south african|npfl|liga 1 indonesia|thai league|v[-\s]?league)\b/i;

const NON_PRIORITY_SPORTS = new Set([
  APP_SPORTS.NFL,
  APP_SPORTS.NCAAF,
  APP_SPORTS.Esports,
  APP_SPORTS.Unsupported,
  "Other",
]);

function normalizeToken(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildIngestionText(context = {}) {
  return [
    context.platform,
    context.sport,
    context.league,
    context.leagueName,
    context.leagueId,
    context.competitionId,
    context.competitionName,
    context.sportId,
    context.country,
    context.playerCountry,
    context.playerLeague,
    context.playerName,
    context.team,
    context.opponent,
    context.description,
    context.statType,
  ]
    .filter(Boolean)
    .join(" ");
}

export function isBlockedOverseasCompetition(context = {}) {
  const blob = buildIngestionText(context);
  if (!blob) return false;
  if (OVERSEAS_BLOCKED_PATTERN.test(blob)) return true;
  if (PLACEHOLDER_COMPETITION_PATTERN.test(blob)) return true;
  if (context.leagueId && BLOCKED_PRIZEPICKS_LEAGUE_IDS.has(String(context.leagueId))) return true;
  if (context.competitionId && BLOCKED_PRIZEPICKS_LEAGUE_IDS.has(String(context.competitionId))) return true;
  return false;
}

export function isApprovedSoccerLeague(context = {}) {
  const blob = buildIngestionText(context);
  if (BLOCKED_SOCCER_LEAGUE_PATTERN.test(blob)) return false;
  return APPROVED_SOCCER_LEAGUE_PATTERN.test(blob);
}

export function resolveIngestionSport(context = {}) {
  if (context.sport && INGESTION_ALLOWED_SPORTS.has(context.sport)) return context.sport;
  if (context.sport && context.sport !== "Other" && context.sport !== APP_SPORTS.Unsupported) {
    if (INGESTION_ALLOWED_SPORTS.has(context.sport)) return context.sport;
  }

  if (context.leagueId) {
    const fromLeagueId = PRIZEPICKS_LEAGUE_SPORTS[String(context.leagueId)];
    if (fromLeagueId) return fromLeagueId;
  }

  const inferred = inferSportFromText(buildIngestionText(context), {
    description: context.description,
    playerName: context.playerName,
    opponent: context.opponent,
    statType: context.statType,
  });
  return inferred || context.sport || "";
}

export function getIngestionRejectReason(context = {}) {
  if (isBlockedOverseasCompetition(context)) {
    return "blocked overseas/placeholder competition";
  }

  const sport = resolveIngestionSport(context);
  if (!sport || NON_PRIORITY_SPORTS.has(sport)) {
    return sport ? `non-priority sport blocked at ingestion: ${sport}` : "unknown league/sport blocked at ingestion";
  }

  if (sport === APP_SPORTS.Soccer && !isApprovedSoccerLeague(context)) {
    return "unapproved soccer league";
  }

  if (!INGESTION_ALLOWED_SPORTS.has(sport)) {
    return `unsupported sport blocked at ingestion: ${sport}`;
  }

  return "";
}

export function buildContextFromProp(prop = {}) {
  return {
    platform: prop.platform,
    sport: prop.sport || prop.classifiedSport,
    league: prop.league,
    leagueId: prop.leagueId,
    leagueName: prop.leagueName || prop.league,
    competitionId: prop.competitionId,
    competitionName: prop.competitionName,
    sportId: prop.sportId,
    country: prop.country,
    playerCountry: prop.playerCountry,
    playerLeague: prop.playerLeague,
    playerName: prop.playerName,
    team: prop.team,
    opponent: prop.opponent,
    description: prop.description,
    statType: prop.statType,
  };
}

export function getIngestionPropRejectReason(prop = {}) {
  return getIngestionRejectReason(buildContextFromProp(prop));
}

export function isOverseasOrPlaceholderProp(prop = {}) {
  return isBlockedOverseasCompetition(buildContextFromProp(prop));
}

export function buildPrizePicksFlatIngestionContext(item = {}) {
  const leagueId = item.league_id || item.leagueId || "";
  const leagueName = item.league || item.sport || item.league_name || "";
  return {
    platform: "PrizePicks",
    leagueId,
    leagueName,
    league: leagueName,
    sport: inferSportFromText(`${leagueName} ${item.sport || ""}`, {
      description: item.description,
      playerName: item.player_name || item.playerName,
      opponent: item.opponent,
    }),
    playerName: item.player_name || item.playerName || item.display_name || item.name,
    team: item.team || item.team_abbr,
    opponent: item.opponent || item.opponent_abbr,
    description: item.description,
    statType: item.stat_type || item.statType || item.market,
  };
}

export function buildPrizePicksProjectionIngestionContext(item = {}, included = new Map()) {
  const relationships = item.relationships || {};
  const leagueRel = relationships.league?.data;
  const leagueId = Array.isArray(leagueRel) ? leagueRel[0]?.id : leagueRel?.id;
  const leagueRecord = leagueId ? included.get(`league:${leagueId}`) : null;
  const leagueAttrs = leagueRecord?.attributes || {};
  const leagueName = [
    leagueAttrs.name,
    leagueAttrs.display_name,
    leagueAttrs.league_name,
    leagueAttrs.sport_name,
  ]
    .filter(Boolean)
    .join(" ");
  const playerRecord = relatedIncludedRecord(included, relationships.new_player || relationships.player);
  const gameRecord = relatedIncludedRecord(included, relationships.game);
  const attributes = item.attributes || {};
  const playerAttrs = playerRecord?.attributes || {};

  return {
    platform: "PrizePicks",
    leagueId: leagueId || "",
    leagueName,
    league: leagueName,
    sport:
      sportFromPrizePicksLeague(leagueRecord, leagueId) ||
      inferSportFromText(`${leagueName} ${attributes.league || ""}`, {
        description: attributes.description,
        playerName: playerAttrs.display_name || playerAttrs.name,
        opponent: attributes.opponent,
      }),
    competitionId: leagueId || "",
    competitionName: leagueName,
    playerName: playerAttrs.display_name || playerAttrs.name || attributes.player_name,
    playerCountry: playerAttrs.country || playerAttrs.nationality,
    playerLeague: playerAttrs.league || leagueName,
    team: playerAttrs.team || playerAttrs.team_abbr,
    opponent: attributes.opponent || gameRecord?.attributes?.description,
    description: attributes.description,
    statType: attributes.stat_type || attributes.stat_display_name,
  };
}

export function buildUnderdogFlatIngestionContext(item = {}) {
  return {
    platform: "Underdog",
    sport: inferSportFromText(`${item.league || ""} ${item.sport || ""}`, {
      description: item.description || item.title,
      playerName: item.player_name || item.playerName,
      opponent: item.opponent,
    }),
    league: item.league || item.sport || "",
    leagueName: item.league || item.sport || "",
    sportId: item.sport_id || item.sport,
    competitionId: item.competition_id || item.competitionId || item.league_id,
    competitionName: item.competition_name || item.league,
    country: item.country,
    playerCountry: item.player_country || item.country,
    playerLeague: item.player_league || item.league,
    playerName: item.player_name || item.playerName || item.display_name,
    team: item.team || item.team_abbr,
    opponent: item.opponent || item.opponent_abbr,
    description: item.description || item.title,
    statType: item.stat_type || item.statType || item.market,
  };
}

export function buildUnderdogLineIngestionContext({ line = {}, overUnder = {}, game = {}, player = {}, appearance = {} } = {}) {
  const sport =
    sportFromUnderdogGame(game, overUnder) ||
    inferSportFromText(`${game.sport_id || ""} ${game.league || ""} ${overUnder.title || ""}`, {
      description: overUnder.title,
      playerName: player.full_name || player.name,
      opponent: appearance.opponent_abbr || game.short_title,
    });

  return {
    platform: "Underdog",
    sport,
    sportId: game.sport_id || game.sport || overUnder.sport,
    league: game.league || game.short_title || game.title || "",
    leagueName: game.league || game.short_title || game.title || "",
    leagueId: game.league_id || appearance.league_id,
    competitionId: game.competition_id || game.competitionId || overUnder.competition_id,
    competitionName: game.competition_name || game.league || game.title,
    country: game.country || player.country,
    playerCountry: player.country || player.nationality,
    playerLeague: player.league || game.league,
    playerName: player.full_name || player.name || line.player_name,
    team: appearance.team_abbr || player.team_abbr,
    opponent: appearance.opponent_abbr || game.short_title || game.title,
    description: overUnder.title || line.title,
    statType: overUnder.stat_type || overUnder.title,
  };
}

function relatedIncludedRecord(included, relationship) {
  const data = relationship?.data;
  if (!data) return null;
  const target = Array.isArray(data) ? data[0] : data;
  if (!target) return null;
  return included.get(`${target.type}:${target.id}`) || null;
}

export function shouldParseIngestionContext(context = {}) {
  if (!MLB_ONLY_MODE) return true;
  if (isBlockedOverseasCompetition(context)) return false;
  return resolveIngestionSport(context) === APP_SPORTS.MLB;
}

export function rejectIngestionAtSource(context, audit, recordFilterReason, rawRef = null) {
  const reason = getIngestionRejectReason(context);
  if (!reason) return "";
  if (shouldSilenceIngestionReject(reason, context)) return reason;
  if (audit && typeof recordFilterReason === "function") {
    recordFilterReason(audit, reason, rawRef || context);
  }
  return reason;
}

export function filterIngestionProps(props = [], audit = null, recordFilterReason = null) {
  const accepted = [];
  props.forEach((prop) => {
    const reason = getIngestionPropRejectReason(prop);
    if (reason) {
      if (!shouldSilenceIngestionReject(reason, prop) && audit && typeof recordFilterReason === "function") {
        recordFilterReason(audit, reason, prop);
      }
      return;
    }
    accepted.push(prop);
  });
  return accepted;
}

function clonePayloadShape(payload, nextData, nextIncluded) {
  if (Array.isArray(payload)) return nextData;
  if (payload?.data?.data && Array.isArray(payload.data.data)) {
    return {
      ...payload,
      data: {
        ...payload.data,
        data: nextData,
        included: nextIncluded ?? payload.data.included,
      },
    };
  }
  if (Array.isArray(payload?.data)) {
    return {
      ...payload,
      data: nextData,
      included: nextIncluded ?? payload.included,
    };
  }
  if (Array.isArray(payload?.props)) {
    return { ...payload, props: nextData };
  }
  return { ...payload, data: nextData, included: nextIncluded ?? payload.included };
}

export function sanitizePrizePicksPayloadForCache(payload) {
  if (!payload) return payload;
  const unwrapped = unwrapPrizePicksPayloadShape(payload);
  if (!unwrapped.rows.length) return payload;

  const includedMap = buildIncludedLookup(unwrapped.included);
  const keptRows = [];
  unwrapped.rows.forEach((row) => {
    const context = row?.type === "projection" || row?.attributes
      ? buildPrizePicksProjectionIngestionContext(row, includedMap)
      : buildPrizePicksFlatIngestionContext(row);
    if (!getIngestionRejectReason(context)) keptRows.push(row);
  });

  return clonePayloadShape(payload, keptRows, unwrapped.included);
}

export function sanitizeUnderdogPayloadForCache(payload) {
  if (!payload) return payload;
  if (Array.isArray(payload)) {
    return payload.filter((item) => !getIngestionRejectReason(buildUnderdogFlatIngestionContext(item)));
  }

  const next = { ...payload };
  const filterLines = (lines, builder) =>
    (lines || []).filter((line) => !getIngestionRejectReason(builder(line)));

  if (Array.isArray(payload.over_under_lines)) {
    next.over_under_lines = filterLines(payload.over_under_lines, (line) => {
      const overUnder = line.over_under || line.overUnder || line.attributes || line;
      const games = mapRecords(payload.games);
      const appearances = mapRecords(payload.appearances);
      const players = mapRecords(payload.players || payload.athletes);
      const appearanceId =
        overUnder.appearance_id ||
        line.appearance_id ||
        line.relationships?.appearance?.data?.id;
      const appearance = appearances.get(String(appearanceId)) || {};
      const player = players.get(String(appearance.player_id || overUnder.player_id || line.player_id)) || {};
      const game = games.get(String(appearance.game_id || overUnder.game_id || line.game_id)) || {};
      return buildUnderdogLineIngestionContext({ line, overUnder, game, player, appearance });
    });
  }

  if (Array.isArray(payload.data) && payload.players) {
    // Preserve envelope; lines live in over_under_lines above in typical payloads.
    return next;
  }

  if (Array.isArray(payload.data) && !payload.players && !payload.games) {
    next.data = filterLines(payload.data, (item) => buildUnderdogFlatIngestionContext(item));
  }

  return next;
}

function mapRecords(records = []) {
  const map = new Map();
  (records || []).forEach((record) => {
    if (record?.id != null) map.set(String(record.id), record);
  });
  return map;
}

function unwrapPrizePicksPayloadShape(payload) {
  if (Array.isArray(payload)) return { rows: payload, included: [] };
  if (payload?.data?.data && Array.isArray(payload.data.data)) {
    return { rows: payload.data.data, included: payload.data.included || [] };
  }
  if (Array.isArray(payload?.data)) {
    return { rows: payload.data, included: payload.included || [] };
  }
  if (Array.isArray(payload?.props)) return { rows: payload.props, included: payload.included || [] };
  return { rows: [], included: [] };
}

function buildIncludedLookup(included = []) {
  const map = new Map();
  (included || []).forEach((record) => {
    map.set(`${record.type}:${record.id}`, record);
  });
  return map;
}
