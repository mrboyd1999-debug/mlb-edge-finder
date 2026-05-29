/** Normalize live props without fabricating lines or projections. */

import { annotateProjectionFields, resolveProjectionValue } from "./projectionQuality.js";
import { normalizeSportLabel } from "./sportMappings.js";
import { enrichPropWithTeamLookup } from "./teamEnrichment.js";
import { enrichPropWithMatchupFallback } from "./matchupEnrichment.js";
import { ensureDisplayProjection } from "./displayPropScoring.js";

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
  const withMatchupFallback = enrichPropWithMatchupFallback(withTeam);
  const existing =
    resolveProjectionValue(withMatchupFallback) ??
    (Number.isFinite(Number(withMatchupFallback.last5Average)) && Number(withMatchupFallback.last5Average) > 0
      ? Number(withMatchupFallback.last5Average)
      : null) ??
    (Number.isFinite(Number(withMatchupFallback.seasonAverage)) && Number(withMatchupFallback.seasonAverage) > 0
      ? Number(withMatchupFallback.seasonAverage)
      : null);

  return annotateProjectionFields({
    ...withMatchupFallback,
    projection: existing ?? withMatchupFallback.projection ?? null,
    projectedValue: existing ?? withMatchupFallback.projectedValue ?? null,
    projectionSource:
      withMatchupFallback.projectionSource ||
      (existing ? withMatchupFallback.projectionSource || "merged" : "missing"),
    estimatedProjection: Boolean(withMatchupFallback.estimatedProjection),
    isLiveLine: !withMatchupFallback.isDemoData,
    projectionUnavailable: !(Number.isFinite(existing) && existing > 0),
  });
}

export function prepareLiveProps(props = [], context = {}) {
  return (props || []).map((prop) => prepareLiveProp(prop, context));
}

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
