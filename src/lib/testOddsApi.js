import { getOddsKey } from "./oddsKey.js";

export async function testOddsApi() {
  const key = getOddsKey();
  console.log("[ODDS TEST]", {
    keyPresent: Boolean(key),
    keyLength: key.length,
    first4: key.slice(0, 4),
    last4: key.slice(-4),
  });

  if (!key) {
    return {
      ok: false,
      status: "Missing API key",
      details: "No Odds API key found",
      httpStatus: 0,
      unauthorized: false,
      sportsCount: 0,
    };
  }

  const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      console.error("[ODDS API FAILED]", data);
      const invalidKey =
        data?.error_code === "INVALID_KEY" ||
        /not valid|invalid api key|unauthorized/i.test(String(data?.message || ""));
      return {
        ok: false,
        status: "Invalid API key",
        details: typeof data === "string" ? data : data?.message || JSON.stringify(data),
        raw: data,
        httpStatus: res.status,
        unauthorized: invalidKey || res.status === 401 || res.status === 403,
        sportsCount: 0,
        route: url.replace(key, "[REDACTED]"),
      };
    }

    const count = Array.isArray(data) ? data.length : 0;
    return {
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

/** Map to legacy health probe shape used by apiConnectionTest. */
export function mapTestOddsApiToHealthResult(result = {}) {
  return {
    ok: result.ok,
    status: result.ok ? result.httpStatus || 200 : result.httpStatus || result.status,
    message: result.details || result.status,
    data: result.raw,
    unauthorized: result.unauthorized,
    sportsCount: result.sportsCount ?? 0,
    sportsListOk: Boolean(result.sportsListOk ?? result.ok),
    route: result.route,
    networkError: result.networkError,
  };
}

export async function testOddsApiHealth() {
  return testOddsApi();
}

export async function testOddsApiKey() {
  return mapTestOddsApiToHealthResult(await testOddsApi());
}
