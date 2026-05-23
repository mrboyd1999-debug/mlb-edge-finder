import { sortDecisionBoard } from "../services/decisionEngine.js";

/** Props already accepted upstream — no re-qualification at render time. */
export function isUpstreamAcceptedProp(prop = {}) {
  if (!prop || typeof prop !== "object") return false;
  if (prop.accepted === true || prop.pipelineAccepted === true || prop.qualified === true) return true;
  if (String(prop.status || "").toLowerCase() === "accepted") return true;
  if (prop.isQualificationAccepted) return true;
  if (prop.displayTier === "ready") return true;
  if (prop.recommendationStatus === "ready") return true;
  const tier = String(prop.qualificationTier || "").toLowerCase();
  if (tier && tier !== "reject") return true;
  const label = String(prop.bettingLabel || "").toLowerCase();
  if (label.includes("elite") || label.includes("ready")) return true;
  return false;
}

function confidenceValue(prop = {}) {
  return Number(prop.confidenceScore ?? prop.confidence ?? prop.calibratedConfidence ?? 0);
}

function weightedScoreValue(prop = {}) {
  return Number(prop.weightedScore ?? prop.confidenceScore ?? prop.confidence ?? 0);
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

  const acceptedRenderableProps = hydrated.filter(isUpstreamAcceptedProp);
  if (acceptedRenderableProps.length) {
    return sortDecisionBoard(acceptedRenderableProps).slice(0, Math.max(acceptedRenderableProps.length, Number(acceptedCount) || 30));
  }

  const matched = matchHydratedFromPipeline(hydrated, pipelineAcceptedPools);
  if (matched.length) {
    return sortDecisionBoard(matched).slice(0, Math.max(matched.length, Number(acceptedCount) || 30));
  }

  const limit = Math.max(5, Number(acceptedCount) || 5);
  return [...hydrated]
    .sort((a, b) => confidenceValue(b) - confidenceValue(a) || weightedScoreValue(b) - weightedScoreValue(a))
    .slice(0, limit);
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
  return [...(finalAcceptedProps || [])]
    .filter(Boolean)
    .sort((a, b) => weightedScoreValue(b) - weightedScoreValue(a) || confidenceValue(b) - confidenceValue(a))
    .slice(0, limit);
}
