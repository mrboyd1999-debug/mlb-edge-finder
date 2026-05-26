import { cleanApiKey } from "./cleanApiKey.js";

export const SPORTSDATA_MLB_UPSTREAM = "https://api.sportsdata.io/v3/mlb";
export const SPORTSDATA_MLB_STATUS_PATH = "/scores/json/AreAnyGamesInProgress";
export const SPORTSDATA_MLB_PLAYERS_PATH = "/scores/json/Players";
export const SPORTSDATA_UPSTREAM_TIMEOUT_MS = 30_000;

export function resolveSportsDataApiKeyFromRequest(req) {
  const headers = req?.headers || {};
  const headerKey =
    headers["x-sportsdata-api-key"] ||
    headers["X-SportsData-Api-Key"] ||
    headers["x-sportsdata-key"] ||
    "";
  if (String(headerKey).trim()) return cleanApiKey(headerKey);

  const queryKey = req?.query?.key;
  if (typeof queryKey === "string" && queryKey.trim()) return cleanApiKey(queryKey);

  try {
    const parsed = new URL(req?.url || "", "http://localhost");
    const fromUrl = parsed.searchParams.get("key");
    if (fromUrl?.trim()) return cleanApiKey(fromUrl);
  } catch {
    // ignore malformed URLs
  }

  return cleanApiKey(process.env.SPORTSDATA_API_KEY || process.env.VITE_SPORTSDATA_API_KEY || "");
}

export function isSportsDataHealthPayload(payload) {
  if (payload === true || payload === false) return true;
  if (Array.isArray(payload)) return true;
  return Boolean(payload && typeof payload === "object");
}

export async function fetchSportsDataUpstream(subPath, { apiKey = "" } = {}) {
  const cleanedKey = cleanApiKey(apiKey);
  const normalized = subPath.startsWith("/") ? subPath : `/${subPath}`;
  const upstreamUrl = `${SPORTSDATA_MLB_UPSTREAM}${normalized}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPORTSDATA_UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        accept: "application/json",
        ...(cleanedKey ? { "Ocp-Apim-Subscription-Key": cleanedKey } : {}),
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    const unauthorized = response.status === 401 || response.status === 403;
    const rateLimited = response.status === 429;
    const ok = response.ok && data != null && !data?.error;

    return {
      ok,
      success: ok,
      status: ok ? "connected" : unauthorized ? "unauthorized" : rateLimited ? "rate_limited" : "failed",
      responseCode: response.status,
      data,
      text,
      timedOut: false,
      unauthorized,
      rateLimited,
      proxied: true,
      message: ok
        ? "Connected via proxy"
        : unauthorized
          ? "Invalid key or unauthorized"
          : rateLimited
            ? "Rate limited"
            : `Upstream returned ${response.status}`,
      upstreamUrl: upstreamUrl.replace(apiKey, "[REDACTED]"),
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return {
      ok: false,
      success: false,
      status: timedOut ? "timeout" : "failed",
      responseCode: timedOut ? 408 : 502,
      data: null,
      text: "",
      timedOut,
      unauthorized: false,
      rateLimited: false,
      proxied: true,
      message: timedOut ? "Timed out — using base feed." : error?.message || "Proxy fetch failed",
      upstreamUrl: upstreamUrl.replace(apiKey, "[REDACTED]"),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSportsDataMlbStatus(apiKey) {
  const result = await fetchSportsDataUpstream(SPORTSDATA_MLB_STATUS_PATH, { apiKey });
  const healthOk = result.ok && isSportsDataHealthPayload(result.data);
  return {
    ...result,
    ok: healthOk,
    success: healthOk,
    status: healthOk ? "connected" : result.status,
    message: healthOk ? "Connected via proxy" : result.message,
  };
}

/** MLB subscription probe — uses Players endpoint required for stat enrichment. */
export async function probeSportsDataMlbPlayers(apiKey) {
  const result = await fetchSportsDataUpstream(SPORTSDATA_MLB_PLAYERS_PATH, { apiKey: cleanApiKey(apiKey) });
  const playersOk = result.responseCode === 200 && Array.isArray(result.data);
  return {
    ...result,
    ok: playersOk,
    success: playersOk,
    status: playersOk ? "connected" : result.status,
    message: playersOk
      ? `Connected — ${result.data.length} MLB players returned`
      : result.message,
    playerCount: playersOk ? result.data.length : 0,
  };
}

export function setSportsDataCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-SportsData-Api-Key");
  res.setHeader("cache-control", "no-store");
}
