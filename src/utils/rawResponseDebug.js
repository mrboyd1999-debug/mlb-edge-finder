/**
 * Raw provider response logging + window debug stores.
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

function firstRawObject(payload) {
  if (payload == null) return null;
  if (Array.isArray(payload)) return safeClone(payload[0] ?? null, 0);
  if (typeof payload !== "object") return payload;
  const preferred =
    payload.over_under_lines ||
    payload.overUnderLines ||
    payload.props ||
    (Array.isArray(payload.data) ? payload.data : null);
  if (Array.isArray(preferred) && preferred[0]) return safeClone(preferred[0], 0);
  const arrays = Object.values(payload).filter(Array.isArray);
  if (arrays.length && arrays[0]?.[0]) return safeClone(arrays[0][0], 0);
  return safeClone(payload, 0);
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

function formatErrorStack(error) {
  if (!error) return [];
  if (Array.isArray(error)) return error.map((item) => String(item));
  if (typeof error === "string") return [error];
  if (error instanceof Error) {
    return [error.message, ...(error.stack ? error.stack.split("\n").slice(0, 6) : [])].filter(Boolean);
  }
  return [String(error)];
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
  if (!window.__DEBUG_PROVIDER_STATUS__) {
    window.__DEBUG_PROVIDER_STATUS__ = {};
  }
  if (!window.__NORMALIZED_PROPS__) {
    window.__NORMALIZED_PROPS__ = {
      byProvider: {},
      total: 0,
      samples: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

export function recordProviderResponse(provider = "", meta = {}) {
  initRawResponseDebug();
  const payload = meta.payload ?? meta.raw ?? meta.data ?? null;
  const parserErrors = meta.errors || meta.parserErrors || [];
  const entry = {
    provider,
    url: meta.url || "",
    status: meta.status ?? meta.httpStatus ?? null,
    topLevelKeys: topLevelKeys(payload),
    totalObjectCount: countObjects(payload),
    rawCount: Number(meta.rawCount ?? meta.parsedCount ?? countObjects(payload)),
    firstRawObject: firstRawObject(payload),
    samples: Array.isArray(payload)
      ? safeClone(payload.slice(0, SAMPLE_LIMIT))
      : safeClone(payload),
    parsedCount: Number(meta.parsedCount ?? 0),
    normalizedCount: Number(meta.normalizedCount ?? 0),
    errors: parserErrors,
    parserErrorStack: formatErrorStack(meta.parserErrorStack || meta.error || parserErrors[0]),
    message: meta.message || "",
    recordedAt: new Date().toISOString(),
  };

  console.info(`[Raw Response] ${provider}`, {
    url: entry.url,
    status: entry.status,
    keys: entry.topLevelKeys,
    rawCount: entry.rawCount,
    firstRawObject: entry.firstRawObject,
    parsedCount: entry.parsedCount,
    normalizedCount: entry.normalizedCount,
    parserErrorStack: entry.parserErrorStack,
  });

  if (typeof window !== "undefined") {
    window.__DEBUG_RESPONSES__[provider] = entry;
    window.__DEBUG_RESPONSES__.updatedAt = entry.recordedAt;
  }
  return entry;
}

export function recordParserPreview(provider = "", preview = {}) {
  initRawResponseDebug();
  const parserErrors = preview.parserErrors || preview.errors || [];
  const row = {
    provider,
    rawObjectCount: Number(preview.rawObjectCount ?? 0),
    normalizedObjectCount: Number(preview.normalizedObjectCount ?? 0),
    parserErrors,
    parserErrorStack: formatErrorStack(preview.parserErrorStack || parserErrors[0]),
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

export function recordProviderStatus(statusMap = {}) {
  initRawResponseDebug();
  if (typeof window === "undefined") return statusMap;
  window.__DEBUG_PROVIDER_STATUS__ = {
    ...window.__DEBUG_PROVIDER_STATUS__,
    ...statusMap,
    updatedAt: new Date().toISOString(),
  };
  return window.__DEBUG_PROVIDER_STATUS__;
}

export function recordNormalizedProps(props = [], meta = {}) {
  initRawResponseDebug();
  const list = Array.isArray(props) ? props : [];
  const byProvider = { ...(window.__NORMALIZED_PROPS__?.byProvider || {}) };
  const provider = meta.provider || meta.source || "all";
  byProvider[provider] = {
    count: list.length,
    sample: list[0] || null,
    recordedAt: new Date().toISOString(),
  };

  const snapshot = {
    byProvider,
    total: Number(meta.total ?? list.length),
    samples: list.slice(0, 3),
    source: meta.ingestionSource || meta.source || "",
    updatedAt: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    window.__NORMALIZED_PROPS__ = snapshot;
  }
  return snapshot;
}

export function dumpDebugGlobals(label = "ingestion") {
  initRawResponseDebug();
  if (typeof window === "undefined") return null;
  const bundle = {
    label,
    at: new Date().toISOString(),
    responses: window.__DEBUG_RESPONSES__,
    providerStatus: window.__DEBUG_PROVIDER_STATUS__,
    normalized: window.__NORMALIZED_PROPS__,
    parserPreview: window.__DEBUG_PARSER_PREVIEW__,
  };
  console.group(`[Raw API Debug] ${label}`);
  console.log("window.__DEBUG_RESPONSES__", window.__DEBUG_RESPONSES__);
  console.log("window.__DEBUG_PROVIDER_STATUS__", window.__DEBUG_PROVIDER_STATUS__);
  console.log("window.__NORMALIZED_PROPS__", window.__NORMALIZED_PROPS__);
  console.groupEnd();
  return bundle;
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

export const RAW_DEBUG_PROVIDERS = ["underdog", "prizepicks", "sportsdataio", "oddsapi"];

export function buildRawDebugRows() {
  initRawResponseDebug();
  if (typeof window === "undefined") return [];
  const previews = new Map((window.__DEBUG_PARSER_PREVIEW__ || []).map((row) => [row.provider, row]));
  return RAW_DEBUG_PROVIDERS.map((provider) => {
    const response = window.__DEBUG_RESPONSES__?.[provider] || null;
    const preview = previews.get(provider) || null;
    const status = window.__DEBUG_PROVIDER_STATUS__?.[provider] || null;
    return {
      provider,
      endpointUrl: response?.url || status?.url || "",
      httpStatus: response?.status ?? status?.status ?? null,
      topLevelKeys: response?.topLevelKeys || [],
      firstRawObject: response?.firstRawObject ?? response?.samples?.[0] ?? null,
      rawCount: Number(response?.rawCount ?? response?.totalObjectCount ?? preview?.rawObjectCount ?? 0),
      parserErrorStack: [
        ...(response?.parserErrorStack || []),
        ...(preview?.parserErrorStack || []),
        ...(response?.errors || []),
        ...(preview?.parserErrors || []),
      ].filter(Boolean),
      normalizedPropCount: Number(
        preview?.normalizedObjectCount ?? response?.normalizedCount ?? status?.normalizedCount ?? 0
      ),
      message: response?.message || status?.message || "",
      recordedAt: response?.recordedAt || preview?.recordedAt || "",
    };
  });
}
