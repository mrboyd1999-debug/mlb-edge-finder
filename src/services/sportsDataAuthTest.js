import { cleanApiKey } from "../utils/cleanApiKey.js";
import { getSportsDataApiKey } from "../config/apiConfig.js";
import { getSportsDataTimeoutMs } from "../utils/apiTimeout.js";

export const SPORTSDATA_MLB_UPSTREAM = "https://api.sportsdata.io/v3/mlb";
export const SPORTSDATA_MLB_PLAYERS_PATH = "/scores/json/Players";

export const SPORTSDATA_PROXY_HEADER = "X-SportsData-Api-Key";
export const SPORTSDATA_MLB_BASE_ROUTE = "/api/sportsdataio";

export const SPORTSDATA_STATUS_LABELS = {
  CONNECTED: "Connected",
  INVALID_KEY: "Invalid key",
  UNAUTHORIZED: "Unauthorized",
  ENDPOINT_NOT_INCLUDED: "Endpoint not included in plan",
  RATE_LIMITED: "Rate limited",
  PROXY_ERROR: "Proxy error",
  NETWORK_ERROR: "Network error",
  NOT_CONFIGURED: "Not configured",
};

function isoDateLocal(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

export function buildSportsDataTestEndpoints(date = new Date()) {
  const day = isoDateLocal(date);
  return [
    {
      id: "players",
      label: "Players",
      upstreamPath: SPORTSDATA_MLB_PLAYERS_PATH,
      proxyRoute: `${SPORTSDATA_MLB_BASE_ROUTE}${SPORTSDATA_MLB_PLAYERS_PATH}`,
    },
    {
      id: "teams",
      label: "Teams",
      upstreamPath: "/scores/json/Teams",
      proxyRoute: `${SPORTSDATA_MLB_BASE_ROUTE}/scores/json/Teams`,
    },
    {
      id: "gamesByDate",
      label: "Games by date",
      upstreamPath: `/scores/json/GamesByDate/${day}`,
      proxyRoute: `${SPORTSDATA_MLB_BASE_ROUTE}/scores/json/GamesByDate/${day}`,
    },
  ];
}

export function redactSportsDataUpstreamUrl(path = "") {
  const normalized = String(path || "").startsWith("/") ? path : `/${path || ""}`;
  return `${SPORTSDATA_MLB_UPSTREAM}${normalized}`;
}

function summarizeResponseBody(text = "", payload = null, max = 220) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if (payload.message) return String(payload.message).slice(0, max);
    if (payload.preview) return String(payload.preview).slice(0, max);
  }
  return String(text || "")
    .trim()
    .slice(0, max)
    .replace(/\s+/g, " ");
}

function planDenied(text = "", status = 0) {
  const body = String(text || "").toLowerCase();
  if (status === 403) return true;
  return /subscription|not included|not authorized|forbidden|access denied|endpoint|plan|package|quota|product/.test(body);
}

function invalidKey(text = "", status = 0) {
  const body = String(text || "").toLowerCase();
  if (status === 401 && /invalid|missing|unknown|apikey|subscription key/.test(body)) return true;
  return status === 401 && body.length < 120 && !planDenied(text, status);
}

export function classifySportsDataFailure({ httpStatus = 0, text = "", timedOut = false, networkError = false, proxyError = false } = {}) {
  const status = Number(httpStatus) || 0;
  const body = summarizeResponseBody(text);

  if (timedOut) {
    return { statusLabel: SPORTSDATA_STATUS_LABELS.NETWORK_ERROR, message: body || "Request timed out" };
  }
  if (networkError) {
    return { statusLabel: SPORTSDATA_STATUS_LABELS.NETWORK_ERROR, message: body || "Network request failed" };
  }
  if (proxyError || status === 502 || status === 503 || status === 504) {
    return { statusLabel: SPORTSDATA_STATUS_LABELS.PROXY_ERROR, message: body || `Proxy returned HTTP ${status || "?"}` };
  }
  if (status === 429) {
    return { statusLabel: SPORTSDATA_STATUS_LABELS.RATE_LIMITED, message: body || "Too many requests" };
  }
  if (planDenied(text, status)) {
    return {
      statusLabel: SPORTSDATA_STATUS_LABELS.ENDPOINT_NOT_INCLUDED,
      message: body || "This MLB endpoint is not included in your subscription",
    };
  }
  if (invalidKey(text, status)) {
    return { statusLabel: SPORTSDATA_STATUS_LABELS.INVALID_KEY, message: body || "SportsDataIO rejected the API key" };
  }
  if (status === 401 || status === 403) {
    return { statusLabel: SPORTSDATA_STATUS_LABELS.UNAUTHORIZED, message: body || `HTTP ${status}` };
  }
  if (status >= 400) {
    return { statusLabel: SPORTSDATA_STATUS_LABELS.PROXY_ERROR, message: body || `HTTP ${status}` };
  }
  return { statusLabel: SPORTSDATA_STATUS_LABELS.NETWORK_ERROR, message: body || "Unknown error" };
}

export async function probeSportsDataEndpointViaProxy(endpoint, { apiKey = "" } = {}) {
  const cleanedKey = cleanApiKey(apiKey || getSportsDataApiKey());
  const upstreamUrl = redactSportsDataUpstreamUrl(endpoint.upstreamPath);
  const startedAt = Date.now();

  console.info("[SportsDataIO Test] URL:", upstreamUrl, "· key length:", cleanedKey.length);

  if (!cleanedKey) {
    return {
      ...endpoint,
      upstreamUrl,
      httpStatus: 0,
      ok: false,
      includedInPlan: false,
      statusLabel: SPORTSDATA_STATUS_LABELS.NOT_CONFIGURED,
      message: "No SportsDataIO key saved",
      responseBody: "No SportsDataIO key saved",
      durationMs: 0,
    };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), getSportsDataTimeoutMs());

  try {
    const response = await fetch(endpoint.proxyRoute, {
      headers: {
        accept: "application/json",
        [SPORTSDATA_PROXY_HEADER]: cleanedKey,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    const httpStatus = Number(payload?.responseCode ?? response.status ?? 0);
    const responseBody = summarizeResponseBody(text, payload);
    const arrayOk = response.ok && Array.isArray(payload);
    const envelopeOk =
      response.ok &&
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      payload.ok === false &&
      Number(payload.responseCode) >= 400;
    const ok = arrayOk && !envelopeOk;

    if (ok) {
      return {
        ...endpoint,
        upstreamUrl,
        httpStatus: 200,
        ok: true,
        includedInPlan: true,
        statusLabel: SPORTSDATA_STATUS_LABELS.CONNECTED,
        message: `OK — ${payload.length} records`,
        responseBody: `OK — ${payload.length} records`,
        recordCount: payload.length,
        durationMs: Date.now() - startedAt,
      };
    }

    const failure = classifySportsDataFailure({
      httpStatus,
      text: responseBody || text,
      proxyError: httpStatus === 502 || httpStatus === 503 || httpStatus === 504,
    });

    return {
      ...endpoint,
      upstreamUrl,
      httpStatus,
      ok: false,
      includedInPlan:
        failure.statusLabel === SPORTSDATA_STATUS_LABELS.ENDPOINT_NOT_INCLUDED
          ? false
          : failure.statusLabel === SPORTSDATA_STATUS_LABELS.INVALID_KEY ||
              failure.statusLabel === SPORTSDATA_STATUS_LABELS.UNAUTHORIZED
            ? null
            : null,
      statusLabel: failure.statusLabel,
      message: failure.message,
      responseBody: failure.message,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    const failure = classifySportsDataFailure({
      httpStatus: timedOut ? 408 : 0,
      text: error?.message || "",
      timedOut,
      networkError: !timedOut,
    });
    return {
      ...endpoint,
      upstreamUrl,
      httpStatus: timedOut ? 408 : 0,
      ok: false,
      includedInPlan: false,
      statusLabel: failure.statusLabel,
      message: failure.message,
      responseBody: failure.message,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export function resolveSportsDataOverallStatus(endpointTests = []) {
  const tests = endpointTests || [];
  if (!tests.length) {
    return {
      statusLabel: SPORTSDATA_STATUS_LABELS.NOT_CONFIGURED,
      settingsLine: SPORTSDATA_STATUS_LABELS.NOT_CONFIGURED,
      ok: false,
      showError: true,
    };
  }
  const okCount = tests.filter((row) => row.ok).length;
  if (okCount > 0) {
    return {
      statusLabel: SPORTSDATA_STATUS_LABELS.CONNECTED,
      settingsLine: SPORTSDATA_STATUS_LABELS.CONNECTED,
      ok: true,
      showError: false,
    };
  }
  const priority = [
    SPORTSDATA_STATUS_LABELS.INVALID_KEY,
    SPORTSDATA_STATUS_LABELS.UNAUTHORIZED,
    SPORTSDATA_STATUS_LABELS.ENDPOINT_NOT_INCLUDED,
    SPORTSDATA_STATUS_LABELS.RATE_LIMITED,
    SPORTSDATA_STATUS_LABELS.PROXY_ERROR,
    SPORTSDATA_STATUS_LABELS.NETWORK_ERROR,
  ];
  for (const label of priority) {
    const match = tests.find((row) => row.statusLabel === label);
    if (match) {
      return {
        statusLabel: label,
        settingsLine: label,
        ok: false,
        showError: true,
        primaryFailure: match,
      };
    }
  }
  const first = tests[0];
  return {
    statusLabel: first?.statusLabel || SPORTSDATA_STATUS_LABELS.NETWORK_ERROR,
    settingsLine: first?.statusLabel || SPORTSDATA_STATUS_LABELS.NETWORK_ERROR,
    ok: false,
    showError: true,
    primaryFailure: first,
  };
}

export async function runSportsDataMultiEndpointTest({ apiKey = "" } = {}) {
  const cleanedKey = cleanApiKey(apiKey || getSportsDataApiKey());
  const endpoints = buildSportsDataTestEndpoints();
  const endpointTests = [];

  for (const endpoint of endpoints) {
    const result = await probeSportsDataEndpointViaProxy(endpoint, { apiKey: cleanedKey });
    endpointTests.push(result);
    console.info(
      `[SportsDataIO Test] ${endpoint.label}: HTTP ${result.httpStatus} · ${result.statusLabel} · ${result.message}`
    );
  }

  const overall = resolveSportsDataOverallStatus(endpointTests);
  const mlbStatsFallbackNote =
    overall.ok || !cleanedKey
      ? ""
      : "SportsDataIO unavailable — using MLB Stats API for player matching and projections.";

  return {
    cleanedKey,
    keyLength: cleanedKey.length,
    endpointTests,
    ...overall,
    mlbStatsFallbackNote,
  };
}
