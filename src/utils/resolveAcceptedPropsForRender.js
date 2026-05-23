import { sortDecisionBoard } from "../services/decisionEngine.js";

/** Props already accepted upstream — no re-qualification at render time. */
export function isUpstreamAcceptedProp(prop = {}) {
  if (!prop || typeof prop !== "object") return false;
  if (prop.isQualificationAccepted) return true;
  if (prop.displayTier === "ready") return true;
  if (prop.recommendationStatus === "ready") return true;
  const tier = String(prop.qualificationTier || "").toLowerCase();
  if (tier && tier !== "reject") return true;
  const label = String(prop.bettingLabel || "").toLowerCase();
  if (label.includes("elite") || label.includes("ready")) return true;
  return false;
}

/**
 * Single canonical accepted-props pool for UI — same source Prop Counters use.
 * Falls back through stored arrays, then props already marked accepted upstream.
 */
export function resolveAcceptedPropsForRender({
  acceptedPropsForRender = [],
  counterAcceptedSource = [],
  qualifiedReadyProps = [],
  allProps = [],
  acceptedCount = 0,
} = {}) {
  const pools = [acceptedPropsForRender, counterAcceptedSource, qualifiedReadyProps, allProps.filter(isUpstreamAcceptedProp)];

  for (const pool of pools) {
    const list = (pool || []).filter(Boolean);
    if (list.length) return sortDecisionBoard(list);
  }

  const count = Number(acceptedCount || 0);
  if (count > 0 && allProps.length) {
    const marked = sortDecisionBoard(allProps.filter(isUpstreamAcceptedProp));
    if (marked.length) return marked.slice(0, count);
  }

  return [];
}
