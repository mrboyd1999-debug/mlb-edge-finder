import { getOddsApiKey, getProxyUrl, getSportsDataApiKey, getStatmuseApiKey } from "../config/apiConfig.js";
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

const PROBE_TIMEOUT_MS = 15_000;

async function probeFetch(url, { method = "GET", headers = {} } = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
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
    console.error(`[API Health] Probe failed — url=${url} status=? error=${message}`);
    return {
      ok: false,
      status: "?",
      contentType: "",
      preview: /abort/i.test(message) ? "Request timed out after 15s" : message,
      durationMs: Date.now() - startedAt,
      payload: null,
      rateLimited: false,
      unauthorized: false,
      networkError: true,
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

async function testSportsDataProvider() {
  const sportsDataKey = getSportsDataApiKey();
  const mlbProbe = await probeFetch(
    "https://statsapi.mlb.com/api/v1/sports/1/leaders?leaderCategories=homeRuns&season=2024&limit=1"
  );
  const mlbOk = mlbProbe.ok && mlbProbe.payload;

  if (!sportsDataKey) {
    return {
      provider: "SportsDataIO",
      route: "https://statsapi.mlb.com (public MLB API fallback)",
      keyConfigured: false,
      status: mlbOk ? CONNECTION_STATUS.DEGRADED : CONNECTION_STATUS.NOT_CONFIGURED,
      message: mlbOk
        ? "No SportsDataIO key — using public MLB Stats API for player history."
        : CONNECTION_MESSAGES.NOT_CONFIGURED,
      ...mlbProbe,
      preview: mlbOk ? "Public MLB Stats API reachable" : mlbProbe.preview,
    };
  }

  // The proxy injects Ocp-Apim-Subscription-Key from the server env, but the
  // SportsDataIO API also accepts the key as a query string for browser probes.
  const route = `/api/sportsdata/scores/json/Teams?key=${encodeURIComponent(sportsDataKey)}`;
  const probe = await probeFetch(route);
  const state = getSourceState(SOURCE_IDS.SPORTSDATA);

  let classified;
  if (probe.unauthorized) {
    classified = { status: CONNECTION_STATUS.FAILED, message: CONNECTION_MESSAGES.INVALID };
  } else if (probe.rateLimited) {
    classified = { status: CONNECTION_STATUS.CACHED, message: CONNECTION_MESSAGES.RATE_LIMITED };
  } else if (probe.ok && Array.isArray(probe.payload) && probe.payload.length) {
    classified = { status: CONNECTION_STATUS.LIVE, message: CONNECTION_MESSAGES.CONNECTED };
  } else if (probe.ok) {
    classified = { status: CONNECTION_STATUS.DEGRADED, message: CONNECTION_MESSAGES.DEGRADED };
  } else if (mlbOk) {
    classified = {
      status: CONNECTION_STATUS.DEGRADED,
      message: "SportsDataIO unreachable — public MLB API fallback live.",
    };
  } else {
    classified = { status: CONNECTION_STATUS.FAILED, message: CONNECTION_MESSAGES.FAILED };
  }

  return {
    provider: "SportsDataIO",
    route: "/api/sportsdata/scores/json/Teams",
    keyConfigured: true,
    mlbStatsApi: mlbOk ? CONNECTION_STATUS.LIVE : CONNECTION_STATUS.DEGRADED,
    ...classified,
    ...probe,
    lastSuccessfulFetchAt: state.lastSuccessfulFetchAt || "",
    requestCount: state.requestCount || 0,
    lastError: state.lastError || (classified.status === CONNECTION_STATUS.FAILED ? probe.preview : ""),
    cooldownRemainingMs: Math.max(0, Number(state.cooldownUntil || 0) - Date.now()),
    preview: probe.preview || mlbProbe.preview,
  };
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
