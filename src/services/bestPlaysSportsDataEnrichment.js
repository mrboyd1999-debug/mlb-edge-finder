/**
 * Apply SportsDataIO season projections — no fabricated fallbacks.
 */

import {
  computeProjectionForProp,
  logSportsDataSample,
  resetProjectionDebugCount,
} from "../../api/lib/sportsDataMlbStatProjection.js";
import { sanitizeProjectionValue } from "../utils/bestPlaysPipelineDebug.js";

export function enrichPropsWithSportsDataMlbProjections(props = [], seasonStats = []) {
  if (!Array.isArray(props) || !props.length) return props || [];

  if (Array.isArray(seasonStats) && seasonStats.length) {
    logSportsDataSample(seasonStats);
  }
  resetProjectionDebugCount();

  return props.map((prop) => {
    const existing = sanitizeProjectionValue(prop.projection ?? prop.projectedValue);
    if (existing != null) return prop;

    const computed = computeProjectionForProp(prop, seasonStats || []);
    if (computed.projection == null) {
      return {
        ...prop,
        sportsDataMatchReason: computed.matchReason,
        sportsDataPropLabel: computed.propLabel,
        projectionMissingReason: computed.matchReason,
      };
    }

    return {
      ...prop,
      projection: computed.projection,
      projectedValue: computed.projection,
      projectionSource: prop.projectionSource || computed.projectionSource || "sportsdataio-season",
      sportsDataPropLabel: computed.propLabel,
      sportsDataRawStat: computed.rawStat,
      sportsDataGames: computed.games,
      games: prop.games ?? computed.games,
      team: prop.team || computed.team || "",
      isSportsDataSeasonProjection: true,
    };
  });
}
