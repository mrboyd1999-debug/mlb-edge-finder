/**
 * Last PrizePicks fetch diagnostics — updated on every refresh attempt.
 * Read via getPrizePicksDiagnostics() or window.__PRIZEPICKS_DIAGNOSTICS__
 */

import { recordProviderFetchMetrics } from "./providerFetchDiagnostics.js";

const EMPTY = {
  requestUrl: "",
  proxyMode: "",
  externalProxyHost: "",
  proxyConfigured: false,
  missingConfiguration: "",
  configKeysChecked: [],
  expectedFormat: "",
  exampleProxyUrl: "",
  requestSent: false,
  requestSentAt: "",
  responseReceived: false,
  responseReceivedAt: "",
  httpExecuted: false,
  statusCode: null,
  responseSize: 0,
  responseBodyLength: 0,
  responseHeaders: {},
  responseTimeMs: null,
  timedOut: false,
  outerTimeout: false,
  networkError: false,
  captchaDetected: false,
  blockedPayloadDetected: false,
  rawPropCount: 0,
  parsedPropsCount: 0,
  finalPropsCount: 0,
  mlbScopedCount: 0,
  normalizedCount: 0,
  validationCount: 0,
  mlbUsableCount: 0,
  usedCacheFallback: false,
  liveFetchFailureReason: "",
  lastError: "",
  failureReason: "",
  failureCategory: "",
  providerStatus: "",
  uiConnectionTier: "",
  failureClass: "",
  filterReasons: {},
  attempts: [],
  updatedAt: "",
};

let snapshot = { ...EMPTY };

export function getPrizePicksDiagnostics() {
  return { ...snapshot };
}

export function resetPrizePicksDiagnostics() {
  snapshot = { ...EMPTY, updatedAt: new Date().toISOString() };
  publish();
  return snapshot;
}

export function headersToRecord(headers) {
  if (!headers) return {};
  const out = {};
  try {
    if (typeof headers.forEach === "function") {
      headers.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    }
    if (typeof headers === "object") return { ...headers };
  } catch {
    // ignore
  }
  return out;
}

/** Map runtime outcome to a single failure classification for the diagnostics panel. */
export function classifyPrizePicksFailure({
  notConfigured = false,
  timedOut = false,
  outerTimeout = false,
  httpExecuted = false,
  statusCode = null,
  rawPropCount = 0,
  parsedPropsCount = 0,
  validationCount = 0,
  providerStatus = "",
  lastError = "",
  networkError = false,
  captchaDetected = false,
  blockedPayloadDetected = false,
  usedCacheFallback = false,
} = {}) {
  if (notConfigured) return "MISSING_PROXY";
  if (outerTimeout || timedOut) return "TIMEOUT";
  if (!httpExecuted && !notConfigured) return "NO_HTTP_REQUEST";
  if (networkError && !statusCode) return "NETWORK_ERROR";
  if (captchaDetected) return "CAPTCHA_RESPONSE";
  if (blockedPayloadDetected) return "BLOCKED_PAYLOAD";
  if (statusCode === 401) return "HTTP_401";
  if (statusCode === 403) return "HTTP_403";
  if (statusCode === 429) return "HTTP_429";
  if (statusCode != null && statusCode >= 400) return `HTTP_${statusCode}`;
  if (/cors|failed to fetch|network/i.test(String(lastError || ""))) return "CORS_OR_NETWORK";
  if (usedCacheFallback) return "CACHE_FALLBACK";
  if (providerStatus === "Failed" || providerStatus === "failed") return "PROVIDER_FAILED_PAYLOAD";
  if (rawPropCount > 0 && parsedPropsCount === 0) return "PARSER_ZERO_PROPS";
  if (rawPropCount > 0 && validationCount === 0) return "PARSE_OR_FILTER_ZERO_USABLE";
  if (rawPropCount === 0 && httpExecuted) return "ZERO_RAW_PROPS";
  if (providerStatus === "Empty" && validationCount === 0) return "ZERO_USABLE_AFTER_PARSE";
  return "";
}

export function diagnosePrizePicksFailure(d = {}) {
  const requestSent = Boolean(d.requestSent || d.httpExecuted);
  const responseReceived = Boolean(d.responseReceived || d.httpExecuted);
  const raw = Number(d.rawPropCount ?? 0);
  const parsed = Number(d.parsedPropsCount ?? d.normalizedCount ?? 0);
  const final = Number(d.finalPropsCount ?? d.validationCount ?? 0);

  if (!d.proxyConfigured) {
    return {
      category: "REQUEST_NEVER_SENT",
      reason: d.lastError || d.failureReason || "PrizePicks proxy URL not configured — request never sent.",
      failureClass: "MISSING_PROXY",
    };
  }

  if (d.outerTimeout || (d.timedOut && !responseReceived)) {
    return {
      category: "OUTER_TIMEOUT",
      reason:
        d.lastError ||
        d.failureReason ||
        `Provider wrapper timed out before response (${d.responseTimeMs ?? "?"}ms).`,
      failureClass: "TIMEOUT",
    };
  }

  if (d.timedOut || /timed out|abort/i.test(String(d.lastError || ""))) {
    return {
      category: "TIMEOUT",
      reason: d.lastError || d.failureReason || "PrizePicks request timed out before a usable response.",
      failureClass: "TIMEOUT",
    };
  }

  if (d.networkError && !responseReceived) {
    return {
      category: "REQUEST_NEVER_REACHED",
      reason:
        d.lastError ||
        d.failureReason ||
        "Network error — request may not have reached the endpoint (connection refused, CORS, or DNS).",
      failureClass: "NETWORK_ERROR",
    };
  }

  if (d.captchaDetected) {
    return {
      category: "CAPTCHA_RESPONSE",
      reason:
        d.lastError ||
        "Endpoint returned PerimeterX/captcha JSON instead of projections (keys like appId, blockScript).",
      failureClass: "CAPTCHA_RESPONSE",
    };
  }

  if (d.blockedPayloadDetected) {
    return {
      category: "BLOCKED_PAYLOAD",
      reason: d.lastError || "Endpoint returned a blocked/bot-protection payload instead of projection rows.",
      failureClass: "BLOCKED_PAYLOAD",
    };
  }

  if (responseReceived && d.statusCode != null && d.statusCode >= 400) {
    return {
      category: "HTTP_ERROR",
      reason: d.lastError || `HTTP ${d.statusCode} from PrizePicks endpoint.`,
      failureClass: classifyPrizePicksFailure(d),
    };
  }

  if (responseReceived && raw === 0 && !d.captchaDetected && !d.blockedPayloadDetected) {
    return {
      category: "ZERO_RAW_ROWS",
      reason:
        d.lastError ||
        d.failureReason ||
        `Response received (${d.responseBodyLength ?? d.responseSize ?? 0} chars) but no raw projection rows.`,
      failureClass: "ZERO_RAW_PROPS",
    };
  }

  if (raw > 0 && parsed === 0) {
    return {
      category: "PARSER_ZERO_PROPS",
      reason:
        d.lastError ||
        d.failureReason ||
        `Raw rows present (${raw}) but parser extracted 0 props — check JSON:API shape or included players.`,
      failureClass: "PARSER_ZERO_PROPS",
    };
  }

  if (parsed > 0 && final === 0) {
    return {
      category: "FILTER_ZERO_PROPS",
      reason:
        d.lastError ||
        d.failureReason ||
        `Parsed ${parsed} props but filters/validation left 0 usable MLB props.`,
      failureClass: "PARSE_OR_FILTER_ZERO_USABLE",
    };
  }

  if (d.usedCacheFallback) {
    return {
      category: "CACHE_FALLBACK",
      reason:
        d.liveFetchFailureReason ||
        d.failureReason ||
        "Live fetch failed — served cached props from localStorage (not a fresh endpoint response).",
      failureClass: "CACHE_FALLBACK",
    };
  }

  if (final > 0) {
    return {
      category: "SUCCESS",
      reason: "",
      failureClass: "",
    };
  }

  return {
    category: "UNKNOWN",
    reason: d.lastError || d.failureReason || "PrizePicks fetch failed for an unknown reason.",
    failureClass: classifyPrizePicksFailure(d) || "UNKNOWN",
  };
}

function syncProviderFetchMetrics(patch = {}) {
  recordProviderFetchMetrics("PrizePicks", {
    responseTimeMs: patch.responseTimeMs,
    httpStatus: patch.statusCode,
    payloadSize: patch.responseBodyLength ?? patch.responseSize,
    rawPropCount: patch.rawPropCount,
    parsedPropsCount: patch.parsedPropsCount ?? patch.normalizedCount,
    finalPropsCount: patch.finalPropsCount ?? patch.validationCount,
    timedOut: patch.timedOut,
    lastError: patch.failureReason || patch.lastError,
    requestUrl: patch.requestUrl,
    responseHeaders: patch.responseHeaders,
    captchaDetected: patch.captchaDetected,
    blockedPayloadDetected: patch.blockedPayloadDetected,
    requestSent: patch.requestSent,
    responseReceived: patch.responseReceived,
    failureReason: patch.failureReason,
    failureCategory: patch.failureCategory,
  });
}

export function updatePrizePicksDiagnostics(patch = {}) {
  const merged = {
    ...snapshot,
    ...patch,
  };
  const diagnosis = diagnosePrizePicksFailure(merged);
  snapshot = {
    ...merged,
    failureReason: patch.failureReason || diagnosis.reason || merged.failureReason || "",
    failureCategory: diagnosis.category,
    failureClass:
      patch.failureClass ||
      diagnosis.failureClass ||
      classifyPrizePicksFailure(merged) ||
      merged.failureClass ||
      "",
    updatedAt: new Date().toISOString(),
  };
  publish();
  syncProviderFetchMetrics(snapshot);
  return snapshot;
}

function publish() {
  if (typeof window === "undefined") return;
  window.__PRIZEPICKS_DIAGNOSTICS__ = { ...snapshot };
}
