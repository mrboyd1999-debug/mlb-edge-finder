import { getOddsApiKey as getRuntimeOddsApiKey } from "../config/apiConfig.js";
import { cleanApiKey } from "../utils/cleanApiKey.js";
import { isSourceAuthBlocked, recordSourceAuthFailure, SOURCE_IDS } from "./sourceRateLimit.js";

export const ODDS_API_INVALID_KEY_MESSAGE = "Invalid Odds API key or subscription access.";

const PLACEHOLDER_ODDS_KEY_PATTERN =
  /^(your_|paste_|replace_|example_|test_|xxx+|000+)|(_here|_key)$/i;

export function sanitizeOddsApiKey(key = "") {
  return cleanApiKey(key);
}

export function isPlaceholderOddsApiKey(key = "") {
  const cleaned = sanitizeOddsApiKey(key);
  if (!cleaned) return true;
  return PLACEHOLDER_ODDS_KEY_PATTERN.test(cleaned);
}

export function getTrimmedOddsApiKey() {
  return sanitizeOddsApiKey(getRuntimeOddsApiKey());
}

/** Skip Odds API calls when the key is missing, placeholder, or previously rejected. */
export function isOddsApiKeyUsable() {
  const key = getTrimmedOddsApiKey();
  if (!key || isPlaceholderOddsApiKey(key)) return false;
  if (isSourceAuthBlocked(SOURCE_IDS.ODDS_API)) return false;
  return true;
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
  if (/invalid api key|unauthorized|subscription access|401|403|api key is not valid/i.test(text)) {
    return ODDS_API_INVALID_KEY_MESSAGE;
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    return ODDS_API_INVALID_KEY_MESSAGE;
  }
  return text.slice(0, 180);
}

let oddsKeyStartupValidated = false;

/** One-time startup probe — blocks repeat 401 spam when the saved key is invalid. */
export async function validateOddsApiKeyOnce() {
  if (oddsKeyStartupValidated || typeof window === "undefined") return;
  oddsKeyStartupValidated = true;
  const key = getTrimmedOddsApiKey();
  if (!key || isPlaceholderOddsApiKey(key) || isSourceAuthBlocked(SOURCE_IDS.ODDS_API)) return;

  try {
    const url = buildOddsApiProxyUrl("/v4/sports/");
    const response = await fetch(`${url.pathname}${url.search}`, { cache: "no-store" });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const authFailure = parseOddsApiAuthFailure({
      data,
      status: response.status,
      text,
    });
    if (authFailure) {
      recordSourceAuthFailure(SOURCE_IDS.ODDS_API, authFailure);
    }
  } catch {
    // Network failures should not permanently block Odds API.
  }
}

export function logOddsApiExchange({ url, status, text = "", data = null, label = "Odds API" } = {}) {
  const bodyPreview = String(text || (data != null ? JSON.stringify(data) : "")).slice(0, 240);
  console.info(`[${label}]`, {
    requestUrl: redactOddsApiUrl(url),
    responseStatus: status,
    responseBody: bodyPreview,
  });
}
