/** Canonical prop shape + usability checks for source health. */

import { lockSportFromStatType } from "./propStatSportLock.js";
import { detectPropSport } from "./sportDetection.js";

export function normalizePropShape(prop = {}, defaults = {}) {
  const platform = String(prop.platform || prop.feedSource || defaults.platform || defaults.source || "").trim();
  const market = String(prop.market || prop.statType || prop.propType || "").trim();
  const playerName = String(prop.playerName || "").trim();
  const detected = detectPropSport(prop);
  const sport = String(detected.sport || prop.sport || defaults.sport || "").trim();
  const line = Number(prop.line);
  const id =
    prop.id ||
    prop.sourceId ||
    [platform, playerName, market, line, prop.side || prop.pick || ""].filter(Boolean).join("|").toLowerCase();

  return {
    ...prop,
    id,
    source: String(prop.source || platform || defaults.source || "").trim(),
    sport,
    league: String(prop.league || sport || "").trim(),
    playerName,
    team: prop.team || "",
    opponent: prop.opponent || "",
    market,
    statType: prop.statType || market,
    propType: prop.propType || market || "Prop",
    line: Number.isFinite(line) ? line : prop.line,
    side: prop.side || prop.pick || "",
    startTime: prop.startTime || "",
    projection: prop.projection ?? prop.projectedValue ?? null,
    confidence: prop.confidence ?? prop.confidenceScore ?? null,
    score: prop.score ?? prop.weightedScore ?? prop.dataQualityScore ?? null,
    platform,
  };
}

export function isUsableParsedProp(prop = {}) {
  if (!prop || typeof prop !== "object") return false;
  const shaped = normalizePropShape(prop);
  const line = Number(shaped.line);
  let sportOrLeague = shaped.sport || shaped.league;
  if (!sportOrLeague) {
    sportOrLeague = detectPropSport(shaped).sport || lockSportFromStatType(shaped.market || shaped.statType || "");
  }
  return (
    shaped.playerName.length >= 2 &&
    Boolean(sportOrLeague) &&
    Boolean(shaped.market) &&
    Number.isFinite(line) &&
    line > 0 &&
    Boolean(shaped.source || shaped.platform)
  );
}

export function countUsableProps(props = []) {
  if (!Array.isArray(props)) return 0;
  return props.filter(isUsableParsedProp).length;
}
