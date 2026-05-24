import { getOddsApiKey as getRuntimeOddsApiKey } from "../config/apiConfig.js";

export const ODDS_API_INVALID_KEY_MESSAGE = "Invalid Odds API key or subscription access.";

export function sanitizeOddsApiKey(key = "") {
  return String(key || "")
    .trim()
    .replace(/\s+/g, "");
}

export function getTrimmedOddsApiKey() {
  return sanitizeOddsApiKey(getRuntimeOddsApiKey());
}

export function getOddsApiKeyDebugInfo() {
  const key = getTrimmedOddsApiKey();
  return {
    configured: Boolean(key),
    keyLength: key.length,
  };
}

export function redactOddsApiUrl(url = "") {
  return String(url).replace(/apiKey=[^&]+/gi, "apiKey=[REDACTED]");
}

export function buildOddsApiProxyUrl(path, params = {}) {
  const key = getTrimmedOddsApiKey();
  const url = new URL("/api/sportsbookOdds", window.location.origin);
  url.searchParams.set("path", path.startsWith("/") ? path : `/${path}`);
  if (key) url.searchParams.set("apiKey", key);
  Object.entries(params || {}).forEach(([name, value]) => {
    if (name === "path" || name === "apiKey") return;
    if (value != null && value !== "") url.searchParams.set(name, value);
  });
  return url;
}

export function parseOddsApiAuthFailure({ data, status, text } = {}) {
  const httpStatus = Number(data?.upstreamStatus ?? data?.responseCode ?? status ?? 0);
  if (httpStatus === 401 || httpStatus === 403) return ODDS_API_INVALID_KEY_MESSAGE;

  const message =
    typeof data === "string"
      ? data
      : typeof data === "object" && data
        ? String(data.message || data.error || "")
        : String(text || "");

  if (data?.error === true && /missing api key|unauthorized|invalid|subscription/i.test(message)) {
    return ODDS_API_INVALID_KEY_MESSAGE;
  }
  if (/invalid api key|unauthorized|subscription access|api key is not valid|excluded/i.test(message)) {
    return ODDS_API_INVALID_KEY_MESSAGE;
  }
  if (/invalid api key|unauthorized|subscription/i.test(String(text || ""))) {
    return ODDS_API_INVALID_KEY_MESSAGE;
  }
  return null;
}

export function sanitizeOddsApiUiMessage(message = "") {
  const text = String(message || "").trim();
  if (!text) return "";
  if (/invalid api key|unauthorized|subscription access|401|403/i.test(text)) {
    return ODDS_API_INVALID_KEY_MESSAGE;
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    return ODDS_API_INVALID_KEY_MESSAGE;
  }
  return text.slice(0, 180);
}

export function logOddsApiExchange({ url, status, text = "", data = null, label = "Odds API" } = {}) {
  const bodyPreview = String(text || (data != null ? JSON.stringify(data) : "")).slice(0, 240);
  console.info(`[${label}]`, {
    requestUrl: redactOddsApiUrl(url),
    responseStatus: status,
    responseBody: bodyPreview,
  });
}
