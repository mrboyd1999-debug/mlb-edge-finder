/**
 * Last PrizePicks fetch diagnostics — updated on every refresh attempt.
 * Read via getPrizePicksDiagnostics() or window.__PRIZEPICKS_DIAGNOSTICS__
 */

const EMPTY = {
  requestUrl: "",
  proxyMode: "",
  externalProxyHost: "",
  proxyConfigured: false,
  missingConfiguration: "",
  configKeysChecked: [],
  expectedFormat: "",
  exampleProxyUrl: "",
  httpExecuted: false,
  statusCode: null,
  responseSize: 0,
  rawPropCount: 0,
  mlbScopedCount: 0,
  normalizedCount: 0,
  validationCount: 0,
  mlbUsableCount: 0,
  lastError: "",
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

export function updatePrizePicksDiagnostics(patch = {}) {
  snapshot = {
    ...snapshot,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  publish();
  return snapshot;
}

function publish() {
  if (typeof window === "undefined") return;
  window.__PRIZEPICKS_DIAGNOSTICS__ = { ...snapshot };
}

/** Map runtime outcome to a single failure classification for the diagnostics panel. */
export function classifyPrizePicksFailure({
  notConfigured = false,
  timedOut = false,
  httpExecuted = false,
  statusCode = null,
  rawPropCount = 0,
  validationCount = 0,
  providerStatus = "",
  lastError = "",
  networkError = false,
} = {}) {
  if (notConfigured) return "MISSING_PROXY";
  if (timedOut) return "TIMEOUT";
  if (!httpExecuted) return "NO_HTTP_REQUEST";
  if (networkError && !statusCode) return "NETWORK_ERROR";
  if (statusCode === 401) return "HTTP_401";
  if (statusCode === 403) return "HTTP_403";
  if (statusCode === 429) return "HTTP_429";
  if (statusCode != null && statusCode >= 400) return `HTTP_${statusCode}`;
  if (/cors|failed to fetch|network/i.test(String(lastError || ""))) return "CORS_OR_NETWORK";
  if (providerStatus === "Failed" || providerStatus === "failed") return "PROVIDER_FAILED_PAYLOAD";
  if (rawPropCount > 0 && validationCount === 0) return "PARSE_OR_FILTER_ZERO_USABLE";
  if (rawPropCount === 0) return "ZERO_RAW_PROPS";
  if (providerStatus === "Empty" && validationCount === 0) return "ZERO_USABLE_AFTER_PARSE";
  return "";
}
