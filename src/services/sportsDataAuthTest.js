import { cleanApiKey } from "../utils/cleanApiKey.js";
import { getSportsDataApiKey, getSportsDataApiKeySource } from "../config/apiConfig.js";
import {
  getSportsDataHealthTimeoutMs,
  SPORTSDATA_HEALTH_MAX_RETRIES,
} from "../utils/apiTimeout.js";

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
  TIMEOUT: "Timed out",
  NOT_CONFIGURED: "Not configured",
};

function isoDateLocal(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

export function buildSportsDataTestEndpoints(date = new Date()) {
  const day = isoDateLocal(date);
  return [
    {
      id: "teams",
      label: "Teams",
      upstreamPath: "/scores/json/Teams",
      proxyRoute: `${SPORTSDATA_MLB_BASE_ROUTE}/scores/json/Teams`,
      lightweight: true,
    },
    {
      id: "players",
      label: "Players",
      upstreamPath: SPORTSDATA_MLB_PLAYERS_PATH,
      proxyRoute: `${SPORTSDATA_MLB_BASE_ROUTE}${SPORTSDATA_MLB_PLAYERS_PATH}`,
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
    return { statusLabel: SPORTSDATA_STATUS_LABELS.TIMEOUT, message: body || "Request timed out" };
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

export async function probeSportsDataEndpointViaProxy(endpoint, { apiKey = "", timeoutMs = null } = {}) {
  const cleanedKey = cleanApiKey(apiKey || getSportsDataApiKey());
  const upstreamUrl = redactSportsDataUpstreamUrl(endpoint.upstreamPath);
  const startedAt = Date.now();
  const probeTimeoutMs = timeoutMs ?? getSportsDataHealthTimeoutMs();

  if (!cleanedKey) {
    return {
      ...endpoint,
      upstreamUrl,
      httpStatus: 0,
      ok: false,
      timedOut: false,
      includedInPlan: false,
      statusLabel: SPORTSDATA_STATUS_LABELS.NOT_CONFIGURED,
      message: "No SportsDataIO key saved",
      responseBody: "No SportsDataIO key saved",
      durationMs: 0,
    };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), probeTimeoutMs);

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
    console.info("[API HEALTH] SportsDataIO response code:", httpStatus);
    console.info("[API HEALTH] SportsDataIO response preview:", responseBody);

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
        timedOut: false,
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
      timedOut: false,
      includedInPlan:
        failure.statusLabel === SPORTSDATA_STATUS_LABELS.ENDPOINT_NOT_INCLUDED
          ? false
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
    console.error("[API HEALTH] SportsDataIO probe error:", error?.message || error);
    return {
      ...endpoint,
      upstreamUrl,
      httpStatus: timedOut ? 408 : 0,
      ok: false,
      timedOut,
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

async function probeSportsDataEndpointWithRetry(endpoint, { apiKey = "" } = {}) {
  let lastResult = null;
  for (let attempt = 0; attempt < SPORTSDATA_HEALTH_MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
    lastResult = await probeSportsDataEndpointViaProxy(endpoint, { apiKey });
    console.info(
      `[SportsDataIO Test] ${endpoint.label} attempt ${attempt + 1}/${SPORTSDATA_HEALTH_MAX_RETRIES}: HTTP ${lastResult.httpStatus} · ${lastResult.statusLabel}`
    );
    if (lastResult.ok) return lastResult;
    if (lastResult.httpStatus === 401 || lastResult.httpStatus === 403) return lastResult;
    if (!lastResult.timedOut) break;
  }
  return lastResult;
}

export function resolveSportsDataOverallStatus(endpointTests = []) {
  const tests = endpointTests || [];
  if (!tests.length) {
    return {
      statusLabel: SPORTSDATA_STATUS_LABELS.NOT_CONFIGURED,
      settingsLine: SPORTSDATA_STATUS_LABELS.NOT_CONFIGURED,
      ok: false,
      showError: true,
      timedOut: false,
    };
  }
  const okCount = tests.filter((row) => row.ok).length;
  if (okCount > 0) {
    return {
      statusLabel: SPORTSDATA_STATUS_LABELS.CONNECTED,
      settingsLine: SPORTSDATA_STATUS_LABELS.CONNECTED,
      ok: true,
      showError: false,
      timedOut: false,
    };
  }
  const timedOut = tests.every((row) => row.timedOut || row.statusLabel === SPORTSDATA_STATUS_LABELS.TIMEOUT);
  if (timedOut) {
    return {
      statusLabel: SPORTSDATA_STATUS_LABELS.TIMEOUT,
      settingsLine: SPORTSDATA_STATUS_LABELS.TIMEOUT,
      ok: false,
      showError: true,
      timedOut: true,
      primaryFailure: tests[0],
    };
  }
  const priority = [
    SPORTSDATA_STATUS_LABELS.INVALID_KEY,
    SPORTSDATA_STATUS_LABELS.UNAUTHORIZED,
    SPORTSDATA_STATUS_LABELS.ENDPOINT_NOT_INCLUDED,
    SPORTSDATA_STATUS_LABELS.RATE_LIMITED,
    SPORTSDATA_STATUS_LABELS.PROXY_ERROR,
    SPORTSDATA_STATUS_LABELS.NETWORK_ERROR,
    SPORTSDATA_STATUS_LABELS.TIMEOUT,
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

  console.info("[API HEALTH] SportsDataIO key source:", getSportsDataApiKeySource());

  const lightweight = endpoints.find((row) => row.lightweight) || endpoints[0];
  const keyCheck = await probeSportsDataEndpointWithRetry(lightweight, { apiKey: cleanedKey });
  endpointTests.push(keyCheck);

  if (keyCheck.ok) {
    for (const endpoint of endpoints.filter((row) => row.id !== lightweight.id)) {
      const result = await probeSportsDataEndpointWithRetry(endpoint, { apiKey: cleanedKey });
      endpointTests.push(result);
      console.info(
        `[SportsDataIO Test] ${endpoint.label}: HTTP ${result.httpStatus} · ${result.statusLabel} · ${result.message}`
      );
    }
  } else if (keyCheck.httpStatus !== 401 && keyCheck.httpStatus !== 403) {
    for (const endpoint of endpoints.filter((row) => row.id !== lightweight.id)) {
      const result = await probeSportsDataEndpointWithRetry(endpoint, { apiKey: cleanedKey });
      endpointTests.push(result);
      if (result.ok) break;
    }
  }

  const overall = resolveSportsDataOverallStatus(endpointTests);
  const primaryFailure = overall.primaryFailure || endpointTests.find((row) => !row.ok) || endpointTests[0];
  console.info("[API HEALTH] SportsDataIO status:", overall.statusLabel);
  if (primaryFailure) {
    console.info("[API HEALTH] SportsDataIO response code:", primaryFailure.httpStatus ?? "—");
    console.info("[API HEALTH] SportsDataIO response preview:", primaryFailure.responseBody || primaryFailure.message || "—");
  }

  const mlbStatsFallbackNote =
    overall.ok || !cleanedKey
      ? ""
      : "SportsDataIO unavailable — using MLB Stats + generated projections.";

  return {
    cleanedKey,
    keyLength: cleanedKey.length,
    endpointTests,
    ...overall,
    mlbStatsFallbackNote,
  };
}
