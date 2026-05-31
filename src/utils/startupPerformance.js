/**
 * Startup performance limits — fast first paint, defer heavy work.
 */

import { resolvePropSport } from "./mlbOnlyMode.js";
import { isBlockedNonMlbPipelineProp } from "./mlbAllowedMarkets.js";
import { resolveEngineProjectedPool } from "./projectionPipelineStatus.js";

export const STARTUP_NORMALIZED_PROP_LIMIT = 300;
export const STARTUP_PROJECTION_CANDIDATE_LIMIT = 120;
export const STARTUP_BACKGROUND_BATCH_SIZE = 200;

export const PERFORMANCE_TIMERS = {
  loadCachedBoard: "loadCachedBoard",
  refreshProviders: "refreshProviders",
  fetchFeeds: "fetchFeeds",
  normalizeProps: "normalizeProps",
  generateProjections: "generateProjections",
  verifyPlays: "verifyPlays",
  renderDashboard: "renderDashboard",
};

export function beginPerformanceTimer(label) {
  if (typeof console.time === "function") console.time(label);
}

export function endPerformanceTimer(label) {
  if (typeof console.timeEnd === "function") {
    try {
      console.timeEnd(label);
    } catch {
      // timer may not exist if begin was skipped
    }
  }
}

export function isStartupMlbSportProp(prop = {}) {
  if (resolvePropSport(prop) !== "MLB") return false;
  if (isBlockedNonMlbPipelineProp(prop)) return false;
  return true;
}

/** @deprecated alias — sport gate only; markets do not block startup pool. */
export function isStartupMlbSupportedProp(prop = {}) {
  return isStartupMlbSportProp(prop);
}

/** MLB + supported markets, capped for startup processing. */
export function limitStartupPropPool(props = [], limit = STARTUP_NORMALIZED_PROP_LIMIT) {
  const pool = (props || []).filter(isStartupMlbSupportedProp);
  return {
    startupProps: pool.slice(0, limit),
    deferredProps: pool.slice(limit),
    totalEligible: pool.length,
  };
}

/** Top projection candidates for startup ranking (same resolver as System Status). */
export function selectStartupProjectionCandidates(
  props = [],
  limit = STARTUP_PROJECTION_CANDIDATE_LIMIT
) {
  return resolveEngineProjectedPool(props).slice(0, limit);
}

export function scheduleBackgroundWork(work, { delayMs = 120 } = {}) {
  if (typeof work !== "function") return;
  const run = () => {
    try {
      work();
    } catch (error) {
      console.warn("[Startup Performance] background work failed", error);
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => run(), { timeout: Math.max(delayMs, 500) });
    return;
  }
  window.setTimeout(run, delayMs);
}
