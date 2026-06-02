/**
 * SportsDataIO MLB season-stat → per-game projection helpers.
 * No fabricated projections — stat-based only; null when unmatched.
 */

import { normalizePlayerName, playerNamesMatch } from "../../src/utils/playerNames.js";
import { normalizeMergeId } from "../../src/utils/propMergeKeys.js";

export function normalizeMatchName(name = "") {
  return normalizePlayerName(name);
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickField(stat = {}, candidates = []) {
  for (const key of candidates) {
    const value = finiteNumber(stat?.[key]);
    if (value != null) return value;
  }
  return null;
}

export function resolveSportsDataPropLabel(prop = {}) {
  const label = String(prop.prop || prop.statType || prop.market || prop.propType || "").trim();
  const lower = label.toLowerCase();

  if (/strikeout/.test(lower)) return "Strikeouts";
  if (/total bases/.test(lower)) return "Total Bases";
  if (/home run/.test(lower)) return "Home Runs";
  if (/\brbi/.test(lower)) return "RBIs";
  if (/hits?\s*\+\s*runs|hrr|hits runs rbis/.test(lower)) return "Hits+Runs+RBIs";
  if (/hits allowed/.test(lower)) return "Hits Allowed";
  if (/earned runs? allowed|earned run/.test(lower)) return "Earned Runs";
  if (/walks allowed|walks? allowed/.test(lower)) return "Walks Allowed";
  if (/(^|\s)runs(\s|$)|runs scored/.test(lower) && !/rbi|earned|allowed/.test(lower)) return "Runs";
  if (/hit/.test(lower) && !/allowed|pitch/.test(lower)) return "Hits";
  if (/walk/.test(lower) && !/allowed/.test(lower)) return "Walks";
  if (/fantasy/.test(lower)) return "Fantasy Score";
  if (/pitcher out|outs recorded/.test(lower)) return "Pitcher Outs";

  switch (label) {
    case "Hits":
      return "Hits";
    case "Home Runs":
      return "Home Runs";
    case "RBIs":
      return "RBIs";
    case "Runs":
      return "Runs";
    case "Strikeouts":
    case "Pitcher Strikeouts":
      return "Strikeouts";
    case "Total Bases":
      return "Total Bases";
    default:
      return null;
  }
}

export function safeProjection(prop = {}, stat = null) {
  const propLabel = resolveSportsDataPropLabel(prop);
  if (!stat || !propLabel) return null;

  const games = stat?.Games ?? stat?.GamesPlayed ?? 0;
  const safeGames = games > 0 ? games : 1;
  let projection = null;

  switch (propLabel) {
    case "Hits":
      projection = (stat?.Hits || 0) / safeGames;
      break;
    case "Home Runs":
      projection = (stat?.HomeRuns || 0) / safeGames;
      break;
    case "RBIs":
      projection = (stat?.RunsBattedIn || 0) / safeGames;
      break;
    case "Runs":
      projection = (stat?.Runs || 0) / safeGames;
      break;
    case "Total Bases":
      projection = (stat?.TotalBases || 0) / safeGames;
      break;
    case "Strikeouts":
      projection = (stat?.PitchingStrikeouts || stat?.Strikeouts || 0) / safeGames;
      break;
    case "Walks":
    case "Walks Allowed":
      projection = (stat?.Walks || stat?.BaseOnBalls || 0) / safeGames;
      break;
    case "Fantasy Score":
      projection =
        (stat?.FantasyPointsDraftKings || stat?.FantasyPoints || stat?.FantasyPointsFanDuel || 0) / safeGames;
      break;
    case "Hits+Runs+RBIs":
      projection =
        ((stat?.Hits || 0) + (stat?.Runs || 0) + (stat?.RunsBattedIn || stat?.RBI || 0)) / safeGames;
      break;
    case "Pitcher Outs": {
      const ip = stat?.InningsPitchedDecimal ?? stat?.InningsPitched ?? 0;
      projection = (Number(ip) * 3) / safeGames;
      break;
    }
    case "Earned Runs":
      projection = (stat?.EarnedRuns || stat?.PitchingEarnedRuns || 0) / safeGames;
      break;
    case "Stolen Bases":
      projection = (stat?.StolenBases || 0) / safeGames;
      break;
    case "Doubles":
      projection = (stat?.Doubles || 0) / safeGames;
      break;
    case "Singles":
      projection = (stat?.Singles || 0) / safeGames;
      break;
    case "Hits Allowed":
      projection = (stat?.HitsAllowed || stat?.PitchingHits || 0) / safeGames;
      break;
    default:
      projection = null;
  }

  if (projection == null || Number.isNaN(projection) || !Number.isFinite(projection)) {
    return null;
  }

  return Number(projection.toFixed(2));
}

export function resolveRawStatFromSeasonRow(stat = {}, propLabel = "") {
  if (!stat || !propLabel) return null;
  switch (propLabel) {
    case "Hits":
      return pickField(stat, ["Hits", "Hit"]);
    case "Home Runs":
      return pickField(stat, ["HomeRuns", "HomeRun"]);
    case "RBIs":
      return pickField(stat, ["RunsBattedIn", "RBI", "RBIs"]);
    case "Runs":
      return pickField(stat, ["Runs", "Run"]);
    case "Strikeouts":
      return pickField(stat, ["PitchingStrikeouts", "Strikeouts", "StrikeOuts"]);
    case "Total Bases":
      return pickField(stat, ["TotalBases", "TotalBase"]);
    case "Walks":
    case "Walks Allowed":
      return pickField(stat, ["Walks", "BaseOnBalls"]);
    case "Fantasy Score":
      return pickField(stat, ["FantasyPointsDraftKings", "FantasyPoints", "FantasyPointsFanDuel"]);
    case "Hits+Runs+RBIs": {
      const hits = pickField(stat, ["Hits"]);
      const runs = pickField(stat, ["Runs"]);
      const rbis = pickField(stat, ["RunsBattedIn", "RBI", "RBIs"]);
      if (hits == null && runs == null && rbis == null) return null;
      return (hits || 0) + (runs || 0) + (rbis || 0);
    }
    case "Pitcher Outs":
      return pickField(stat, ["InningsPitchedDecimal", "InningsPitched"]);
    case "Earned Runs":
      return pickField(stat, ["EarnedRuns", "PitchingEarnedRuns"]);
    case "Stolen Bases":
      return pickField(stat, ["StolenBases"]);
    case "Doubles":
      return pickField(stat, ["Doubles"]);
    case "Singles":
      return pickField(stat, ["Singles"]);
    case "Hits Allowed":
      return pickField(stat, ["HitsAllowed", "PitchingHits"]);
    default:
      return null;
  }
}

export function resolveSeasonGames(stat = {}) {
  const gamesPlayed = pickField(stat, ["GamesPlayed", "Games"]);
  const appearances = pickField(stat, ["Appearances", "Started"]);
  const atBats = pickField(stat, ["AtBats", "AB"]);

  let games = gamesPlayed ?? appearances;
  if (games != null && games > 200) games = gamesPlayed;
  if (games != null && atBats != null && games > 200 && Math.abs(games - atBats) < 5) {
    games = gamesPlayed ?? appearances;
  }
  if (games != null && games > 0 && games <= 200) return games;
  if (appearances != null && appearances > 0 && appearances <= 200) return appearances;
  return games != null && games > 0 ? games : 1;
}

export function resolveProjectionComponents(stat = {}, propLabel = "") {
  if (!stat || !propLabel) return null;
  const games = resolveSeasonGames(stat);

  if (propLabel === "Hits+Runs+RBIs") {
    const hitsAvg = Number(((stat?.Hits || 0) / games).toFixed(4));
    const runsAvg = Number(((stat?.Runs || 0) / games).toFixed(4));
    const rbisAvg = Number(((stat?.RunsBattedIn || stat?.RBI || 0) / games).toFixed(4));
    return {
      hitsAvg,
      runsAvg,
      rbisAvg,
      finalProjection: Number((hitsAvg + runsAvg + rbisAvg).toFixed(4)),
      formula: "Hits/G + Runs/G + RBIs/G",
      gamesCount: games,
    };
  }

  const projection = safeProjection({ prop: propLabel, statType: propLabel }, stat);
  const rawTotal = resolveRawStatFromSeasonRow(stat, propLabel);
  return {
    rawTotal,
    perGameAverage: projection,
    finalProjection: projection,
    formula: `${propLabel}: season total ÷ games`,
    gamesCount: games,
  };
}

export function computePerGameProjectionFromSeasonRow(stat = {}, propLabel = "", prop = {}) {
  const projection = safeProjection({ prop: propLabel, statType: propLabel, ...prop }, stat);
  const rawStat = resolveRawStatFromSeasonRow(stat, propLabel);
  const games = resolveSeasonGames(stat);
  const components = resolveProjectionComponents(stat, propLabel);
  return {
    projection,
    rawStat,
    games,
    components,
    projectionSource: projection != null ? "sportsdataio-season" : "missing",
  };
}

export function findSeasonStatRow(seasonStats = [], { playerName = "", playerId = null } = {}) {
  if (!Array.isArray(seasonStats) || !seasonStats.length) return null;

  const normalizedId = normalizeMergeId(playerId);
  if (normalizedId) {
    const byId = seasonStats.find((row) => normalizeMergeId(row?.PlayerID) === normalizedId);
    if (byId) return byId;
  }

  const query = normalizeMatchName(playerName);
  if (!query) return null;

  let stat = seasonStats.find((row) => normalizeMatchName(row?.Name) === query);
  if (stat) return stat;

  stat = seasonStats.find((row) => playerNamesMatch(query, row?.Name));
  if (stat) return stat;

  stat = seasonStats.find((row) => {
    const candidate = normalizeMatchName(row?.Name);
    return candidate.includes(query) || query.includes(candidate);
  });

  return stat || null;
}

let projectionDebugCount = 0;

export function resetProjectionDebugCount() {
  projectionDebugCount = 0;
}

export function computeProjectionForProp(prop = {}, seasonStats = [], { logDebug = true } = {}) {
  const propLabel = resolveSportsDataPropLabel(prop);
  const playerName = String(prop.playerName || prop.player || "").trim();
  const stat = findSeasonStatRow(seasonStats, {
    playerName,
    playerId: prop.playerId ?? prop.sportsDataPlayerId,
  });

  const projection = safeProjection({ ...prop, prop: propLabel, statType: propLabel || prop.statType }, stat);
  const rawStat = stat && propLabel ? resolveRawStatFromSeasonRow(stat, propLabel) : null;
  const games = stat ? resolveSeasonGames(stat) : null;

  let matchReason = "matched";
  if (!stat) matchReason = "no stat row match";
  else if (!propLabel) matchReason = "unknown prop type";
  else if (projection == null) matchReason = "stat field missing for prop type";

  if (logDebug && projectionDebugCount < 20) {
    projectionDebugCount += 1;
    console.log({
      player: playerName,
      prop: propLabel || prop.statType || prop.prop,
      statExists: Boolean(stat),
      rawStat: stat || null,
      projection,
      matchReason,
    });
  }

  const components = stat && propLabel ? resolveProjectionComponents(stat, propLabel) : null;

  return {
    projection,
    rawStat,
    games,
    components,
    propLabel,
    team: stat?.Team || prop.team || "",
    matchReason,
    projectionSource: projection != null ? "sportsdataio-season" : "missing",
    formulaUsed: projection != null ? "SportsDataIO season totals ÷ games" : "",
    rawSportsDataFields: stat
      ? {
          Hits: stat.Hits,
          Runs: stat.Runs,
          RunsBattedIn: stat.RunsBattedIn ?? stat.RBI,
          TotalBases: stat.TotalBases,
          PitchingStrikeouts: stat.PitchingStrikeouts ?? stat.Strikeouts,
          HitsAllowed: stat.HitsAllowed ?? stat.PitchingHits,
          InningsPitchedDecimal: stat.InningsPitchedDecimal ?? stat.InningsPitched,
          FantasyPointsDraftKings: stat.FantasyPointsDraftKings ?? stat.FantasyPoints,
          HitsRunsRBIs: stat.HitsRunsRBIs,
          Games: stat.Games ?? stat.GamesPlayed,
        }
      : null,
  };
}

export function logSportsDataSample(_seasonStats = []) {}
