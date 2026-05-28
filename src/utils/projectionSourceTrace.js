/**
 * Projection fetch boundary tracing — throws on empty datasets; no console noise in production.
 */

export function logProjectionFetchStart(_label, _meta = {}) {}

export function logProjectionFetchResult(_label, _payload = {}) {}

export function assertProjectionDatasetNotEmpty(data, { label = "projection-fetch", endpoint = "", status = null, allowSkip = false } = {}) {
  if (allowSkip) return;
  const count = countProjectionRows(data);
  if (count > 0) return;
  throw new Error(`Projection API returned empty dataset (${label})`);
}

export function countProjectionRows(data) {
  if (data == null) return 0;
  if (data instanceof Map) return data.size;
  if (Array.isArray(data)) return data.length;
  if (typeof data === "object" && Array.isArray(data.data)) return data.data.length;
  if (typeof data === "object" && data.stats instanceof Map) return data.stats.size;
  return 0;
}

export function traceProjectionExecutionPath(_stage, _details = {}) {}
