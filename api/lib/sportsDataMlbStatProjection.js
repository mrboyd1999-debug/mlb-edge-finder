/**
 * SportsDataIO MLB season-stat → per-game projection helpers.
 * Recovery mode: every valid prop gets a projection (stat-based or line * 0.95).
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

export function computeLineRecoveryProjection(prop = {}) {
  const line = Number(prop.line ?? prop.line_score ?? prop.lineScore);
  if (!Number.isFinite(line) || line <= 0) return null;
  return Number((line * 0.95).toFixed(2));
}

export function safeProjection(prop = {}, stat = null) {
  const propLabel = resolveSportsDataPropLabel(prop);
  const games = stat?.Games ?? stat?.GamesPlayed ?? 0;
  const safeGames = games > 0 ? games : 1;
  let projection = null;

  if (stat && propLabel) {
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
      default:
        projection = null;
    }
  }

  if (projection == null || Number.isNaN(projection) || !Number.isFinite(projection)) {
    return computeLineRecoveryProjection(prop);
  }

  return Number(projection.toFixed(2));
}

export function computePerGameProjectionFromSeasonRow(stat = {}, propLabel = "", prop = {}) {
  const projection = safeProjection({ prop: propLabel, statType: propLabel, ...prop }, stat);
  const rawStat = resolveRawStatFromSeasonRow(stat, propLabel);
  const games = resolveSeasonGames(stat);
  return {
    projection,
    rawStat,
    games,
    projectionSource: rawStat != null ? "sportsdataio-season" : "line-recovery",
  };
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
  const line = Number(prop.line ?? prop.line_score);
  const stat = findSeasonStatRow(seasonStats, {
    playerName,
    playerId: prop.playerId ?? prop.sportsDataPlayerId,
  });

  let projection = safeProjection({ ...prop, prop: propLabel, statType: propLabel || prop.statType }, stat);
  let matchReason = "matched";

  if (projection == null) {
    projection = computeLineRecoveryProjection(prop);
    matchReason = stat ? "line-recovery-after-stat" : "line-recovery-no-stat";
  } else if (!stat || !propLabel) {
    matchReason = !stat ? "line-recovery-no-stat-row" : "line-recovery-unknown-prop";
  } else if (resolveRawStatFromSeasonRow(stat, propLabel) == null) {
    matchReason = "line-recovery-missing-raw-stat";
  }

  const rawStat = stat && propLabel ? resolveRawStatFromSeasonRow(stat, propLabel) : null;
  const games = stat ? resolveSeasonGames(stat) : null;

  if (logDebug && projectionDebugCount < 20) {
    projectionDebugCount += 1;
    console.log({
      player: playerName,
      prop: propLabel || prop.statType || prop.prop,
      statExists: Boolean(stat),
      rawStat: stat || null,
      projection,
      line,
      matchReason,
    });
  }

  return {
    projection,
    rawStat,
    games,
    propLabel,
    team: stat?.Team || prop.team || "",
    matchReason,
    projectionSource: rawStat != null ? "sportsdataio-season" : "line-recovery",
  };
}

export function logSportsDataSample(seasonStats = []) {
  if (!Array.isArray(seasonStats) || !seasonStats.length) {
    console.log("SPORTSIO PLAYER SAMPLE:", "empty");
    return;
  }
  console.log("SPORTSIO PLAYER SAMPLE:", JSON.stringify(seasonStats[0], null, 2));
}
