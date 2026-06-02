import { getOddsApiKey, getOddsApiKeySource, saveOddsApiKey, clearOddsApiKey } from "./apiKeys.js";

export { getOddsApiKey, getOddsApiKeySource, saveOddsApiKey, clearOddsApiKey };

export async function testOddsApiHealth() {
  const key = getOddsApiKey();
  console.log("[Odds API Health]", {
    keyPresent: Boolean(key),
    keyLength: key?.length,
    urlUsesApiKeyParam: true,
  });

  if (!key) {
    return {
      provider: "Odds API",
      ok: false,
      status: "Missing API key",
      details: "No Odds API key found in localStorage or .env.local",
      httpStatus: 0,
      unauthorized: false,
      sportsCount: 0,
    };
  }

  const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      const invalidKey =
        data?.error_code === "INVALID_KEY" ||
        /not valid|invalid api key|unauthorized/i.test(String(data?.message || ""));
      return {
        provider: "Odds API",
        ok: false,
        status: invalidKey ? "Invalid API key" : "Connection failed",
        details: data?.message || JSON.stringify(data),
        raw: data,
        httpStatus: res.status,
        unauthorized: invalidKey || res.status === 401 || res.status === 403,
        sportsCount: 0,
        route: url.replace(key, "[REDACTED]"),
      };
    }

    const count = Array.isArray(data) ? data.length : 0;
    return {
      provider: "Odds API",
      ok: true,
      status: "Connected",
      details: `OK — ${count} sports available`,
      raw: data,
      httpStatus: res.status,
      unauthorized: false,
      sportsCount: count,
      sportsListOk: true,
      route: url.replace(key, "[REDACTED]"),
    };
  } catch (error) {
    return {
      provider: "Odds API",
      ok: false,
      status: "Network error",
      details: error?.message || "Failed to reach Odds API",
      httpStatus: 0,
      unauthorized: false,
      sportsCount: 0,
      networkError: true,
    };
  }
}

/** Back-compat wrapper for existing callers expecting testOddsApiKey(). */
export async function testOddsApiKey() {
  const result = await testOddsApiHealth();
  return {
    ok: result.ok,
    status: result.ok ? result.httpStatus || 200 : result.httpStatus || result.status,
    message: result.details || result.status,
    data: result.raw,
    unauthorized: result.unauthorized,
    sportsCount: result.sportsCount ?? 0,
    sportsListOk: Boolean(result.sportsListOk ?? result.ok),
    route: result.route,
  };
}
