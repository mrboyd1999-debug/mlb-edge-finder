/**
 * Hard-fail tracing for projection data sources.
 * Used ONLY at fetch boundaries — not merge/UI.
 */

const TRACE_LABEL = "PROJECTION SOURCE TRACE";

export function logProjectionFetchStart(label, meta = {}) {
  console.error("PROJECTION FETCH START");
  console.error(`[${TRACE_LABEL}]`, label);
  console.error("URL:", meta.endpoint || meta.url || "—");
  console.error("META:", meta);
}

export function logProjectionFetchResult(label, { endpoint = "", status = null, data = null, error = null, count = null } = {}) {
  console.error("PROJECTION FETCH RESULT");
  console.error(`[${TRACE_LABEL}]`, label);
  console.error("URL:", endpoint || "—");
  console.error("RESPONSE STATUS:", status ?? "—");
  console.error("RESPONSE COUNT:", count ?? countProjectionRows(data));
  console.error("RAW RESPONSE:", safePreview(data));
  if (error) console.error("ERROR:", error);
}

export function assertProjectionDatasetNotEmpty(data, { label = "projection-fetch", endpoint = "", status = null, allowSkip = false } = {}) {
  if (allowSkip) return;
  const count = countProjectionRows(data);
  if (count > 0) return;
  const message = `Projection API returned empty dataset (${label})`;
  console.error("PROJECTION FETCH FAILED — EMPTY DATASET");
  console.error(`[${TRACE_LABEL}]`, label);
  console.error("URL:", endpoint || "—");
  console.error("RESPONSE STATUS:", status ?? "—");
  console.error("RAW RESPONSE:", safePreview(data));
  throw new Error(message);
}

export function countProjectionRows(data) {
  if (data == null) return 0;
  if (data instanceof Map) return data.size;
  if (Array.isArray(data)) return data.length;
  if (typeof data === "object" && Array.isArray(data.data)) return data.data.length;
  if (typeof data === "object" && data.stats instanceof Map) return data.stats.size;
  return 0;
}

function safePreview(value, maxLen = 2000) {
  if (value == null) return value;
  try {
    if (value instanceof Map) {
      return JSON.stringify([...value.entries()].slice(0, 3), null, 2);
    }
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text.length > maxLen ? `${text.slice(0, maxLen)}…[truncated]` : text;
  } catch (error) {
    return `[preview failed: ${error?.message || error}]`;
  }
}

export function traceProjectionExecutionPath(stage, details = {}) {
  console.error("PROJECTION EXECUTION PATH");
  console.error(`[${TRACE_LABEL}]`, stage, details);
}
