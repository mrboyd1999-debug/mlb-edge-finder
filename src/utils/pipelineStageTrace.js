import { normalizeSource } from "./normalizeSource.js";

/** Dev-only: set window.__PIPELINE_BYPASS_PROJECTION__ = true to skip projection and render first 20 UD props. */
export function isPipelineBypassProjectionEnabled() {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.__PIPELINE_BYPASS_PROJECTION__ === true
  );
}

export function logPipelineStageTrace(stages = {}) {
  console.log("NORMALIZED", stages.normalized ?? 0);
  console.log("COMBINED", stages.combined ?? 0);
  console.log("CANDIDATES", stages.candidates ?? 0);
  console.log("PROJECTED", stages.projected ?? 0);
  console.log("VERIFIED", stages.verified ?? 0);
  console.log("RENDERED", stages.rendered ?? 0);
}

export function pickUnderdogBypassRenderProps(normalizedPool = [], limit = 20) {
  return (normalizedPool || [])
    .filter((prop) => normalizeSource(prop) === "underdog")
    .slice(0, limit)
    .map((prop) => ({ ...prop, isLiveRenderProp: true }));
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
