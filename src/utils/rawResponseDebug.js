/**
 * Raw provider response logging + window.__DEBUG_RESPONSES__ store.
 * Data-layer only — no UI.
 */

const SAMPLE_LIMIT = 3;

function safeClone(value, depth = 0) {
  if (depth > 4) return "[max-depth]";
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, SAMPLE_LIMIT).map((item) => safeClone(item, depth + 1));
  }
  const out = {};
  Object.keys(value)
    .slice(0, 40)
    .forEach((key) => {
      out[key] = safeClone(value[key], depth + 1);
    });
  return out;
}

function topLevelKeys(payload) {
  if (payload == null) return [];
  if (Array.isArray(payload)) return ["[array]"];
  if (typeof payload !== "object") return [];
  return Object.keys(payload);
}

function countObjects(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return 0;
  const arrays = Object.values(payload).filter(Array.isArray);
  if (arrays.length) return Math.max(...arrays.map((a) => a.length), 0);
  return 1;
}

export function initRawResponseDebug() {
  if (typeof window === "undefined") return;
  if (!window.__DEBUG_RESPONSES__) {
    window.__DEBUG_RESPONSES__ = {
      prizepicks: null,
      underdog: null,
      oddsapi: null,
      sportsdataio: null,
      parserPreview: [],
      updatedAt: new Date().toISOString(),
    };
  }
  if (!window.__DEBUG_PARSER_PREVIEW__) {
    window.__DEBUG_PARSER_PREVIEW__ = [];
  }
}

export function recordProviderResponse(provider = "", meta = {}) {
  initRawResponseDebug();
  const payload = meta.payload ?? meta.raw ?? meta.data ?? null;
  const entry = {
    provider,
    url: meta.url || "",
    status: meta.status ?? meta.httpStatus ?? null,
    topLevelKeys: topLevelKeys(payload),
    totalObjectCount: countObjects(payload),
    samples: Array.isArray(payload)
      ? safeClone(payload.slice(0, SAMPLE_LIMIT))
      : safeClone(payload),
    parsedCount: Number(meta.parsedCount ?? 0),
    normalizedCount: Number(meta.normalizedCount ?? 0),
    errors: meta.errors || [],
    message: meta.message || "",
    recordedAt: new Date().toISOString(),
  };

  console.info(`[Raw Response] ${provider}`, {
    url: entry.url,
    status: entry.status,
    keys: entry.topLevelKeys,
    totalObjectCount: entry.totalObjectCount,
    samples: entry.samples,
    parsedCount: entry.parsedCount,
    normalizedCount: entry.normalizedCount,
    errors: entry.errors,
  });

  if (typeof window !== "undefined") {
    window.__DEBUG_RESPONSES__[provider] = entry;
    window.__DEBUG_RESPONSES__.updatedAt = entry.recordedAt;
  }
  return entry;
}

export function recordParserPreview(provider = "", preview = {}) {
  initRawResponseDebug();
  const row = {
    provider,
    rawObjectCount: Number(preview.rawObjectCount ?? 0),
    normalizedObjectCount: Number(preview.normalizedObjectCount ?? 0),
    parserErrors: preview.parserErrors || preview.errors || [],
    firstNormalizedProp: preview.firstNormalizedProp || preview.preview || null,
    schemaKeys: preview.schemaKeys || [],
    recordedAt: new Date().toISOString(),
  };

  console.info(`[Parser Preview] ${provider}`, row);

  if (typeof window !== "undefined") {
    const list = window.__DEBUG_PARSER_PREVIEW__ || [];
    const next = [row, ...list.filter((item) => item.provider !== provider)].slice(0, 8);
    window.__DEBUG_PARSER_PREVIEW__ = next;
    window.__DEBUG_RESPONSES__.parserPreview = next;
  }
  return row;
}

export function walkPayloadArrays(payload, visitor, path = "", depth = 0) {
  if (depth > 6 || payload == null) return;
  if (Array.isArray(payload)) {
    visitor(payload, path);
    payload.slice(0, 5).forEach((item, index) => {
      if (item && typeof item === "object") walkPayloadArrays(item, visitor, `${path}[${index}]`, depth + 1);
    });
    return;
  }
  if (typeof payload !== "object") return;
  Object.entries(payload).forEach(([key, value]) => {
    const nextPath = path ? `${path}.${key}` : key;
    if (Array.isArray(value)) visitor(value, nextPath);
    else if (value && typeof value === "object") walkPayloadArrays(value, visitor, nextPath, depth + 1);
  });
}

export function discoverArrayCollections(payload) {
  const collections = [];
  walkPayloadArrays(payload, (arr, path) => {
    if (!arr?.length || typeof arr[0] !== "object") return;
    collections.push({
      path,
      count: arr.length,
      sampleKeys: Object.keys(arr[0] || {}),
    });
  });
  return collections;
}
