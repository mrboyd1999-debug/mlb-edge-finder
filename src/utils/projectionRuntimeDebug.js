/**
 * High-visibility runtime projection schema debugging.
 * Uses console.error so logs stand out in DevTools.
 */

function toProjectionArray(projections) {
  if (projections == null) return [];
  if (projections instanceof Map) return [...projections.values()];
  if (Array.isArray(projections)) return projections;
  if (typeof projections === "object") return [projections];
  return [];
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `[stringify failed: ${error?.message || error}]`;
  }
}

function previewRawResponse(rawResponse, maxLen = 2000) {
  if (rawResponse == null) return rawResponse;
  try {
    const text = typeof rawResponse === "string" ? rawResponse : safeStringify(rawResponse);
    return text.length > maxLen ? `${text.slice(0, maxLen)}…[truncated]` : text;
  } catch {
    return String(rawResponse);
  }
}

/**
 * @param {string} label - debug channel label
 * @param {unknown} projections - array, Map, or single projection object
 * @param {{ origin?: string, rawResponse?: unknown, meta?: Record<string, unknown> }} [options]
 */
export function emitProjectionDebug(label = "projection", projections, options = {}) {
  const { origin = "unknown", rawResponse, meta = {} } = options;
  const arr = toProjectionArray(projections);

  console.error("========== PROJECTION DEBUG ==========");
  console.error(`[${label}] ORIGIN FILE/FUNCTION:`, origin);
  console.error(`[${label}] projections is null/undefined:`, projections == null);
  console.error(`[${label}] typeof projections:`, typeof projections);
  console.error(`[${label}] Array.isArray(projections):`, Array.isArray(projections));
  console.error(`[${label}] projections instanceof Map:`, projections instanceof Map);
  console.error(`[${label}] PROJECTIONS TOTAL COUNT:`, arr.length);

  if (Object.keys(meta).length) {
    console.error(`[${label}] META:`, meta);
  }

  if (rawResponse !== undefined) {
    console.error(`[${label}] RAW API / FETCH RESPONSE:`, previewRawResponse(rawResponse));
  }

  if (!arr.length) {
    console.error(`[${label}] PROJECTION SAMPLE:`, undefined);
    console.error(`[${label}] PROJECTION FULL JSON:`, null);
    console.error(`[${label}] PROJECTION KEYS:`, []);
    console.error(`[${label}] EMPTY — projections became empty at:`, origin);
    console.error("========== END PROJECTION DEBUG ==========");
    return { origin, count: 0, first: null };
  }

  const first = arr[0];
  console.error(`[${label}] PROJECTION SAMPLE:`, first);
  console.error(`[${label}] PROJECTION FULL JSON:`, safeStringify(first));
  console.error(`[${label}] PROJECTION KEYS:`, Object.keys(first || {}));
  console.error("========== END PROJECTION DEBUG ==========");

  return { origin, count: arr.length, first };
}
