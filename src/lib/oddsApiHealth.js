/**
 * Odds API key resolution and health probe — localStorage overrides env (stale .env fix).
 */

import { cleanApiKey } from "../utils/cleanApiKey.js";

const ODDS_LOCAL_KEYS = ["odds_api_key", "oddsApiKey", "VITE_ODDS_API_KEY", "odds-api-key", "the-odds-api-key"];

const PLACEHOLDER_PATTERN =
  /^(your_|paste_|replace_|example_|test_|xxx+|000+)|(_here|_key)$/i;

function isUsableOddsKey(value = "") {
  const cleaned = cleanApiKey(value);
  if (!cleaned) return false;
  if (PLACEHOLDER_PATTERN.test(cleaned)) return false;
  return true;
}

function readLocalOddsKey() {
  if (typeof window === "undefined") return "";
  for (const key of ODDS_LOCAL_KEYS) {
    try {
      const value = cleanApiKey(window.localStorage.getItem(key));
      if (isUsableOddsKey(value)) return value;
    } catch {
      // ignore private-mode storage errors
    }
  }
  return "";
}

function readEnvOddsKey() {
  const env =
    import.meta.env?.VITE_ODDS_API_KEY ||
    import.meta.env?.ODDS_API_KEY ||
    import.meta.env?.THE_ODDS_API_KEY ||
    "";
  return isUsableOddsKey(env) ? cleanApiKey(env) : "";
}

/** Priority: localStorage → Vite env → legacy env alias. */
export function getOddsApiKey() {
  const local = readLocalOddsKey();
  if (local) return local;
  const env = readEnvOddsKey();
  return env || "";
}

export function getOddsApiKeySource() {
  if (readLocalOddsKey()) return "localStorage";
  if (readEnvOddsKey()) return "env";
  return "missing";
}

function buildOddsSportsTestUrl(key) {
  return `https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(key)}`;
}

function buildOddsSportsProxyRoute(key) {
  if (typeof window === "undefined") return "";
  const url = new URL("/api/sportsbookOdds", window.location.origin);
  url.searchParams.set("path", "/v4/sports/");
  url.searchParams.set("apiKey", key);
  return `${url.pathname}${url.search}`;
}

function parseOddsSportsPayload(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function fetchOddsSportsProbe(key) {
  const directUrl = buildOddsSportsTestUrl(key);
  try {
    const res = await fetch(directUrl, { cache: "no-store" });
    const text = await res.text();
    return { res, text, route: directUrl, via: "direct" };
  } catch (directError) {
    const proxyRoute = buildOddsSportsProxyRoute(key);
    if (!proxyRoute) throw directError;
    const res = await fetch(proxyRoute, { cache: "no-store" });
    const text = await res.text();
    return { res, text, route: "https://api.the-odds-api.com/v4/sports/?apiKey=[REDACTED]", via: "proxy" };
  }
}

export async function testOddsApiKey() {
  const key = getOddsApiKey();
  if (!key) {
    return {
      ok: false,
      status: "missing",
      message: "Odds API key missing",
      unauthorized: false,
      sportsCount: 0,
    };
  }

  try {
    const { res, text, route, via } = await fetchOddsSportsProbe(key);
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    const httpStatus = Number(data?.upstreamStatus ?? data?.responseCode ?? res.status ?? 0);
    const unauthorized =
      httpStatus === 401 ||
      httpStatus === 403 ||
      Boolean(data?.error && /invalid|unauthorized|subscription|missing api key/i.test(String(data?.message || "")));

    if (!res.ok || unauthorized || data?.error) {
      const message =
        (typeof data === "object" && data && (data.message || data.error)) ||
        (typeof data === "string" ? data : "") ||
        `HTTP ${httpStatus || res.status}`;
      return {
        ok: false,
        status: httpStatus || res.status,
        message: String(message).slice(0, 200),
        data,
        unauthorized,
        sportsCount: 0,
        route,
        via,
      };
    }

    const sportsList = parseOddsSportsPayload(data);
    const sportsCount = sportsList.length;
    const message =
      sportsCount > 0 ? `Connected — ${sportsCount} sports listed` : "Connected — OK";

    return {
      ok: true,
      status: httpStatus || res.status,
      message,
      data,
      unauthorized: false,
      sportsCount,
      sportsListOk: sportsCount > 0,
      route,
      via,
    };
  } catch (err) {
    return {
      ok: false,
      status: "network_error",
      message: err?.message || "Network error",
      unauthorized: false,
      sportsCount: 0,
    };
  }
}

export function saveOddsApiKey(key) {
  const clean = cleanApiKey(key);
  if (typeof window === "undefined") return clean;
  try {
    if (clean) {
      window.localStorage.setItem("odds_api_key", clean);
      window.localStorage.setItem("oddsApiKey", clean);
      window.localStorage.setItem("VITE_ODDS_API_KEY", clean);
      window.localStorage.setItem("odds-api-key", clean);
      window.localStorage.setItem("the-odds-api-key", clean);
    } else {
      clearOddsApiKey();
    }
  } catch {
    // ignore
  }
  return clean;
}

export function clearOddsApiKey() {
  if (typeof window === "undefined") return;
  const keys = [
    "odds_api_key",
    "oddsApiKey",
    "VITE_ODDS_API_KEY",
    "odds-api-key",
    "the-odds-api-key",
  ];
  keys.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  });
}
