export const PROJECTION_DATA_UNAVAILABLE_MESSAGE = "Projection data unavailable (provider failure)";

/** Clear false projection values when enrichment sources failed — do not show zeros. */
export function markProjectionDataUnavailable(props = [], reason = PROJECTION_DATA_UNAVAILABLE_MESSAGE) {
  return (props || []).map((prop) => ({
    ...prop,
    projection: null,
    projectedValue: null,
    projectionUnavailable: true,
    projectionSource: "unavailable",
    projectionUnavailableReason: reason,
  }));
}

export function hasUsableProjectionSources({ statsMap = null, seasonStats = [] } = {}) {
  const statsSize = statsMap instanceof Map ? statsMap.size : 0;
  const seasonRows = Array.isArray(seasonStats) ? seasonStats.length : 0;
  return statsSize > 0 || seasonRows > 0;
}
