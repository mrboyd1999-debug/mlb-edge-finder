/** Hard evidence logs + window snapshot for /debug-feed (ingestion only). */

export function getDebugFeedEvidence() {
  if (typeof window === "undefined") return { prizepicks: null, underdog: null };
  return {
    prizepicks: window.__DEBUG_FEED_EVIDENCE__?.prizepicks || null,
    underdog: window.__DEBUG_FEED_EVIDENCE__?.underdog || null,
  };
}

export function publishFeedEvidence(providerKey, patch = {}) {
  if (typeof window === "undefined") return patch;
  window.__DEBUG_FEED_EVIDENCE__ = window.__DEBUG_FEED_EVIDENCE__ || {};
  window.__DEBUG_FEED_EVIDENCE__[providerKey] = {
    ...(window.__DEBUG_FEED_EVIDENCE__[providerKey] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return window.__DEBUG_FEED_EVIDENCE__[providerKey];
}

export function logFeedFetchStart(prefix, url = "") {
  console.log(`${prefix} START FETCH`);
  console.log(`${prefix} URL`, url);
}

export function logFeedHttpResponse(prefix, { status, text = "", url = "" } = {}) {
  console.log(`${prefix} STATUS`, status);
  console.log(`${prefix} SIZE`, text?.length ?? 0);
  console.log(`${prefix} BODY`, String(text || "").slice(0, 500));
  if (url) console.log(`${prefix} URL`, url);
}

export function logFeedFetchError(prefix, error) {
  console.error(`${prefix} FETCH ERROR`, error);
  console.error(`${prefix} ERROR MESSAGE`, error?.message || String(error));
  console.error(`${prefix} ERROR STACK`, error?.stack || "(no stack trace)");
}

export function logFeedStageTrace(prefix, providerKey, trace = {}) {
  console.log(`${prefix} FETCH SUCCESS?`, Boolean(trace.fetchSuccess));
  console.log(`${prefix} PARSE SUCCESS?`, Boolean(trace.parseSuccess));
  console.log(`${prefix} NORMALIZE SUCCESS?`, Boolean(trace.normalizeSuccess));
  console.log(`${prefix} FILTER SUCCESS?`, Boolean(trace.filterSuccess));
  console.log(`${prefix} COUNTS`, trace.counts || {});
  publishFeedEvidence(providerKey, trace);
  return trace;
}
