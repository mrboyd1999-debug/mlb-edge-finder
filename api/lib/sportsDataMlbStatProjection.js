/**
 * SportsDataIO MLB season-stat → per-game projection helpers.
 */

export function normalizeMatchName(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  if (/(^|\s)runs(\s|$)|runs scored/.test(lower) && !/rbi/.test(lower)) return "Runs";
  if (/hit/.test(lower) && !/allowed|pitch/.test(lower)) return "Hits";
  if (/walk/.test(lower)) return "Walks";
  if (/hits allowed/.test(lower)) return "Hits Allowed";

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
    case "Hits+Runs+RBIs":
      return pickField(stat, ["HitsRunsRBIs", "HitsPlusRunsPlusRBIs"]);
    case "Walks":
      return pickField(stat, ["PitchingWalks", "Walks", "WalksAllowed"]);
    case "Hits Allowed":
      return pickField(stat, ["PitchingHits", "HitsAllowed"]);
    default:
      return null;
  }
}

export function resolveSeasonGames(stat = {}) {
  const games = pickField(stat, ["Games", "GamesPlayed", "Appearances", "Started"]);
  return games != null && games > 0 ? games : 1;
}

export function computePerGameProjectionFromSeasonRow(stat = {}, propLabel = "") {
  const rawStat = resolveRawStatFromSeasonRow(stat, propLabel);
  if (rawStat === undefined || rawStat === null) return { projection: null, rawStat: null, games: null };

  const games = resolveSeasonGames(stat);
  let projection = rawStat / games;
  projection = Number(projection.toFixed(2));

  if (Number.isNaN(projection) || !Number.isFinite(projection) || projection <= 0) {
    return { projection: null, rawStat, games };
  }

  return { projection, rawStat, games };
}

export function findSeasonStatRow(seasonStats = [], { playerName = "", playerId = null } = {}) {
  if (!Array.isArray(seasonStats) || !seasonStats.length) return null;

  if (playerId != null) {
    const byId = seasonStats.find((row) => Number(row?.PlayerID) === Number(playerId));
    if (byId) return byId;
  }

  const query = normalizeMatchName(playerName);
  if (!query) return null;

  let stat = seasonStats.find((row) => normalizeMatchName(row?.Name) === query);
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

  if (!stat || !propLabel) {
    return {
      projection: null,
      rawStat: null,
      games: null,
      propLabel,
      matchReason: !stat ? "no stat row match" : "unknown prop type",
    };
  }

  const { projection, rawStat, games } = computePerGameProjectionFromSeasonRow(stat, propLabel);

  if (logDebug && projectionDebugCount < 10) {
    projectionDebugCount += 1;
    console.log({
      player: playerName,
      prop: propLabel,
      rawStat,
      games: stat.Games ?? games,
      projection,
      statFields: {
        Hits: stat.Hits,
        HomeRuns: stat.HomeRuns,
        RunsBattedIn: stat.RunsBattedIn,
        Runs: stat.Runs,
        PitchingStrikeouts: stat.PitchingStrikeouts,
        TotalBases: stat.TotalBases,
      },
    });
  }

  return {
    projection,
    rawStat,
    games,
    propLabel,
    team: stat.Team || prop.team || "",
    matchReason: projection != null ? "matched" : "invalid projection value",
  };
}

export function logSportsDataSample(seasonStats = []) {
  if (!Array.isArray(seasonStats) || !seasonStats.length) {
    console.log("SPORTSIO PLAYER SAMPLE:", "empty");
    return;
  }
  console.log("SPORTSIO PLAYER SAMPLE:", JSON.stringify(seasonStats[0], null, 2));
}
