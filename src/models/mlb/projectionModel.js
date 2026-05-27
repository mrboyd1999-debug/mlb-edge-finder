/** Standard MLB projection object shape used across the pipeline. */

export function createMlbProjection({
  player = "",
  team = "",
  opponent = "",
  statType = "",
  line = null,
  projection = null,
  edge = null,
  confidence = null,
  hitRate = null,
  odds = null,
  matchupScore = null,
  dataQuality = null,
  timestamp = new Date().toISOString(),
  meta = {},
} = {}) {
  return {
    player: String(player || "").trim(),
    team: String(team || "").trim(),
    opponent: String(opponent || "").trim(),
    statType: String(statType || "").trim(),
    line: Number.isFinite(Number(line)) ? Number(line) : null,
    projection: Number.isFinite(Number(projection)) ? Number(projection) : null,
    edge: Number.isFinite(Number(edge)) ? Number(edge) : null,
    confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
    hitRate: Number.isFinite(Number(hitRate)) ? Number(hitRate) : null,
    odds: odds ?? null,
    matchupScore: Number.isFinite(Number(matchupScore)) ? Number(matchupScore) : null,
    dataQuality: dataQuality ?? null,
    timestamp,
    ...meta,
  };
}

export function isValidMlbProjectionRow(row = {}) {
  return Boolean(row.player) && Number.isFinite(Number(row.line)) && Number(row.line) > 0;
}

export function attachProjectionToProp(prop = {}, projectionRow = {}) {
  return {
    ...prop,
    ...projectionRow,
    playerName: prop.playerName || projectionRow.player,
    projectedValue: projectionRow.projection ?? prop.projectedValue,
  };
}
