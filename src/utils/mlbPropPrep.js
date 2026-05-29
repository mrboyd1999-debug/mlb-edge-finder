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
export function prepareLiveProp(prop = {}, context = {}) {
  const withSport = normalizePropSportFields(prop);
  const withMatchup = ensureMatchupFields(withSport);
  const withTeam = enrichPropWithTeamLookup(withMatchup, context);
  const existing =
    resolveProjectionValue(withTeam) ??
    (Number.isFinite(Number(withTeam.last5Average)) && Number(withTeam.last5Average) > 0
      ? Number(withTeam.last5Average)
      : null) ??
    (Number.isFinite(Number(withTeam.seasonAverage)) && Number(withTeam.seasonAverage) > 0
      ? Number(withTeam.seasonAverage)
      : null);

  return annotateProjectionFields({
    ...withTeam,
    projection: existing ?? withTeam.projection ?? null,
    projectedValue: existing ?? withTeam.projectedValue ?? null,
    projectionSource:
      withTeam.projectionSource ||
      (existing ? withTeam.projectionSource || "merged" : "missing"),
    estimatedProjection: Boolean(withTeam.estimatedProjection),
    isLiveLine: !withTeam.isDemoData,
    projectionUnavailable: !(Number.isFinite(existing) && existing > 0),
  });
}

export function prepareLiveProps(props = []) {
  return (props || []).map(prepareLiveProp);
}

import { enrichPropWithTeamLookup } from "./teamEnrichment.js";

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
