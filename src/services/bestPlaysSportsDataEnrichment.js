/**
 * Apply SportsDataIO season projections — no fabricated fallbacks.
 */

import {
  computeProjectionForProp,
  logSportsDataSample,
  resetProjectionDebugCount,
} from "../../api/lib/sportsDataMlbStatProjection.js";
import { resolveMLBTeam } from "./mlb/mlbPlayerDatabase.js";
import { sanitizeProjectionValue } from "../utils/bestPlaysPipelineDebug.js";

export function enrichPropsWithSportsDataMlbProjections(props = [], seasonStats = []) {
  if (!Array.isArray(props) || !props.length) return props || [];

  if (Array.isArray(seasonStats) && seasonStats.length) {
    logSportsDataSample(seasonStats);
  }
  resetProjectionDebugCount();

  return props.map((prop) => {
    const teamResolved = resolveMLBTeam(prop.playerName || prop.player, { prop, seasonStats });
    const withTeam = teamResolved.team ? { ...prop, team: teamResolved.team, teamSource: teamResolved.source } : prop;

    const existing = sanitizeProjectionValue(withTeam.projection ?? withTeam.projectedValue);
    if (existing != null) return withTeam;

    const computed = computeProjectionForProp(withTeam, seasonStats || []);
    if (computed.projection == null || computed.projection <= 0) {
      return {
        ...withTeam,
        sportsDataMatchReason: computed.matchReason,
        sportsDataPropLabel: computed.propLabel,
        projectionMissingReason: computed.matchReason,
      };
    }

    return {
      ...withTeam,
      projection: computed.projection,
      projectedValue: computed.projection,
      projectionSource: withTeam.projectionSource || computed.projectionSource || "sportsdataio-season",
      sportsDataPropLabel: computed.propLabel,
      sportsDataRawStat: computed.rawStat,
      sportsDataGames: computed.games,
      sportsDataRawFields: computed.rawSportsDataFields,
      projectionComponents: computed.components,
      projectionFormulaUsed: computed.formulaUsed,
      games: withTeam.games ?? computed.games,
      team: withTeam.team || computed.team || "",
      isSportsDataSeasonProjection: true,
    };
  });
}
