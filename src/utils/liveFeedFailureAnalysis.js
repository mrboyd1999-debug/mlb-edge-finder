/**
 * Live feed failure classification and endpoint inventory (diagnostics only).
 */

import { getProxyUrl, getRawProxyUrl } from "../config/apiConfig.js";
import { assessProxyUrl } from "../utils/providerProxy.js";

export const LIVE_STAGE_LABELS = {
  FETCHED: "FETCHED",
  PARSED: "PARSED",
  NORMALIZED: "NORMALIZED",
  FILTERED: "FILTERED",
};

export const EXACT_FAILURE_CODES = {
  ENDPOINT_DEPRECATED: "Endpoint deprecated",
  NOT_CONFIGURED: "Not configured",
  NETWORK_TIMEOUT: "Network timeout",
  RATE_LIMIT: "429 rate limit",
  FORBIDDEN: "403 forbidden",
  NOT_FOUND: "404 endpoint changed",
  JSON_PARSE: "JSON parse failure",
  NORMALIZATION: "Normalization failure",
  FILTER: "Filter removing everything",
  FETCH: "Fetch failure",
  UNKNOWN: "Unknown failure",
};

/** Canonical Underdog routes — keep in sync with underdog.js UNDERDOG_ENDPOINTS */
export const UNDERDOG_ENDPOINT_INVENTORY = [
  { path: "/api/underdog/beta/v5/over_under_lines", label: "Underdog v5 lines", primary: true },
  { path: "/api/underdog", label: "Underdog proxy route", primary: false },
  { path: "/api/underdog/beta/v3/over_under_lines", label: "Underdog v3 lines (legacy)", deprecated: true },
];

export function getPrizePicksEndpointInventory() {
  const proxyUrl = getProxyUrl("prizepicks");
  const rawProxy = getRawProxyUrl("prizepicks");
  const assessment = assessProxyUrl(rawProxy);
  return {
    configured: Boolean(proxyUrl),
    invalid: Boolean(rawProxy) && !proxyUrl,
    endpoints: proxyUrl ? [{ path: proxyUrl, label: "PrizePicks proxy URL", primary: true }] : [],
    rawProxy: rawProxy || "",
  };
}

export function getUnderdogEndpointInventory() {
  const proxyUrl = getProxyUrl("underdog");
  const rawProxy = getRawProxyUrl("underdog");
  const assessment = assessProxyUrl(rawProxy);
  const endpoints = UNDERDOG_ENDPOINT_INVENTORY.map((row) => ({ ...row }));
  if (proxyUrl) {
    try {
      const url = new URL("/api/underdog", window.location.origin);
      url.searchParams.set("proxyUrl", proxyUrl);
      endpoints.unshift({
        path: url.pathname + url.search,
        label: "Underdog configured proxy",
        primary: true,
      });
    } catch {
      // ignore
    }
  }
  return {
    configured: Boolean(proxyUrl) || !assessment.invalid,
    invalid: assessment.invalid,
    endpoints,
    rawProxy: rawProxy || "",
  };
}

export function resolveExactFailureReason({
  httpStatus = null,
  timedOut = false,
  notConfigured = false,
  lastError = "",
  fetched = 0,
  parsed = 0,
  normalized = 0,
  filtered = 0,
  endpointDeprecated = false,
  nonJson = false,
  usedCache = false,
  liveFetchFailed = false,
} = {}) {
  if (endpointDeprecated) {
    return { code: "ENDPOINT_DEPRECATED", label: EXACT_FAILURE_CODES.ENDPOINT_DEPRECATED };
  }
  if (notConfigured) {
    return { code: "NOT_CONFIGURED", label: EXACT_FAILURE_CODES.NOT_CONFIGURED };
  }
  if (timedOut) {
    return { code: "NETWORK_TIMEOUT", label: EXACT_FAILURE_CODES.NETWORK_TIMEOUT };
  }
  const status = Number(httpStatus);
  if (status === 429) return { code: "RATE_LIMIT", label: EXACT_FAILURE_CODES.RATE_LIMIT };
  if (status === 403) return { code: "FORBIDDEN", label: EXACT_FAILURE_CODES.FORBIDDEN };
  if (status === 404) return { code: "NOT_FOUND", label: EXACT_FAILURE_CODES.NOT_FOUND };

  const err = String(lastError || "").toLowerCase();
  if (nonJson || /non-json|invalid json|json parse|unexpected token|malformed json/i.test(err)) {
    return { code: "JSON_PARSE", label: EXACT_FAILURE_CODES.JSON_PARSE };
  }
  if (fetched > 0 && parsed === 0) {
    return { code: "JSON_PARSE", label: EXACT_FAILURE_CODES.JSON_PARSE };
  }
  if (parsed > 0 && normalized === 0) {
    return { code: "NORMALIZATION", label: EXACT_FAILURE_CODES.NORMALIZATION };
  }
  if (normalized > 0 && filtered === 0) {
    return { code: "FILTER", label: EXACT_FAILURE_CODES.FILTER };
  }
  if (fetched === 0 && (liveFetchFailed || !usedCache)) {
    return { code: "FETCH", label: EXACT_FAILURE_CODES.FETCH };
  }
  if (lastError) {
    return { code: "UNKNOWN", label: lastError };
  }
  return { code: "", label: "" };
}

export function detectEndpointDeprecated({ httpStatus = null, lastError = "", endpointsTried = [] } = {}) {
  const status = Number(httpStatus);
  if (status === 404) return true;
  const err = String(lastError || "").toLowerCase();
  if (/404|not found|endpoint.*changed|deprecated|no longer available/i.test(err)) return true;
  const tries = Array.isArray(endpointsTried) ? endpointsTried : [];
  if (tries.length >= 2 && tries.every((url) => /404|not found/i.test(String(url)))) return true;
  return false;
}

export function auditProviderEndpoints() {
  const pp = getPrizePicksEndpointInventory();
  const ud = getUnderdogEndpointInventory();
  return {
    prizepicks: pp,
    underdog: ud,
    warnings: [
      !pp.configured ? "PrizePicks proxy URL not configured" : "",
      pp.invalid ? "PrizePicks proxy URL is invalid" : "",
      ud.invalid ? "Underdog proxy URL is invalid" : "",
    ].filter(Boolean),
  };
}
