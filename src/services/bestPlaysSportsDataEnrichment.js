/**
 * Apply SportsDataIO season per-game projections to Best Plays candidate props.
 * Recovery mode: every prop with a line gets a projection (stat or line * 0.95).
 */

import {
  computeLineRecoveryProjection,
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
    const projection = computed.projection ?? computeLineRecoveryProjection(prop);
    if (projection == null) return prop;

    return {
      ...prop,
      projection,
      projectedValue: projection,
      projectionSource: prop.projectionSource || computed.projectionSource || "line-recovery",
      sportsDataPropLabel: computed.propLabel,
      sportsDataRawStat: computed.rawStat,
      sportsDataGames: computed.games,
      sportsDataMatchReason: computed.matchReason,
      games: prop.games ?? computed.games,
      team: prop.team || computed.team || "",
      isSportsDataSeasonProjection: computed.projectionSource === "sportsdataio-season",
      isLineRecoveryProjection: computed.projectionSource === "line-recovery",
    };
  });
}
