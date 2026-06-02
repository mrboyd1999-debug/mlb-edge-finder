/**
 * Consistent betting edge messaging across screens.
 */

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export const POSITIVE_EDGE_MESSAGE = "Positive betting edge detected.";
export const NO_EDGE_MESSAGE =
  "No betting edge detected. More data needed before this becomes a confident pick.";

export function resolveBettingEdgeMessage(prop = {}) {
  const edge = finite(prop.edge ?? prop.rawEdge);
  const probability = finite(
    prop.calibratedProbability ??
      prop.probabilityScore ??
      prop.verifiedProbability ??
      prop.probabilityTruth?.calibratedProbability
  );
  const projection = finite(prop.projection ?? prop.projectedValue);
  const line = finite(prop.line);

  if (projection == null || line == null || line <= 0) {
    return NO_EDGE_MESSAGE;
  }

  if (edge != null && edge > 0 && probability != null && probability >= 60) {
    return POSITIVE_EDGE_MESSAGE;
  }

  if (edge != null && edge <= 0) {
    return NO_EDGE_MESSAGE;
  }

  if (probability != null && probability >= 60 && edge != null && edge > 0) {
    return POSITIVE_EDGE_MESSAGE;
  }

  return NO_EDGE_MESSAGE;
}

export function hasPositiveBettingEdge(prop = {}) {
  return resolveBettingEdgeMessage(prop) === POSITIVE_EDGE_MESSAGE;
}
