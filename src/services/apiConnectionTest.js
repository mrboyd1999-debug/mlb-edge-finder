import { getOddsApiKey, getProxyUrl, getSportsDataApiKey, getStatmuseApiKey } from "../config/apiConfig.js";
import {
  ENRICHMENT_TIMEOUT_MESSAGE,
  getApiTimeoutMs,
  isAbortOrTimeoutError,
  isTimeoutPreview,
} from "../utils/apiTimeout.js";
import {
  probeSportsDataMlbStatusProxy,
  SPORTSDATA_CONNECTED_VIA_PROXY,
  SPORTSDATA_MLB_STATUS_ROUTE,
} from "./sportsDataService.js";
import { getSourceState, isSourceInCooldown, SOURCE_IDS } from "./sourceRateLimit.js";
import { readCachedBoard, readVerifiedCacheBoard } from "./pickStore.js";
import { buildFeedHealthContext, mergeConnectionReportWithFeeds } from "./providerHealth.js";

export const CONNECTION_STATUS = {
  LIVE: "LIVE",
  CACHED: "CACHED",
  DEGRADED: "DEGRADED",
  FAILED: "FAILED",
  NOT_CONFIGURED: "NOT CONFIGURED",
};

export const CONNECTION_MESSAGES = {
  CONNECTED: "Connected",
  NOT_CONFIGURED: "Not configured",
  INVALID: "Invalid key or unauthorized",
  RATE_LIMITED: "Rate limited — using cache",
  DEGRADED: "Degraded — partial response",
  FAILED: "Connection failed",
};

async function probeFetch(url, { method = "GET", headers = {} } = {}) {
  const startedAt = Date.now();
  const probeTimeoutMs = getApiTimeoutMs({ enrichment: true });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), probeTimeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal, headers });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    const trimmed = text.trim();
    const looksJson = /json/i.test(contentType) || trimmed.startsWith("{") || trimmed.startsWith("[");
    const looksHtml = trimmed.startsWith("<") || /text\/html/i.test(contentType);
    let payload = null;
    if (looksJson && !looksHtml) {
      try {
        payload = JSON.parse(trimmed);
      } catch {
        payload = null;
      }
    }
    const result = {
      ok: response.ok && looksJson && !looksHtml,
      status: response.status,
      contentType,
      preview: text.slice(0, 160).replace(/\s+/g, " ").trim() || "(empty)",
      durationMs: Date.now() - startedAt,
      payload,
      rateLimited: response.status === 429,
      unauthorized: response.status === 401 || response.status === 403,
      looksHtml,
      url,
    };
    if (!result.ok) {
      const redactedUrl = String(url).replace(/apiKey=[^&]+/gi, "apiKey=[REDACTED]");
      console.error(
        `[API Health] Probe failed — url=${redactedUrl} status=${result.status} preview=${result.preview}`
      );
    }
    return result;
  } catch (error) {
    const message = error?.message || "Failed to fetch";
    const timedOut = isAbortOrTimeoutError(error);
    console.error(`[API Health] Probe failed — url=${url} status=? error=${message}`);
    return {
      ok: false,
      status: timedOut ? "timeout" : "?",
      contentType: "",
      preview: timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : message,
      durationMs: Date.now() - startedAt,
      payload: null,
      rateLimited: false,
      unauthorized: false,
      timedOut,
      networkError: !timedOut,
      url,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

function withProxyRoute(basePath, proxyUrl) {
  if (!proxyUrl) return basePath;
  const url = new URL(basePath, window.location.origin);
  url.searchParams.set("proxyUrl", proxyUrl);
  return url.pathname + url.search;
}

function resolveConnectionMessage(status, { unauthorized = false, rateLimited = false, configured = true } = {}) {
  if (!configured) return CONNECTION_MESSAGES.NOT_CONFIGURED;
  if (rateLimited) return CONNECTION_MESSAGES.RATE_LIMITED;
  if (unauthorized) return CONNECTION_MESSAGES.INVALID;
  if (status === CONNECTION_STATUS.LIVE) return CONNECTION_MESSAGES.CONNECTED;
  if (status === CONNECTION_STATUS.CACHED) return CONNECTION_MESSAGES.RATE_LIMITED;
  if (status === CONNECTION_STATUS.DEGRADED) return CONNECTION_MESSAGES.DEGRADED;
  if (status === CONNECTION_STATUS.FAILED) return CONNECTION_MESSAGES.FAILED;
  return CONNECTION_MESSAGES.NOT_CONFIGURED;
}

function classifyLineSourceProbe(result, { requiresKey = false, keyConfigured = true, sourceId = "" } = {}) {
  if (requiresKey && !keyConfigured) {
    return {
      status: CONNECTION_STATUS.NOT_CONFIGURED,
      message: CONNECTION_MESSAGES.NOT_CONFIGURED,
    };
  }
  if (result.rateLimited || (sourceId && isSourceInCooldown(sourceId))) {
    return {
      status: CONNECTION_STATUS.CACHED,
      message: CONNECTION_MESSAGES.RATE_LIMITED,
    };
  }
  if (result.unauthorized) {
    return {
      status: CONNECTION_STATUS.FAILED,
      message: CONNECTION_MESSAGES.INVALID,
    };
  }
  if (result.ok) {
    const hasData =
      (Array.isArray(result.payload?.props) && result.payload.props.length > 0) ||
      (Array.isArray(result.payload?.data) && result.payload.data.length > 0) ||
      (Array.isArray(result.payload) && result.payload.length > 0) ||
      result.payload?.ok === true ||
      (result.payload && !result.payload.error);
    return {
      status: hasData || result.payload?.ok !== false ? CONNECTION_STATUS.LIVE : CONNECTION_STATUS.DEGRADED,
      message: hasData ? CONNECTION_MESSAGES.CONNECTED : CONNECTION_MESSAGES.DEGRADED,
    };
  }
  if (result.payload?.cached || result.payload?.fromCache) {
    return {
      status: CONNECTION_STATUS.CACHED,
      message: CONNECTION_MESSAGES.RATE_LIMITED,
    };
  }
  if (result.timedOut || isTimeoutPreview(result.preview)) {
    return {
      status: CONNECTION_STATUS.FAILED,
      message: ENRICHMENT_TIMEOUT_MESSAGE,
      timedOut: true,
      settingsLine: ENRICHMENT_TIMEOUT_MESSAGE,
    };
  }
  return {
    status: CONNECTION_STATUS.FAILED,
    message: result.networkError ? CONNECTION_MESSAGES.FAILED : CONNECTION_MESSAGES.DEGRADED,
  };
}

async function testPrizePicks() {
  const proxyUrl = getProxyUrl("prizepicks");
  const routes = [withProxyRoute("/api/prizepicks", proxyUrl), "/api/prizepicks"];
  let lastResult = null;
  for (const route of routes) {
    lastResult = await probeFetch(route);
    if (lastResult.ok) break;
  }
  const classified = classifyLineSourceProbe(lastResult, { sourceId: SOURCE_IDS.PRIZEPICKS });
  const state = getSourceState(SOURCE_IDS.PRIZEPICKS);
  return {
    provider: "PrizePicks",
    route: routes[0],
    proxyConfigured: Boolean(proxyUrl),
    ...classified,
    ...lastResult,
    lastSuccessfulFetchAt: state.lastSuccessfulFetchAt || "",
    requestCount: state.requestCount || 0,
    lastError: state.lastError || (classified.status === CONNECTION_STATUS.FAILED ? lastResult.preview : ""),
    cooldownRemainingMs: Math.max(0, Number(state.cooldownUntil || 0) - Date.now()),
  };
}

async function testUnderdog() {
  const proxyUrl = getProxyUrl("underdog");
  const routes = [withProxyRoute("/api/underdog", proxyUrl), "/api/underdog"];
  let lastResult = null;
  for (const route of routes) {
    lastResult = await probeFetch(route);
    if (lastResult.ok) break;
  }
  const classified = classifyLineSourceProbe(lastResult, { sourceId: SOURCE_IDS.UNDERDOG });
  const state = getSourceState(SOURCE_IDS.UNDERDOG);
  return {
    provider: "Underdog",
    route: routes[0],
    proxyConfigured: Boolean(proxyUrl),
    ...classified,
    ...lastResult,
    lastSuccessfulFetchAt: state.lastSuccessfulFetchAt || "",
    requestCount: state.requestCount || 0,
    lastError: state.lastError || (classified.status === CONNECTION_STATUS.FAILED ? lastResult.preview : ""),
    cooldownRemainingMs: Math.max(0, Number(state.cooldownUntil || 0) - Date.now()),
  };
}

async function testOddsApi() {
  const key = getOddsApiKey();
  if (!key) {
    return {
      provider: "Odds API",
      status: CONNECTION_STATUS.NOT_CONFIGURED,
      message: CONNECTION_MESSAGES.NOT_CONFIGURED,
      route: "/api/sportsbookOdds?path=/v4/sports",
      preview: "No VITE_ODDS_API_KEY configured",
      durationMs: 0,
      keyConfigured: false,
    };
  }
  const url = new URL("/api/sportsbookOdds", window.location.origin);
  url.searchParams.set("path", "/v4/sports");
  url.searchParams.set("apiKey", key);
  const route = url.pathname + url.search;
  const result = await probeFetch(route);
  const sportsListOk = result.ok && Array.isArray(result.payload) && result.payload.length > 0;
  if (sportsListOk) {
    const state = getSourceState(SOURCE_IDS.ODDS_API);
    return {
      provider: "Odds API",
      route,
      keyConfigured: true,
      status: CONNECTION_STATUS.LIVE,
      message: CONNECTION_MESSAGES.CONNECTED,
      sportsListOk: true,
      sportsCount: result.payload.length,
      ...result,
      lastSuccessfulFetchAt: state.lastSuccessfulFetchAt || new Date().toISOString(),
      requestCount: state.requestCount || 0,
      lastError: "",
      cooldownRemainingMs: Math.max(0, Number(state.cooldownUntil || 0) - Date.now()),
    };
  }
  const classified = classifyLineSourceProbe(result, {
    requiresKey: true,
    keyConfigured: true,
    sourceId: SOURCE_IDS.ODDS_API,
  });
  const state = getSourceState(SOURCE_IDS.ODDS_API);
  return {
    provider: "Odds API",
    route,
    keyConfigured: true,
    sportsListOk: false,
    ...classified,
    ...result,
    lastSuccessfulFetchAt: state.lastSuccessfulFetchAt || "",
    requestCount: state.requestCount || 0,
    lastError: classified.status === CONNECTION_STATUS.FAILED ? result.preview : "",
    cooldownRemainingMs: Math.max(0, Number(state.cooldownUntil || 0) - Date.now()),
  };
}


function redactSportsDataUrl(url = "") {
  return String(url).replace(/key=[^&]+/gi, "key=[REDACTED]");
}

function isSportsDataHealthPayload(payload) {
  if (payload === true || payload === false) return true;
  if (Array.isArray(payload)) return true;
  return Boolean(payload && typeof payload === "object");
}

async function probeSportsDataHealth({ apiKey } = {}) {
  void apiKey;
  const startedAt = Date.now();
  const probe = await probeSportsDataMlbStatusProxy();
  const healthOk = Boolean(probe.ok && isSportsDataHealthPayload(probe.payload ?? probe.data));

  return {
    ok: healthOk,
    status: probe.responseCode || (healthOk ? 200 : 502),
    preview: probe.message || probe.preview || "",
    durationMs: Date.now() - startedAt,
    payload: probe.payload ?? probe.data,
    rateLimited: Boolean(probe.rateLimited),
    unauthorized: Boolean(probe.unauthorized),
    timedOut: Boolean(probe.timedOut),
    corsBlocked: false,
    networkError: !healthOk && !probe.timedOut && !probe.unauthorized,
    url: SPORTSDATA_MLB_STATUS_ROUTE,
    usedDirect: false,
    proxied: true,
  };
}

function classifySportsDataProbe(probe = {}) {
  if (probe.timedOut) {
    return {
      settingsLine: ENRICHMENT_TIMEOUT_MESSAGE,
      status: CONNECTION_STATUS.FAILED,
      message: ENRICHMENT_TIMEOUT_MESSAGE,
      showError: false,
      timedOut: true,
    };
  }
  if (probe.unauthorized) {
    return {
      settingsLine: "Invalid key or subscription",
      status: CONNECTION_STATUS.FAILED,
      message: CONNECTION_MESSAGES.INVALID,
      showError: true,
    };
  }
  if (probe.rateLimited) {
    return {
      settingsLine: "Rate limited",
      status: CONNECTION_STATUS.CACHED,
      message: CONNECTION_MESSAGES.RATE_LIMITED,
      showError: false,
    };
  }
  if (probe.ok) {
    return {
      settingsLine: SPORTSDATA_CONNECTED_VIA_PROXY,
      settingsStatus: SPORTSDATA_CONNECTED_VIA_PROXY,
      status: CONNECTION_STATUS.LIVE,
      message: SPORTSDATA_CONNECTED_VIA_PROXY,
      showError: false,
      debugLine: "SportsDataIO MLB status probe succeeded via backend proxy.",
      proxied: true,
    };
  }
  return {
    settingsLine: probe.preview || "Failed",
    status: CONNECTION_STATUS.FAILED,
    message: probe.preview || CONNECTION_MESSAGES.FAILED,
    showError: true,
  };
}

async function testSportsDataProvider() {
  const sportsDataKey = getSportsDataApiKey();

  if (!sportsDataKey) {
    console.log("[SportsDataIO Test] Status: skipped — no key saved");
    return {
      provider: "SportsDataIO",
      route: SPORTSDATA_MLB_STATUS_ROUTE,
      keyConfigured: false,
      status: CONNECTION_STATUS.NOT_CONFIGURED,
      message: CONNECTION_MESSAGES.NOT_CONFIGURED,
      preview: "No SportsDataIO key configured",
      durationMs: 0,
      settingsLine: "Not Used",
      keySaved: false,
    };
  }

  const probe = await probeSportsDataHealth({ apiKey: sportsDataKey });
  const classified = classifySportsDataProbe(probe);
  const state = getSourceState(SOURCE_IDS.SPORTSDATA);

  console.log("[SportsDataIO Test] Proxy route:", SPORTSDATA_MLB_STATUS_ROUTE);
  console.log("[SportsDataIO Test] Response status:", probe.status);
  console.log("[SportsDataIO Test] Proxied:", probe.proxied);
  console.log("[SportsDataIO Test] Response text:", redactSportsDataUrl(String(probe.preview || "")));

  return {
    provider: "SportsDataIO",
    route: SPORTSDATA_MLB_STATUS_ROUTE,
    keyConfigured: true,
    keySaved: true,
    settingsLine: classified.settingsLine,
    settingsStatus: classified.settingsStatus || classified.settingsLine,
    showError: classified.showError,
    debugLine: classified.debugLine || "",
    status: classified.status,
    message: classified.message,
    proxied: true,
    ...probe,
    lastSuccessfulFetchAt: probe.ok ? new Date().toISOString() : state.lastSuccessfulFetchAt || "",
    requestCount: state.requestCount || 0,
    lastError: classified.showError ? probe.preview || classified.message : "",
    cooldownRemainingMs: Math.max(0, Number(state.cooldownUntil || 0) - Date.now()),
  };
}

/** Standalone SportsDataIO probe — logs URL, status, and error body to console. */
export async function testSportsDataIO() {
  const startedAt = Date.now();
  const result = await testSportsDataProvider();
  const report = {
    testedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    results: [result],
  };
  return mergeConnectionReportWithFeeds(report, {});
}

async function testStatmuseProvider() {
  const key = getStatmuseApiKey();
  if (!key) {
    return {
      provider: "StatMuse",
      status: CONNECTION_STATUS.NOT_CONFIGURED,
      message: CONNECTION_MESSAGES.NOT_CONFIGURED,
      route: "(not wired)",
      preview: "StatMuse enrichment is optional and not required for MLB-only mode",
      durationMs: 0,
    };
  }
  return {
    provider: "StatMuse",
    status: CONNECTION_STATUS.DEGRADED,
    message: "Key saved — provider not wired yet",
    route: "(reserved)",
    preview: "Key stored locally; StatMuse calls are not enabled in this build",
    durationMs: 0,
    keyConfigured: true,
  };
}

function testVerifiedCache() {
  try {
    const board = readVerifiedCacheBoard({}, { allowExpired: true }) || readCachedBoard({}, { allowExpired: true });
    const props = board?.props || board?.qualifiedReadyProps || [];
    const updatedAt = board?.updatedAt || board?.cacheMetadata?.verifiedAt || "";
    const ts = updatedAt ? new Date(updatedAt).getTime() : 0;
    const ageMs = ts ? Date.now() - ts : null;
    if (!props.length) {
      return {
        provider: "Verified cache",
        status: CONNECTION_STATUS.NOT_CONFIGURED,
        message: "No verified cache on device",
        route: "localStorage",
        preview: "Refresh lines once to seed verified cache",
        durationMs: 0,
        cacheAgeMs: ageMs,
        propCount: 0,
      };
    }
    const staleThresholdMs = 6 * 60 * 60 * 1000;
    const expiredThresholdMs = 24 * 60 * 60 * 1000;
    let status = CONNECTION_STATUS.LIVE;
    let message = CONNECTION_MESSAGES.CONNECTED;
    if (ageMs != null && ageMs > expiredThresholdMs) {
      status = CONNECTION_STATUS.FAILED;
      message = "Cache expired — not used for Top Picks";
    } else     if (ageMs != null && ageMs > staleThresholdMs) {
      status = CONNECTION_STATUS.DEGRADED;
      message = "Stale cache — live refresh recommended";
    }
    return {
      provider: "Verified cache",
      status,
      message,
      route: "localStorage",
      preview: `${props.length} verified props cached`,
      durationMs: 0,
      cacheAgeMs: ageMs,
      propCount: props.length,
      lastSuccessfulFetchAt: updatedAt,
    };
  } catch (error) {
    return {
      provider: "Verified cache",
      status: CONNECTION_STATUS.FAILED,
      message: CONNECTION_MESSAGES.FAILED,
      route: "localStorage",
      preview: error?.message || "Could not read cache",
      durationMs: 0,
    };
  }
}

/** Test all configured providers without throwing when keys are missing. */
export async function testAllApiConnections(options = {}) {
  const startedAt = Date.now();
  const results = await Promise.all([
    testPrizePicks(),
    testUnderdog(),
    testOddsApi(),
    testSportsDataProvider(),
    testStatmuseProvider(),
  ]);
  results.push(testVerifiedCache());
  const report = {
    testedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    results,
  };
  const feedContext =
    options.feedContext ||
    buildFeedHealthContext({
      allDisplayProps: options.allDisplayProps || [],
      debugInfo: options.debugInfo || {},
      sourceStatus: options.sourceStatus || {},
      lastUpdated: options.lastUpdated || "",
    });
  return mergeConnectionReportWithFeeds(report, feedContext);
}

export { mergeConnectionReportWithFeeds, buildFeedHealthContext } from "./providerHealth.js";

export function connectionStatusStyle(status = "") {
  const key = String(status || "").toUpperCase();
  const colors = {
    LIVE: { bg: "rgba(34,197,94,0.18)", text: "#86efac" },
    "LIVE FEED AVAILABLE": { bg: "rgba(34,197,94,0.18)", text: "#86efac" },
    CONNECTED: { bg: "rgba(34,197,94,0.18)", text: "#86efac" },
    CACHED: { bg: "rgba(59,130,246,0.18)", text: "#93c5fd" },
    "CACHED FEED": { bg: "rgba(59,130,246,0.18)", text: "#93c5fd" },
    "PROXY REQUIRED": { bg: "rgba(234,179,8,0.18)", text: "#fde047" },
    "INVALID API KEY": { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    "RATE LIMITED": { bg: "rgba(59,130,246,0.18)", text: "#93c5fd" },
    DEGRADED: { bg: "rgba(249,115,22,0.18)", text: "#fdba74" },
    FAILED: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    "NOT CONFIGURED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1" },
    STALE: { bg: "rgba(234,179,8,0.18)", text: "#fde047" },
  };
  const palette = colors[key] || colors.DEGRADED;
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: palette.bg,
    color: palette.text,
  };
}
