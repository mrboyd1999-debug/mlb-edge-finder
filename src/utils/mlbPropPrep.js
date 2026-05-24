/** Normalize props before ranking — matchup, projection, sport keys. */

import { ensureDisplayProjection } from "./displayPropScoring.js";
import { annotateProjectionFields } from "./projectionQuality.js";
import { normalizeSportLabel } from "./sportMappings.js";

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
  if (prop.matchup || (prop.team && prop.opponent)) {
    return { ...prop, matchup: prop.matchup || `${prop.team} vs ${prop.opponent}` };
  }

  const blob = [
    prop.description,
    prop.gameDescription,
    prop.matchupNote,
    prop.eventName,
    prop.gameTitle,
  ]
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

  return {
    ...prop,
    team: prop.team || "MLB",
    opponent: prop.opponent || "TBD",
    matchup: prop.matchup || "MLB slate",
  };
}

export function preparePropForRanking(prop = {}) {
  const withSport = normalizePropSportFields(prop);
  const withMatchup = ensureMatchupFields(withSport);
  const projection = ensureDisplayProjection(withMatchup);
  return annotateProjectionFields({
    ...withMatchup,
    projection,
    projectedValue: projection,
    projectionSource: withMatchup.projectionSource || "estimated",
    estimatedProjection: !withMatchup.projectionSource || withMatchup.projectionSource === "estimated",
  });
}

export function preparePropsForRanking(props = []) {
  return (props || []).map(preparePropForRanking);
}
