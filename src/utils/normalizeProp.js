import { normalizeSource } from "./normalizeSource.js";

function finiteOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Canonical card shape — optional projection/confidence/edge. */
export function normalizeProp(prop = {}) {
  const player = String(prop.playerName || prop.player || "").trim();
  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  const line = finiteOrNull(prop.line);
  const projectionRaw = prop.projection ?? prop.projectedValue;
  const projection =
    projectionRaw != null && projectionRaw !== "" && Number(projectionRaw) > 0
      ? finiteOrNull(projectionRaw)
      : null;
  const edge = finiteOrNull(prop.edge);
  const confidenceRaw = prop.confidence ?? prop.confidenceScore;
  const confidence =
    confidenceRaw != null && confidenceRaw !== "" ? finiteOrNull(confidenceRaw) : null;
  const sportsbook = normalizeSource(prop) || String(prop.platform || prop.source || "").trim();

  return {
    player,
    playerName: player,
    team: String(prop.team || "").trim(),
    opponent: String(prop.opponent || "").trim(),
    statType,
    market: statType,
    propType: statType,
    line,
    projection,
    projectedValue: projection,
    edge,
    confidence,
    confidenceScore: confidence,
    sportsbook,
    platform: sportsbook,
    source: sportsbook,
    overOdds: finiteOrNull(prop.overOdds ?? prop.over_odds),
    underOdds: finiteOrNull(prop.underOdds ?? prop.under_odds),
  };
}

export function isMinimalRenderableProp(prop = {}) {
  const shaped = normalizeProp(prop);
  return (
    shaped.player.length >= 2 &&
    shaped.statType.length >= 1 &&
    Number.isFinite(shaped.line) &&
    shaped.line > 0
  );
}

export function mergeNormalizedProp(prop = {}) {
  return { ...prop, ...normalizeProp(prop) };
}
