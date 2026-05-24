/**
 * Dedicated Underdog prop parser — lenient mapping, separate from PrizePicks logic.
 * Only rejects: missing player, line is NaN.
 */

import { withNormalizedSource } from "./normalizeSource.js";
import { detectUnderdogSport, attachSportInference, inferSportFromProp } from "./underdogSportDetection.js";
import { resolveUnderdogCategory } from "./underdogRowCard.js";
import { normalizeGameStartTime } from "./normalizeGameStartTime.js";
import { sportFromUnderdogGame } from "./sportMappings.js";

export const UNDERDOG_PARSER_MISMATCH_MESSAGE = "Underdog parser mismatch detected.";

function mapById(rows = []) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const id = row?.id ?? row?.uuid;
    if (id != null) map.set(String(id), row);
  });
  return map;
}

export function unwrapUnderdogPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload?.source === "Underdog" && payload?.data && !Array.isArray(payload.data)) {
    return unwrapUnderdogPayload(payload.data);
  }
  if (payload?.source === "Underdog" && Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload?.data) && !payload.players && !payload.games && !payload.over_under_lines) {
    return payload.data;
  }
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.props)) return payload.props;
  return payload || {};
}

export function extractRawUnderdogRecords(payload) {
  const normalized = unwrapUnderdogPayload(payload);
  if (Array.isArray(normalized)) return normalized;
  if (normalized && typeof normalized === "object") {
    const lines =
      normalized.over_under_lines ||
      normalized.overUnders ||
      normalized.data ||
      normalized.items ||
      normalized.results ||
      normalized.props ||
      [];
    if (Array.isArray(lines) && lines.length) return lines;
  }
  return [];
}

export function buildUnderdogLookupMaps(payload) {
  const normalized = unwrapUnderdogPayload(payload);
  if (Array.isArray(normalized)) {
    return {
      players: new Map(),
      games: new Map(),
      appearances: new Map(),
      teams: new Map(),
      overUnders: new Map(),
    };
  }
  const overUnderRows =
    normalized.over_under_lines ||
    normalized.overUnders ||
    normalized.over_under ||
    [];
  return {
    players: mapById(normalized.players || normalized.athletes || []),
    games: mapById(normalized.games || normalized.matches || []),
    appearances: mapById(normalized.appearances || []),
    teams: mapById(normalized.teams || []),
    overUnders: mapById(Array.isArray(overUnderRows) ? overUnderRows : []),
  };
}

function attrsOf(raw = {}) {
  return raw.attributes || raw.over_under || raw.overUnder || raw;
}

function playerFullName(player = {}) {
  if (player.full_name || player.name) return String(player.full_name || player.name).trim();
  return [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
}

function titlePlayerName(title = "") {
  const text = String(title || "");
  const marker = text.match(
    /^(.*?)\s+(Points|Pts|Rebounds|Assists|Hits|Runs|Total Bases|Strikeouts|Pitcher Strikeouts|RBIs|Fantasy|Walks|Home Runs)/i
  );
  return marker?.[1]?.trim() || "";
}

function resolvePlayerFromRaw(raw = {}, lookup = {}) {
  const attrs = attrsOf(raw);
  const direct =
    raw.player_name ||
    raw.playerName ||
    raw.player ||
    raw.name ||
    raw.display_name ||
    attrs.player_name ||
    attrs.playerName ||
    attrs.name ||
    "";
  if (direct && String(direct).trim().length >= 2 && !/^unknown$/i.test(String(direct).trim())) {
    return String(direct).trim();
  }

  const { players, appearances } = lookup;
  if (players?.size && appearances?.size) {
    const appearanceId =
      attrs.appearance_id ||
      raw.appearance_id ||
      raw.relationships?.appearance?.data?.id ||
      attrs.relationships?.appearance?.data?.id;
    const appearance = appearances.get(String(appearanceId)) || {};
    const playerId =
      appearance.player_id ||
      attrs.player_id ||
      raw.player_id ||
      raw.athlete_id ||
      attrs.athlete_id;
    const fromMap = playerFullName(players.get(String(playerId)) || {});
    if (fromMap.length >= 2) return fromMap;
  }

  const fromTitle = titlePlayerName(attrs.title || raw.title || attrs.display_name || "");
  if (fromTitle.length >= 2) return fromTitle;

  return "";
}

function resolveLineFromRaw(raw = {}) {
  const attrs = attrsOf(raw);
  const statRecord = attrs.appearance_stat || attrs.stat || raw.stat || {};
  return Number(
    raw.line ??
      raw.stat_value ??
      raw.value ??
      raw.non_discounted_stat_value ??
      attrs.line ??
      attrs.stat_value ??
      attrs.value ??
      attrs.non_discounted_stat_value ??
      statRecord.stat_value ??
      statRecord.line ??
      statRecord.value
  );
}

function extractStatFromTitle(title = "") {
  const text = String(title || "");
  const match = text.match(
    /\b(Hits\s*\+\s*Runs\s*\+\s*RBIs|Hits\s*\+\s*Runs|Total Bases|Home Runs|Fantasy(?:\s+Score|\s+Points)?|Strikeouts?|Pitcher Strikeouts|RBIs?|Hits?|Runs?)\b/i
  );
  return match?.[1]?.trim() || "";
}

function resolveStatTypeFromRaw(raw = {}) {
  const attrs = attrsOf(raw);
  const statRecord = attrs.appearance_stat || attrs.stat || raw.stat || {};
  const fromTitle = extractStatFromTitle(attrs.title || raw.title || "");
  return String(
    raw.stat_type ||
      raw.statType ||
      raw.market ||
      raw.prop ||
      attrs.stat_type ||
      attrs.statType ||
      attrs.stat ||
      attrs.market ||
      statRecord.display_stat ||
      statRecord.stat ||
      fromTitle ||
      attrs.title ||
      raw.title ||
      raw.description ||
      "Unknown"
  ).trim();
}

function resolveSportFromGameChain(raw = {}, lookup = {}) {
  const attrs = attrsOf(raw);
  const { games, appearances } = lookup;
  if (!appearances?.size) return "";
  const appearanceId =
    attrs.appearance_id ||
    raw.appearance_id ||
    raw.relationships?.appearance?.data?.id ||
    attrs.relationships?.appearance?.data?.id;
  const appearance = appearances.get(String(appearanceId)) || {};
  const game = games?.get(String(appearance.game_id || appearance.match_id || attrs.game_id)) || {};
  const fromGame = sportFromUnderdogGame(game, attrs);
  if (fromGame && fromGame !== "Unknown") return fromGame;
  const league = game.league || game.sport || game.competition_name || game.sport_name || "";
  return String(league || "").trim();
}

function resolveSportFromRaw(raw = {}, lookup = {}, context = {}) {
  const fromChain = resolveSportFromGameChain(raw, lookup);
  if (fromChain && fromChain !== "Unknown") return fromChain;
  const detected = detectUnderdogSport(raw, lookup, context);
  if (detected) return detected;
  return "Unknown";
}

function resolveTeamOpponent(raw = {}, lookup = {}) {
  const attrs = attrsOf(raw);
  let team =
    raw.team ||
    raw.team_abbr ||
    raw.teamAbbr ||
    attrs.team ||
    attrs.team_abbr ||
    "";
  let opponent =
    raw.opponent || raw.opponent_abbr || attrs.opponent || attrs.opponent_abbr || attrs.matchup || "";

  const { games, appearances, teams } = lookup;
  if (appearances?.size) {
    const appearanceId = attrs.appearance_id || raw.appearance_id;
    const appearance = appearances.get(String(appearanceId)) || {};
    if (!team) {
      const teamRow = teams?.get(String(appearance.team_id)) || {};
      team =
        appearance.team_abbr ||
        teamRow.abbr ||
        teamRow.abbreviation ||
        teamRow.short_name ||
        teamRow.name ||
        "";
    }
    if (!opponent) opponent = appearance.opponent_abbr || appearance.opponent || "";
    if (!opponent && games?.size) {
      const game = games.get(String(appearance.game_id || appearance.match_id)) || {};
      opponent =
        game.short_title ||
        game.abbreviated_title ||
        game.title ||
        [game.away_team, game.home_team].filter(Boolean).join(" @ ") ||
        "";
    }
  }

  return { team: String(team || "").trim(), opponent: String(opponent || "").trim() };
}

function inferOddsType(raw = {}) {
  const attrs = attrsOf(raw);
  const options = raw.options || raw.choices || attrs.options || attrs.choices || [];
  const blob = [raw.odds_type, raw.oddsType, attrs.odds_type, attrs.oddsType, JSON.stringify(options)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\bgoblin\b|green goblin/.test(blob)) return "goblin";
  if (/\bdemon\b/.test(blob)) return "demon";
  return "standard";
}

function sideFromRaw(raw = {}, line, projection) {
  const attrs = attrsOf(raw);
  const pick = String(raw.pick || raw.side || raw.direction || attrs.pick || attrs.side || "").toLowerCase();
  if (pick.includes("under") || pick.includes("less") || pick.includes("lower")) return "under";
  if (pick.includes("over") || pick.includes("more") || pick.includes("higher")) return "over";

  const proj = Number(projection);
  const ln = Number(line);
  if (Number.isFinite(proj) && Number.isFinite(ln) && proj !== ln) {
    return proj > ln ? "over" : "under";
  }

  return "";
}

function computeSignedEdge(line, projection, side = "") {
  const ln = Number(line);
  const proj = Number(projection);
  if (!Number.isFinite(ln)) return null;
  const sideKey = String(side || "").toLowerCase();
  if (!Number.isFinite(proj) || proj <= 0) {
    if (sideKey.includes("under") || sideKey.includes("less")) return ln > 0 ? ln : null;
    return null;
  }
  if (sideKey.includes("under") || sideKey.includes("less")) return ln - proj;
  if (sideKey.includes("over") || sideKey.includes("more")) return proj - ln;
  return proj > ln ? proj - ln : ln - proj;
}

function normalizeStreakSide(value = "") {
  const key = String(value || "").toLowerCase();
  if (key.includes("higher") || key.includes("over") || key.includes("more")) return "Higher";
  if (key.includes("lower") || key.includes("under") || key.includes("less")) return "Lower";
  return String(value || "Higher");
}

function resolveStartTimeFromRaw(raw = {}, lookup = {}) {
  const attrs = attrsOf(raw);
  const { games, appearances } = lookup;
  let game = {};
  if (games?.size && appearances?.size) {
    const appearanceId = attrs.appearance_id || raw.appearance_id;
    const appearance = appearances.get(String(appearanceId)) || {};
    game = games.get(String(appearance.game_id || appearance.match_id || attrs.game_id)) || {};
  }
  return normalizeGameStartTime(
    raw.start_time ||
      raw.startTime ||
      raw.game_time ||
      raw.scheduled_at ||
      attrs.start_time ||
      attrs.scheduled_at ||
      game.scheduled_at ||
      game.start_time ||
      game.startTime
  );
}

function resolveStreakOptionsFromRaw(raw = {}) {
  const attrs = attrsOf(raw);
  const options = raw.options || raw.choices || attrs.options || attrs.choices || [];
  if (!Array.isArray(options) || !options.length) return [];

  return options
    .map((option) => {
      const multiplier = Number(
        option.payout_multiplier ??
          option.multiplier ??
          option.boosted_multiplier ??
          option.payoutMultiplier ??
          option.payout
      );
      return {
        side: normalizeStreakSide(option.choice_display || option.choice || option.side || option.label),
        multiplier,
        rawProbability: Number(option.raw_probability ?? option.rawProbability),
        optionId: option.id,
        label: option.selection_subheader || option.choice_display || "",
      };
    })
    .filter((option) => Number.isFinite(option.multiplier) && option.multiplier > 0 && option.multiplier !== 1);
}

/**
 * Parse one raw Underdog record into normalized app prop shape.
 * @returns {object|null} prop or null if rejected
 */
export function parseUnderdogProp(raw = {}, { lookup = {}, lineSourceBadge = "LIVE", selectedSport = "MLB" } = {}) {
  if (!raw || typeof raw !== "object") return null;

  const player =
    resolvePlayerFromRaw(raw, lookup) ||
    String(
      raw.player_name ||
        raw.player ||
        raw.name ||
        attrsOf(raw).player_name ||
        ""
    ).trim() ||
    "Unknown";

  if (!player || player === "Unknown" || player.length < 2) {
    return null;
  }

  const line = resolveLineFromRaw(raw);
  if (Number.isNaN(line) || !Number.isFinite(line)) {
    return null;
  }

  const statType = resolveStatTypeFromRaw(raw);
  const { team, opponent } = resolveTeamOpponent(raw, lookup);
  const matchup = [team, opponent ? `vs ${opponent}` : ""].filter(Boolean).join(" ").trim();
  const sport = resolveSportFromRaw(raw, lookup, {
    player,
    team,
    opponent,
    matchup,
    statType,
    selectedSport,
    selectedSportTab: selectedSport,
  });
  const projection = Number(
    raw.projection ?? raw.projected_value ?? raw.projectedValue ?? attrsOf(raw).projection ?? NaN
  );
  const hasProjection = Number.isFinite(projection) && projection > 0;
  const overUnder = sideFromRaw(raw, line, hasProjection ? projection : null);
  const edge = computeSignedEdge(line, hasProjection ? projection : null, overUnder);
  const sportInference = inferSportFromProp(
    {
      sport,
      statType,
      player,
      playerName: player,
      team,
      opponent,
      matchup,
      normalizedSource: "underdog",
      raw,
      _lookup: lookup,
      selectedSportTab: selectedSport,
    },
    { selectedSport }
  );
  const resolvedSport = sportInference.sport || sport || "Unknown";
  const oddsType = inferOddsType(raw);
  const startTime = resolveStartTimeFromRaw(raw, lookup);
  const streakOptions = resolveStreakOptionsFromRaw(raw);
  const underdogCategory = resolveUnderdogCategory({ statType, market: statType, propType: statType });
  const id =
    raw.id ||
    raw.sourceId ||
    attrsOf(raw).id ||
    `underdog|${player}|${statType}|${line}|${overUnder}`.toLowerCase().replace(/\s+/g, "-");

  const prop = withNormalizedSource({
    id: String(id),
    player,
    playerName: player,
    statType,
    market: statType,
    propType: statType,
    line,
    projection: hasProjection ? projection : null,
    projectedValue: hasProjection ? projection : null,
    team,
    opponent,
    sport: resolvedSport,
    league: resolvedSport === "MLB" ? "MLB" : resolvedSport,
    inferredSport: sportInference.sport || "",
    sportInferenceReason: sportInference.reason || "",
    classifiedSport: resolvedSport,
    underdogCategory,
    startTime,
    gameTime: startTime,
    streakOptions,
    normalizedSource: "underdog",
    source: "Underdog",
    platform: "Underdog",
    feedSource: "Underdog",
    overUnder: overUnder || "",
    side: overUnder || "",
    pick: overUnder || "",
    bestPick: overUnder || "",
    confidence: hasProjection ? 50 : null,
    confidenceScore: hasProjection ? 50 : null,
    edge: edge ?? null,
    projectionEdge: edge ?? null,
    propIncomplete: !hasProjection,
    playable: false,
    isDisplayPlayable: false,
    matchup,
    lineSourceBadge,
    oddsType,
    odds_type: oddsType,
    isGoblinPick: oddsType === "goblin",
    isDemonPick: oddsType === "demon",
    verifiedAdjustedOdds: oddsType !== "standard",
    sportsbookVerified: true,
    verifiedBadge: "VERIFIED",
    raw,
  });

  return prop;
}

function bumpReason(map, reason) {
  const key = reason || "unknown";
  map[key] = (map[key] || 0) + 1;
}

/**
 * Batch-parse raw Underdog records with diagnostics.
 */
export function parseUnderdogRawBatch(rawRecords = [], options = {}) {
  const records = Array.isArray(rawRecords) ? rawRecords : [];
  const rejectionReasons = {};
  let rejectedCount = 0;
  const props = [];

  records.slice(0, 3).forEach((raw, index) => {
    console.log("RAW UD PROP", JSON.stringify(records[index] ?? raw, null, 2));
  });

  records.forEach((raw) => {
    const player = resolvePlayerFromRaw(raw, options.lookup || {});
    const line = resolveLineFromRaw(raw);
    if (!player || player.length < 2 || player === "Unknown") {
      rejectedCount += 1;
      bumpReason(rejectionReasons, "missing player");
      return;
    }
    if (Number.isNaN(line) || !Number.isFinite(line)) {
      rejectedCount += 1;
      bumpReason(rejectionReasons, "line is NaN");
      return;
    }
    const parsed = parseUnderdogProp(raw, options);
    if (!parsed) {
      rejectedCount += 1;
      bumpReason(rejectionReasons, "parse returned null");
      return;
    }
    props.push(parsed);
  });

  const diagnostics = {
    rawCount: records.length,
    acceptedCount: props.length,
    rejectedCount,
    rejectionReasons,
    parserMismatch: records.length > 0 && props.length === 0,
  };

  if (diagnostics.parserMismatch) {
    console.warn("[Underdog Parser] mismatch — raw records present but zero parsed props", diagnostics);
  }

  console.info("[Underdog Parser] diagnostics", diagnostics);

  return { props, diagnostics };
}

/**
 * Parse full Underdog API payload — extracts raw lines then maps each record.
 */
export function parseUnderdogPayloadDedicated(payload, lineSourceBadge = "LIVE", selectedSport = "MLB") {
  const rawRecords = extractRawUnderdogRecords(payload);
  const lookup = buildUnderdogLookupMaps(payload);
  return parseUnderdogRawBatch(rawRecords, { lookup, lineSourceBadge, selectedSport });
}
