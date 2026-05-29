import { getOddsApiKey, getProxyUrl, getRawProxyUrl, getSportsDataApiKey, getStatmuseApiKey } from "../config/apiConfig.js";
import { normalizeProxyUrl } from "../utils/providerProxy.js";
import {
  buildOddsApiProxyUrl,
  logOddsApiExchange,
  ODDS_API_INVALID_KEY_MESSAGE,
  parseOddsApiAuthFailure,
  redactOddsApiUrl,
} from "./oddsApiClient.js";
import {
  ENRICHMENT_TIMEOUT_MESSAGE,
  getApiTimeoutMs,
  isAbortOrTimeoutError,
  isTimeoutPreview,
} from "../utils/apiTimeout.js";
import { getOddsKeyLengthWarning, cleanApiKey } from "../utils/cleanApiKey.js";
import { runSportsDataMultiEndpointTest, SPORTSDATA_STATUS_LABELS } from "./sportsDataAuthTest.js";
import { clearSourceAuthBlock, getSourceState, isSourceInCooldown, SOURCE_IDS } from "./sourceRateLimit.js";
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
  INVALID_ODDS_KEY: ODDS_API_INVALID_KEY_MESSAGE,
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
    const upstreamStatus = Number(payload?.upstreamStatus ?? payload?.responseCode ?? response.status ?? 0);
    const unauthorized =
      upstreamStatus === 401 ||
      upstreamStatus === 403 ||
      Boolean(parseOddsApiAuthFailure({ data: payload, status: upstreamStatus, text: trimmed }));
    const result = {
      ok: response.ok && looksJson && !looksHtml && !payload?.error && !unauthorized,
      status: upstreamStatus || response.status,
      contentType,
      preview: unauthorized
        ? ODDS_API_INVALID_KEY_MESSAGE
        : text.slice(0, 160).replace(/\s+/g, " ").trim() || "(empty)",
      durationMs: Date.now() - startedAt,
      payload,
      rateLimited: (upstreamStatus || response.status) === 429,
      unauthorized,
      looksHtml,
      url,
    };
    if (/odds|sportsbook/i.test(String(url))) {
      logOddsApiExchange({
        url,
        status: upstreamStatus || response.status,
        text: trimmed,
        data: payload,
        label: "Odds API health probe",
      });
    }
    if (!result.ok) {
      const redactedUrl = redactOddsApiUrl(String(url));
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
      message: sourceId === SOURCE_IDS.ODDS_API ? ODDS_API_INVALID_KEY_MESSAGE : CONNECTION_MESSAGES.INVALID,
      settingsLine: sourceId === SOURCE_IDS.ODDS_API ? "Invalid Key" : "Failed",
      unauthorized: true,
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
  const rawProxy = getRawProxyUrl("prizepicks");
  if (!proxyUrl) {
    const invalid = Boolean(rawProxy) && !normalizeProxyUrl(rawProxy);
    const message = invalid
      ? "PrizePicks proxy URL is invalid. Set VITE_PRIZEPICKS_PROXY_URL in Settings."
      : "PrizePicks proxy URL missing";
    return {
      provider: "PrizePicks",
      route: "/api/prizepicks",
      proxyConfigured: false,
      ok: false,
      timedOut: false,
      status: CONNECTION_STATUS.NOT_CONFIGURED,
      message,
      settingsLine: CONNECTION_MESSAGES.NOT_CONFIGURED,
      displayStatus: CONNECTION_MESSAGES.NOT_CONFIGURED,
      preview: message,
      lastError: message,
    };
  }

  const route = proxyUrl;
  console.info("[API Health] PrizePicks probe", { requestUrl: route });
  const lastResult = await probeFetch(route);
  const classified = classifyLineSourceProbe(lastResult, { sourceId: SOURCE_IDS.PRIZEPICKS });
  const rawCount = Array.isArray(lastResult.payload?.data) ? lastResult.payload.data.length : 0;
  const parsedCount = Array.isArray(lastResult.payload?.props) ? lastResult.payload.props.length : 0;
  console.info("[API Health] PrizePicks probe result", {
    responseStatus: lastResult.status,
    rawResponseCount: rawCount,
    parserOutputCount: parsedCount,
    ok: lastResult.ok,
  });
  const state = getSourceState(SOURCE_IDS.PRIZEPICKS);
  return {
    provider: "PrizePicks",
    route,
    proxyConfigured: true,
    rawResponseCount: rawCount,
    parsedCount,
    ...classified,
    ...lastResult,
    lastSuccessfulFetchAt: state.lastSuccessfulFetchAt || "",
    requestCount: state.requestCount || 0,
    lastError:
      state.lastError ||
      (classified.status === CONNECTION_STATUS.FAILED ? lastResult.preview : classified.message || ""),
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

function formatResponseBody(text = "", payload = null, max = 400) {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim().slice(0, max);
  }
  if (payload && typeof payload === "object") {
    if (payload.message) return String(payload.message).slice(0, max);
    if (payload.preview) return String(payload.preview).slice(0, max);
    if (payload.error && payload.message) return String(payload.message).slice(0, max);
  }
  return String(text || "")
    .trim()
    .slice(0, max)
    .replace(/\s+/g, " ");
}

async function probeOddsApiForTest() {
  const key = getOddsApiKey();
  const keyLength = key.length;
  const keyLengthWarning = getOddsKeyLengthWarning(key);

  if (!key) {
    return {
      ok: false,
      status: CONNECTION_STATUS.NOT_CONFIGURED,
      httpStatus: 0,
      responseBody: "No VITE_ODDS_API_KEY configured",
      keyLength: 0,
      keyLengthWarning: "",
      unauthorized: false,
      remainingRequests: null,
      route: "https://api.the-odds-api.com/v4/sports/?apiKey=[REDACTED]",
      durationMs: 0,
      payload: null,
    };
  }

  const url = buildOddsApiProxyUrl("/v4/sports/");
  const route = url.pathname + url.search;
  const startedAt = Date.now();
  const probeTimeoutMs = getApiTimeoutMs({ enrichment: true });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), probeTimeoutMs);

  try {
    const response = await fetch(route, { cache: "no-store", signal: controller.signal });
    const text = await response.text();
    const remainingRequests =
      response.headers.get("x-requests-remaining") || response.headers.get("X-Requests-Remaining");
    const trimmed = text.trim();
    let payload = null;
    try {
      payload = trimmed ? JSON.parse(trimmed) : null;
    } catch {
      payload = null;
    }

    const upstreamStatus = Number(payload?.upstreamStatus ?? payload?.responseCode ?? response.status ?? 0);
    const httpStatus = upstreamStatus || response.status;
    const responseBody = formatResponseBody(text, payload);
    const sportsListOk = response.ok && Array.isArray(payload) && payload.length > 0;
    const unauthorized = httpStatus === 401 || httpStatus === 403 || Boolean(payload?.error && /invalid|unauthorized|subscription/i.test(responseBody));

    console.info("[Odds API Test] Request URL:", redactOddsApiUrl(route));
    console.info("[Odds API Test] Key length:", keyLength);
    console.info("[Odds API Test] HTTP status:", httpStatus);
    console.info("[Odds API Test] Response body:", responseBody);
    if (remainingRequests != null) console.info("[Odds API Test] Requests remaining:", remainingRequests);

    logOddsApiExchange({
      url: route,
      status: httpStatus,
      text,
      data: payload,
      label: "Odds API key test",
    });

    return {
      ok: sportsListOk,
      status: sportsListOk ? CONNECTION_STATUS.LIVE : CONNECTION_STATUS.FAILED,
      httpStatus,
      responseBody,
      keyLength,
      keyLengthWarning,
      unauthorized,
      remainingRequests: remainingRequests != null ? Number(remainingRequests) : null,
      route: "https://api.the-odds-api.com/v4/sports/?apiKey=[REDACTED]",
      durationMs: Date.now() - startedAt,
      payload,
      sportsCount: sportsListOk ? payload.length : 0,
      preview: responseBody,
    };
  } catch (error) {
    const timedOut = isAbortOrTimeoutError(error);
    const message = timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : error?.message || "Failed to fetch";
    return {
      ok: false,
      status: CONNECTION_STATUS.FAILED,
      httpStatus: timedOut ? "timeout" : "?",
      responseBody: message,
      keyLength,
      keyLengthWarning,
      unauthorized: false,
      remainingRequests: null,
      route: "https://api.the-odds-api.com/v4/sports/?apiKey=[REDACTED]",
      durationMs: Date.now() - startedAt,
      payload: null,
      timedOut,
      preview: message,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

async function testOddsApi() {
  const probe = await probeOddsApiForTest();
  const state = getSourceState(SOURCE_IDS.ODDS_API);

  if (!getOddsApiKey()) {
    return {
      provider: "Odds API",
      status: CONNECTION_STATUS.NOT_CONFIGURED,
      message: CONNECTION_MESSAGES.NOT_CONFIGURED,
      route: probe.route,
      preview: probe.responseBody,
      durationMs: probe.durationMs,
      keyConfigured: false,
      keyLength: 0,
      settingsLine: "Not configured",
      showError: false,
    };
  }

  if (probe.ok) {
    clearSourceAuthBlock(SOURCE_IDS.ODDS_API);
    return {
      provider: "Odds API",
      route: probe.route,
      keyConfigured: true,
      keyLength: probe.keyLength,
      keyLengthWarning: probe.keyLengthWarning,
      httpStatus: probe.httpStatus,
      responseBody: probe.responseBody,
      remainingRequests: probe.remainingRequests,
      status: CONNECTION_STATUS.LIVE,
      message: CONNECTION_MESSAGES.CONNECTED,
      settingsLine: "Connected",
      settingsStatus: "Connected",
      sportsListOk: true,
      sportsCount: probe.sportsCount,
      ...probe,
      lastSuccessfulFetchAt: state.lastSuccessfulFetchAt || new Date().toISOString(),
      requestCount: state.requestCount || 0,
      lastError: probe.keyLengthWarning || "",
      cooldownRemainingMs: Math.max(0, Number(state.cooldownUntil || 0) - Date.now()),
      showError: Boolean(probe.keyLengthWarning),
      debugLine:
        probe.remainingRequests != null
          ? `${probe.sportsCount} sports · ${probe.remainingRequests} requests remaining`
          : `${probe.sportsCount} sports`,
    };
  }

  const settingsLine = `Failed (HTTP ${probe.httpStatus})`;
  const detailParts = [settingsLine, probe.responseBody].filter(Boolean);
  if (probe.keyLengthWarning) detailParts.push(probe.keyLengthWarning);

  return {
    provider: "Odds API",
    route: probe.route,
    keyConfigured: true,
    keyLength: probe.keyLength,
    keyLengthWarning: probe.keyLengthWarning,
    httpStatus: probe.httpStatus,
    responseBody: probe.responseBody,
    remainingRequests: probe.remainingRequests,
    sportsListOk: false,
    status: CONNECTION_STATUS.FAILED,
    message: detailParts.join(" — "),
    settingsLine,
    settingsStatus: settingsLine,
    ...probe,
    lastSuccessfulFetchAt: state.lastSuccessfulFetchAt || "",
    requestCount: state.requestCount || 0,
    lastError: detailParts.join(" — "),
    cooldownRemainingMs: Math.max(0, Number(state.cooldownUntil || 0) - Date.now()),
    showError: true,
    debugLine: detailParts.join(" · "),
  };
}


async function testSportsDataProvider() {
  const sportsDataKey = cleanApiKey(getSportsDataApiKey());
  const startedAt = Date.now();

  if (!sportsDataKey) {
    console.log("[SportsDataIO Test] Status: skipped — no key saved");
    return {
      provider: "SportsDataIO",
      keyConfigured: false,
      status: CONNECTION_STATUS.NOT_CONFIGURED,
      message: CONNECTION_MESSAGES.NOT_CONFIGURED,
      preview: "No SportsDataIO key configured",
      durationMs: 0,
      settingsLine: SPORTSDATA_STATUS_LABELS.NOT_CONFIGURED,
      statusLabel: SPORTSDATA_STATUS_LABELS.NOT_CONFIGURED,
      keySaved: false,
      endpointTests: [],
      explicitTest: true,
    };
  }

  const multi = await runSportsDataMultiEndpointTest({ apiKey: sportsDataKey });
  const state = getSourceState(SOURCE_IDS.SPORTSDATA);
  const primary = multi.primaryFailure || multi.endpointTests?.[0] || {};
  const playersTest = multi.endpointTests?.find((row) => row.id === "players") || primary;
  const detailMessage =
    multi.ok
      ? `All endpoints reachable — Players: ${playersTest.recordCount ?? "?"} records`
      : [multi.statusLabel, primary.message].filter(Boolean).join(" — ");

  return {
    provider: "SportsDataIO",
    keyConfigured: true,
    keySaved: true,
    keyLength: multi.keyLength,
    httpStatus: primary.httpStatus ?? 0,
    responseBody: primary.responseBody || primary.message || "",
    settingsLine: multi.settingsLine,
    settingsStatus: multi.settingsLine,
    statusLabel: multi.statusLabel,
    showError: multi.showError,
    debugLine: detailMessage,
    status: multi.ok ? CONNECTION_STATUS.LIVE : CONNECTION_STATUS.FAILED,
    message: detailMessage,
    proxied: true,
    ok: multi.ok,
    unauthorized:
      multi.statusLabel === SPORTSDATA_STATUS_LABELS.INVALID_KEY ||
      multi.statusLabel === SPORTSDATA_STATUS_LABELS.UNAUTHORIZED,
    rateLimited: multi.statusLabel === SPORTSDATA_STATUS_LABELS.RATE_LIMITED,
    endpointTests: multi.endpointTests,
    mlbStatsFallbackNote: multi.mlbStatsFallbackNote,
    explicitTest: true,
    durationMs: Date.now() - startedAt,
    lastSuccessfulFetchAt: multi.ok ? new Date().toISOString() : state.lastSuccessfulFetchAt || "",
    requestCount: state.requestCount || 0,
    lastError: multi.showError ? detailMessage : "",
    cooldownRemainingMs: Math.max(0, Number(state.cooldownUntil || 0) - Date.now()),
  };
}

/** Standalone Odds API probe. */
export async function testOddsAPI() {
  const startedAt = Date.now();
  const result = await testOddsApi();
  return {
    testedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    results: [result],
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

export function formatOddsTestNotice(row = {}) {
  if (!row || row.settingsLine === "Not configured") return "Add an Odds API key, then test again.";
  if (row.settingsLine === "Connected") {
    const parts = ["Odds API connected."];
    if (row.keyLength) parts.push(`Key length: ${row.keyLength}.`);
    if (row.remainingRequests != null) parts.push(`Requests remaining: ${row.remainingRequests}.`);
    if (row.keyLengthWarning) parts.push(row.keyLengthWarning);
    return parts.join(" ");
  }
  const parts = [`Odds API failed (HTTP ${row.httpStatus ?? row.status ?? "?"}).`];
  if (row.responseBody) parts.push(row.responseBody);
  if (row.keyLengthWarning) parts.push(row.keyLengthWarning);
  return parts.join(" ");
}

export function formatSportsDataTestNotice(row = {}) {
  if (!row || row.settingsLine === "Not configured" || row.settingsLine === SPORTSDATA_STATUS_LABELS.NOT_CONFIGURED) {
    return "Add a SportsDataIO key, then retest.";
  }
  if (row.settingsLine === "Connected" || row.statusLabel === SPORTSDATA_STATUS_LABELS.CONNECTED) {
    const parts = ["SportsDataIO connected."];
    if (row.keyLength) parts.push(`Key length: ${row.keyLength}.`);
    const endpointTests = row.endpointTests || [];
    endpointTests.forEach((test) => {
      parts.push(`${test.label}: HTTP ${test.httpStatus} — ${test.message || test.responseBody || "OK"}.`);
    });
    return parts.join(" ");
  }
  const label = row.statusLabel || row.settingsLine || "Failed";
  const parts = [`SportsDataIO: ${label}.`];
  (row.endpointTests || []).forEach((test) => {
    parts.push(`${test.label}: HTTP ${test.httpStatus ?? "?"} — ${test.message || test.responseBody || "—"}.`);
  });
  if (row.mlbStatsFallbackNote) parts.push(row.mlbStatsFallbackNote);
  return parts.join(" ");
}

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
