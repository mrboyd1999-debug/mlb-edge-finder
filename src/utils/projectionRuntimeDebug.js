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

/** Exact banner format — call only after a successful fetch with data. */
export function emitVisibleProjectionDebug(rawProjections, label = "") {
  const projections = toProjectionArray(rawProjections);
  if (!projections.length) return { count: 0, first: null };

  if (label) {
    console.error(`[${label}]`);
  }
  console.error("########## PROJECTION DEBUG START ##########");
  console.error("PROJECTION COUNT:", projections?.length);
  console.error("FIRST PROJECTION:", projections?.[0]);
  console.error("FIRST PROJECTION JSON:", JSON.stringify(projections?.[0], null, 2));
  console.error("########## PROJECTION DEBUG END ##########");

  return { count: projections.length, first: projections[0] };
}

/**
 * @param {string} label - debug channel label
 * @param {unknown} projections - array, Map, or single projection object
 * @param {{ origin?: string, rawResponse?: unknown, meta?: Record<string, unknown>, successOnly?: boolean }} [options]
 */
export function emitProjectionDebug(label = "projection", projections, options = {}) {
  const { origin = "unknown", rawResponse, meta = {}, successOnly = false } = options;
  const arr = toProjectionArray(projections);

  if (successOnly && arr.length > 0) {
    emitVisibleProjectionDebug(arr, `${label} @ ${origin}`);
    return { origin, count: arr.length, first: arr[0] };
  }

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

  emitVisibleProjectionDebug(arr, `${label} @ ${origin}`);
  console.error(`[${label}] PROJECTION KEYS:`, Object.keys(arr[0] || {}));
  console.error("========== END PROJECTION DEBUG ==========");

  return { origin, count: arr.length, first: arr[0] };
}

/** Log sport routing decisions and projection fetch results per league. */
export function emitSportRoutingDebug(rows = []) {
  const plan = Array.isArray(rows) ? rows : [rows];
  if (!plan.length) return;

  console.error("########## SPORT ROUTING DEBUG START ##########");
  plan.forEach((row) => {
    console.error("DETECTED SPORT:", row.sport || "—");
    console.error("DETECTED LEAGUE:", row.league || row.sport || "—");
    console.error("PROJECTION ENDPOINT:", row.endpoint || "—");
    console.error("PROP COUNT:", row.propCount ?? "—");
    console.error("PROJECTION RESPONSE COUNT:", row.projectionCount ?? "—");
    if (row.samplePlayer) console.error("SAMPLE PLAYER:", row.samplePlayer);
  });
  console.error("########## SPORT ROUTING DEBUG END ##########");
}
