/**
 * Isolated live feed probes — HTTP + parse counts only, no board pipeline.
 */

import { getProxyUrl } from "../config/apiConfig.js";
import { lineFeedJsonHeaders, resilientFetch } from "../services/fetchUtil.js";
import { PRIZEPICKS_RETRY_TIMEOUTS_MS, UNDERDOG_RETRY_TIMEOUTS_MS } from "../utils/apiTimeout.js";
import { countPrizePicksRawRecords } from "../utils/prizepicksParse.js";
import { extractRawUnderdogRecords, parseUnderdogPayloadDedicated } from "../utils/parseUnderdogProp.js";
import {
  getPrizePicksEndpointInventory,
  getUnderdogEndpointInventory,
  resolveExactFailureReason,
} from "../utils/liveFeedFailureAnalysis.js";

function absoluteUrl(endpoint) {
  try {
    return new URL(endpoint, window.location.origin).toString();
  } catch {
    return endpoint;
  }
}

async function probeUrl(url, { timeoutMs = 5000, signal } = {}) {
  const startedAt = Date.now();
  const attempt = {
    url: absoluteUrl(url),
    httpStatus: null,
    responseBytes: 0,
    responseTimeMs: 0,
    ok: false,
    payload: null,
    error: "",
    nonJson: false,
  };

  try {
    const response = await resilientFetch(
      url,
      { cache: "no-store", headers: lineFeedJsonHeaders(), signal },
      { source: "LiveFeedProbe", ttlMs: 0, timeoutMs, maxRetries: 0, skip429Retry: true, signal }
    );
    attempt.httpStatus = response.status;
    const text = await response.text();
    attempt.responseBytes = text.length;
    attempt.responseTimeMs = Date.now() - startedAt;

    const trimmed = text.trim();
    if (!trimmed) {
      attempt.error = "Empty response body";
      return attempt;
    }
    if (trimmed.startsWith("<") || /text\/html/i.test(response.headers.get("content-type") || "")) {
      attempt.nonJson = true;
      attempt.error = "Non-JSON/HTML response";
      return attempt;
    }

    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch (parseError) {
      attempt.nonJson = true;
      attempt.error = `JSON parse failure: ${parseError.message || "invalid JSON"}`;
      return attempt;
    }

    attempt.payload = payload;
    attempt.ok = response.ok && !payload?.error;
    if (!response.ok) {
      attempt.error = `HTTP ${response.status}`;
    } else if (payload?.error) {
      attempt.error = String(payload.message || payload.error || "Proxy error payload");
    }
    return attempt;
  } catch (error) {
    attempt.responseTimeMs = Date.now() - startedAt;
    attempt.error = error?.message || String(error);
    if (/timed out|abort/i.test(attempt.error)) {
      attempt.timedOut = true;
    }
    return attempt;
  }
}

function countPrizePicksProps(payload) {
  if (!payload) return 0;
  try {
    return countPrizePicksRawRecords(payload);
  } catch {
    return Array.isArray(payload?.data) ? payload.data.length : 0;
  }
}

function countUnderdogProps(payload) {
  if (!payload) return { raw: 0, parsed: 0 };
  const raw = extractRawUnderdogRecords(payload).length;
  try {
    const { props = [] } = parseUnderdogPayloadDedicated(payload, "LIVE", "MLB");
    return { raw, parsed: props.length };
  } catch {
    return { raw, parsed: 0 };
  }
}

export async function testPrizePicksFeedProbe({ signal } = {}) {
  const inventory = getPrizePicksEndpointInventory();
  const endpoint = inventory.endpoints[0]?.path || "";
  if (!endpoint) {
    return {
      provider: "PrizePicks",
      endpoint: "",
      httpStatus: null,
      responseBytes: 0,
      responseTimeMs: 0,
      propCount: 0,
      status: "Not configured",
      ok: false,
      failure: resolveExactFailureReason({ notConfigured: true }),
      stages: { FETCHED: 0, PARSED: 0, NORMALIZED: 0, FILTERED: 0 },
    };
  }

  let lastAttempt = null;
  for (let i = 0; i < PRIZEPICKS_RETRY_TIMEOUTS_MS.length; i += 1) {
    if (signal?.aborted) break;
    lastAttempt = await probeUrl(endpoint, { timeoutMs: PRIZEPICKS_RETRY_TIMEOUTS_MS[i], signal });
    const fetched = lastAttempt.ok ? countPrizePicksProps(lastAttempt.payload) : 0;
    if (lastAttempt.ok && fetched > 0) break;
    if (i < PRIZEPICKS_RETRY_TIMEOUTS_MS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const fetched = lastAttempt?.ok ? countPrizePicksProps(lastAttempt.payload) : 0;
  const failure = resolveExactFailureReason({
    httpStatus: lastAttempt?.httpStatus,
    timedOut: Boolean(lastAttempt?.timedOut),
    lastError: lastAttempt?.error,
    fetched,
    parsed: fetched,
    normalized: fetched,
    filtered: fetched,
    nonJson: lastAttempt?.nonJson,
  });

  return {
    provider: "PrizePicks",
    endpoint: lastAttempt?.url || absoluteUrl(endpoint),
    httpStatus: lastAttempt?.httpStatus ?? null,
    responseBytes: lastAttempt?.responseBytes ?? 0,
    responseTimeMs: lastAttempt?.responseTimeMs ?? 0,
    propCount: fetched,
    status: lastAttempt?.ok && fetched > 0 ? "Connected" : failure.label || "Failed",
    ok: Boolean(lastAttempt?.ok && fetched > 0),
    failure,
    stages: {
      FETCHED: fetched,
      PARSED: fetched,
      NORMALIZED: fetched,
      FILTERED: fetched,
    },
    message: lastAttempt?.error || "",
  };
}

export async function testUnderdogFeedProbe({ signal } = {}) {
  const inventory = getUnderdogEndpointInventory();
  const routes = inventory.endpoints.map((row) => row.path).filter(Boolean);
  if (!routes.length) {
    routes.push("/api/underdog");
  }

  let lastAttempt = null;
  let best = null;

  for (const route of routes) {
    if (signal?.aborted) break;
    for (let i = 0; i < UNDERDOG_RETRY_TIMEOUTS_MS.length; i += 1) {
      if (signal?.aborted) break;
      lastAttempt = await probeUrl(route, { timeoutMs: UNDERDOG_RETRY_TIMEOUTS_MS[i], signal });
      const counts = lastAttempt.ok ? countUnderdogProps(lastAttempt.payload) : { raw: 0, parsed: 0 };
      if (lastAttempt.ok && counts.parsed > 0) {
        best = { attempt: lastAttempt, counts, route };
        break;
      }
      if (i < UNDERDOG_RETRY_TIMEOUTS_MS.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (best) break;
  }

  const attempt = best?.attempt || lastAttempt;
  const counts = best?.counts || (attempt?.ok ? countUnderdogProps(attempt.payload) : { raw: 0, parsed: 0 });
  const endpointDeprecated =
    Number(attempt?.httpStatus) === 404 ||
    (attempt && !attempt.ok && /404|not found/i.test(String(attempt.error || "")));

  const failure = resolveExactFailureReason({
    httpStatus: attempt?.httpStatus,
    timedOut: Boolean(attempt?.timedOut),
    lastError: attempt?.error,
    fetched: counts.raw,
    parsed: counts.parsed,
    normalized: counts.parsed,
    filtered: counts.parsed,
    endpointDeprecated,
    nonJson: attempt?.nonJson,
  });

  return {
    provider: "Underdog",
    endpoint: attempt?.url || absoluteUrl(routes[0]),
    httpStatus: attempt?.httpStatus ?? null,
    responseBytes: attempt?.responseBytes ?? 0,
    responseTimeMs: attempt?.responseTimeMs ?? 0,
    propCount: counts.parsed,
    status: best ? "Connected" : failure.label || "Failed",
    ok: Boolean(best),
    failure,
    endpointDeprecated,
    stages: {
      FETCHED: counts.raw,
      PARSED: counts.parsed,
      NORMALIZED: counts.parsed,
      FILTERED: counts.parsed,
    },
    message: attempt?.error || "",
  };
}
