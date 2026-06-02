/**
 * Projection runtime debug hooks — logging disabled for production builds.
 * Call sites remain so pipeline instrumentation can be re-enabled in dev if needed.
 */

function toProjectionArray(projections) {
  if (projections == null) return [];
  if (projections instanceof Map) return [...projections.values()];
  if (Array.isArray(projections)) return projections;
  if (typeof projections === "object") return [projections];
  return [];
}

export function emitVisibleProjectionDebug(rawProjections, label = "") {
  void label;
  const projections = toProjectionArray(rawProjections);
  return { count: projections.length, first: projections[0] ?? null };
}

export function emitProjectionDebug(label = "projection", projections, options = {}) {
  void label;
  void options;
  const arr = toProjectionArray(projections);
  return { origin: options?.origin || "unknown", count: arr.length, first: arr[0] ?? null };
}

export function emitSportRoutingDebug(rows = []) {
  void rows;
}
