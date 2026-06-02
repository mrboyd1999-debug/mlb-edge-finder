/**
 * Pre-projection filter + rank — cap engine work for fast Best Plays paint.
 */

import { buildMlbProjectionBoardPool } from "./pipelinePropCountAudit.js";
import { resolveSupportedMlbMarketKey } from "./mlbAllowedMarkets.js";
import { isUpcomingSlateProp } from "./slateFilter.js";
import { getStaleFilterReason } from "./stalePropFilter.js";

export const MAX_PROJECTION_PROPS = 250;

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Higher = project sooner. Available line, supported market, active slate game. */
export function rankPropForProjectionPriority(prop = {}) {
  let score = 0;
  const line = Number(prop.line);
  if (Number.isFinite(line) && line > 0) score += 1000;
  if (resolveSupportedMlbMarketKey(prop)) score += 500;
  if (isUpcomingSlateProp(prop)) score += 200;
  const start = new Date(prop.startTime).getTime();
  if (Number.isFinite(start)) {
    const hoursUntil = (start - Date.now()) / 3600000;
    if (hoursUntil >= 0 && hoursUntil <= 48) score += Math.max(0, 150 - hoursUntil * 3);
  }
  return score;
}

/**
 * MLB-only pool: dedupe, drop suspended/unavailable/missing player+line, rank, cap.
 */
export function prepareProjectionHotPath(props = [], limit = MAX_PROJECTION_PROPS, filterOptions = {}) {
  const filterStart = nowMs();
  const pool = buildMlbProjectionBoardPool(props);
  const availabilityFiltered = pool.projectionCandidates.filter(
    (prop) => !getStaleFilterReason(prop, filterOptions)
  );
  const ranked = [...availabilityFiltered].sort(
    (a, b) => rankPropForProjectionPriority(b) - rankPropForProjectionPriority(a)
  );
  const hot = ranked.slice(0, limit);
  const deferred = ranked.slice(limit);
  const filterRuntimeMs = Math.round(nowMs() - filterStart);

  return {
    hot,
    deferred,
    filterRuntimeMs,
    pool,
    stats: {
      input: props.length,
      afterPool: pool.boardProps.length,
      candidates: pool.projectionCandidates.length,
      afterAvailability: availabilityFiltered.length,
      hot: hot.length,
      deferred: deferred.length,
      limit,
      rejections: pool.rejections,
    },
  };
}
