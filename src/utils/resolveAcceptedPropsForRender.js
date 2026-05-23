import { sortDecisionBoard } from "../services/decisionEngine.js";
import { selectTopPicks } from "../services/topPicksSelection.js";
import {
  comparePropQuality,
  filterAcceptedQualityProps,
  filterTopPickQualityProps,
  meetsAcceptedPropQuality,
} from "../services/propQualityGates.js";

/** Props already accepted upstream — no re-qualification at render time. */
export function isUpstreamAcceptedProp(prop = {}) {
  if (!prop || typeof prop !== "object") return false;
  if (!meetsAcceptedPropQuality(prop)) return false;
  if (prop.accepted === true || prop.pipelineAccepted === true || prop.qualified === true) return true;
  if (String(prop.status || "").toLowerCase() === "accepted") return true;
  if (prop.isQualificationAccepted) return true;
  if (prop.displayTier === "ready") return true;
  if (prop.recommendationStatus === "ready") return true;
  const tier = String(prop.qualificationTier || "").toLowerCase();
  if (tier && tier !== "reject" && tier !== "watchlist") return true;
  const label = String(prop.bettingLabel || "").toLowerCase();
  if (label.includes("elite") || label.includes("ready")) return true;
  return false;
}

function matchHydratedFromPipeline(hydrated = [], pipelinePools = []) {
  const ids = new Set();
  pipelinePools.flat().filter(Boolean).forEach((prop) => {
    if (prop.id) ids.add(prop.id);
  });
  if (!ids.size) return [];
  return hydrated.filter((prop) => prop?.id && ids.has(prop.id));
}

/**
 * Build accepted props from the same hydrated board Best Value uses.
 * Matches pipeline-accepted IDs to live hydrated objects before any fallback.
 */
export function resolveFinalAcceptedPropsFromHydrated({
  hydratedRenderableProps = [],
  pipelineAcceptedPools = [],
  acceptedCount = 0,
} = {}) {
  const hydrated = (hydratedRenderableProps || []).filter(Boolean);
  if (!hydrated.length) return [];

  const limit = Math.max(5, Math.min(20, Number(acceptedCount) || 20));
  const acceptedRenderableProps = hydrated.filter(isUpstreamAcceptedProp);
  if (acceptedRenderableProps.length) {
    return sortDecisionBoard(filterAcceptedQualityProps(acceptedRenderableProps)).slice(0, limit);
  }

  const matched = matchHydratedFromPipeline(hydrated, pipelineAcceptedPools).filter(meetsAcceptedPropQuality);
  if (matched.length) {
    return sortDecisionBoard(matched).slice(0, limit);
  }

  return filterAcceptedQualityProps(hydrated).slice(0, Math.min(limit, 20));
}

/** @deprecated use resolveFinalAcceptedPropsFromHydrated */
export function resolveAcceptedPropsForRender(options = {}) {
  return resolveFinalAcceptedPropsFromHydrated({
    hydratedRenderableProps: options.allProps || [],
    pipelineAcceptedPools: [options.acceptedPropsForRender, options.counterAcceptedSource, options.qualifiedReadyProps],
    acceptedCount: options.acceptedCount,
  });
}

export function selectTopPicksFromAccepted(finalAcceptedProps = [], limit = 2) {
  const pool = (finalAcceptedProps || []).filter(Boolean).filter(meetsAcceptedPropQuality);
  const ranked = filterTopPickQualityProps(pool, limit);
  if (ranked.length >= limit) return ranked;
  const fallback = selectTopPicks(pool, limit);
  if (fallback.length) return fallback;
  return [...pool].sort(comparePropQuality).slice(0, limit);
}
