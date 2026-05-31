import { normalizeSource } from "./normalizeSource.js";
import { filterMlbPipelineSportProps } from "./mlbAllowedMarkets.js";

/** Dev-only: set window.__PIPELINE_BYPASS_PROJECTION__ = true to skip projection and render first 20 UD props. */
export function isPipelineBypassProjectionEnabled() {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.__PIPELINE_BYPASS_PROJECTION__ === true
  );
}

/** Dev-only: set window.__LIVE_BOARD_DIRECT_RENDER__ = true to render first 50 normalized props without filters. */
export function isLiveBoardDirectRenderEnabled() {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.__LIVE_BOARD_DIRECT_RENDER__ === true
  );
}

export function shouldUseLiveBoardDirectRender(normalizedCount = 0, combinedCount = 0) {
  if (isLiveBoardDirectRenderEnabled()) return normalizedCount > 0;
  return normalizedCount > 0 && combinedCount === 0;
}

export function countLiveProviderProps(props = []) {
  return (props || []).filter((prop) => {
    const src = normalizeSource(prop);
    if (src !== "underdog" && src !== "prizepicks") return false;
    if (prop.fromCache || prop.cacheLayer) return false;
    if (String(prop.lineSourceBadge || "").toUpperCase() === "CACHED") return false;
    return true;
  }).length;
}

export function logPipelineStageTrace(stages = {}) {
  console.log("NORMALIZED", stages.normalized ?? 0);
  console.log("COMBINED", stages.combined ?? 0);
  console.log("CANDIDATES", stages.candidates ?? 0);
  console.log("PROJECTED", stages.projected ?? 0);
  console.log("VERIFIED", stages.verified ?? 0);
  console.log("RENDERED", stages.rendered ?? 0);
}

export function logLiveBoardPipelineTrace(stages = {}) {
  console.log("LIVE NORMALIZED", stages.normalized ?? 0);
  console.log("LIVE PROVIDER", stages.provider ?? 0);
  console.log("LIVE COMBINED", stages.combined ?? 0);
  console.log("LIVE PROJECTED", stages.projected ?? 0);
  console.log("LIVE VERIFIED", stages.verified ?? 0);
  console.log("LIVE RENDERED", stages.rendered ?? 0);
}

export function pickUnderdogBypassRenderProps(normalizedPool = [], limit = 20) {
  return (normalizedPool || [])
    .filter((prop) => normalizeSource(prop) === "underdog")
    .slice(0, limit)
    .map((prop) => ({ ...prop, isLiveRenderProp: true }));
}

export function prepareLiveBoardDirectRenderProps(normalizedPool = [], limit = 120) {
  const live = (normalizedPool || []).filter((prop) => {
    const player = String(prop?.playerName || prop?.player || "").trim();
    const line = Number(prop?.line);
    return player.length >= 2 && Number.isFinite(line) && line > 0;
  });
  return live.slice(0, limit).map((prop) => ({
    ...prop,
    isLiveRenderProp: true,
    lineSourceBadge: prop.lineSourceBadge || "LIVE",
  }));
}

/** Recover board when buildMlbProjectionBoardPool drops normalized props to zero. */
export function recoverNormalizedBoardProps(normalizedPool = [], boardPool = {}) {
  if (boardPool?.boardProps?.length) return boardPool.boardProps;
  if (boardPool?.afterSportFilter?.length) return boardPool.afterSportFilter;
  if (boardPool?.afterDuplicateRemoval?.length) {
    return filterMlbPipelineSportProps(boardPool.afterDuplicateRemoval);
  }
  return filterMlbPipelineSportProps(normalizedPool);
}

export function buildBypassLiveRenderResult(props = []) {
  const count = props.length;
  return {
    props,
    counts: {
      fetched: count,
      normalized: count,
      rendered: count,
      filteredOut: 0,
    },
  };
}

export function buildLiveBoardPipelineTrace(stages = {}) {
  return {
    normalized: Number(stages.normalized ?? 0),
    provider: Number(stages.provider ?? 0),
    combined: Number(stages.combined ?? 0),
    projected: Number(stages.projected ?? 0),
    verified: Number(stages.verified ?? 0),
    rendered: Number(stages.rendered ?? 0),
    updatedAt: new Date().toISOString(),
  };
}
