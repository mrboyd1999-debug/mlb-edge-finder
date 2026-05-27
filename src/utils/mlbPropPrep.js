/** Normalize live props without fabricating lines or projections. */

import { annotateProjectionFields } from "./projectionQuality.js";
import { normalizeSportLabel } from "./sportMappings.js";
import { resolveProjectionValue } from "./projectionQuality.js";

export function normalizePropSportFields(prop = {}) {
  const sport = normalizeSportLabel(prop.sport || prop.league || prop.inferredSport || "", prop.league || "");
  return {
    ...prop,
    sport: sport || prop.sport || "MLB",
    league: sport || prop.league || "MLB",
    inferredSport: sport || prop.inferredSport || "MLB",
  };
}

export function ensureMatchupFields(prop = {}) {
  if (prop.matchup || (prop.team && prop.opponent && prop.opponent !== "TBD")) {
    return { ...prop, matchup: prop.matchup || `${prop.team} vs ${prop.opponent}` };
  }

  const blob = [prop.description, prop.gameDescription, prop.matchupNote, prop.eventName, prop.gameTitle]
    .filter(Boolean)
    .join(" ");

  const match = blob.match(/\b([A-Z]{2,4})\s*(?:@|vs\.?)\s*([A-Z]{2,4})\b/i);
  if (match) {
    return {
      ...prop,
      team: prop.team || match[1].toUpperCase(),
      opponent: prop.opponent || match[2].toUpperCase(),
      matchup: `${match[1].toUpperCase()} vs ${match[2].toUpperCase()}`,
    };
  }

  return prop.matchup || prop.team ? prop : { ...prop, matchup: prop.matchup || "" };
}

/** Live prep — preserves platform line; never invents projection. */
export function prepareLiveProp(prop = {}) {
  const withSport = normalizePropSportFields(prop);
  const withMatchup = ensureMatchupFields(withSport);
  const existing =
    resolveProjectionValue(withMatchup) ??
    (Number.isFinite(Number(withMatchup.last5Average)) && Number(withMatchup.last5Average) > 0
      ? Number(withMatchup.last5Average)
      : null) ??
    (Number.isFinite(Number(withMatchup.seasonAverage)) && Number(withMatchup.seasonAverage) > 0
      ? Number(withMatchup.seasonAverage)
      : null);

  return annotateProjectionFields({
    ...withMatchup,
    projection: existing ?? withMatchup.projection ?? null,
    projectedValue: existing ?? withMatchup.projectedValue ?? null,
    projectionSource:
      withMatchup.projectionSource ||
      (existing ? withMatchup.projectionSource || "merged" : "missing"),
    estimatedProjection: Boolean(withMatchup.estimatedProjection),
    isLiveLine: !withMatchup.isDemoData,
    projectionUnavailable: !(Number.isFinite(existing) && existing > 0),
  });
}

export function prepareLiveProps(props = []) {
  return (props || []).map(prepareLiveProp);
}

import { ensureDisplayProjection } from "./displayPropScoring.js";

/** @deprecated synthetic prep for emergency demo path only */
export function preparePropsForRanking(props = [], { synthetic = false } = {}) {
  if (!synthetic) return prepareLiveProps(props);
  return props.map((prop) => {
    const live = prepareLiveProp(prop);
    if (resolveProjectionValue(live) != null) return live;
    const projection = ensureDisplayProjection(live);
    return annotateProjectionFields({
      ...live,
      projection,
      projectedValue: projection,
      projectionSource: "estimated",
      estimatedProjection: true,
    });
  });
}
