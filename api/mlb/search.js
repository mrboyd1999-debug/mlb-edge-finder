const MLB_STATS_ORIGIN = "https://statsapi.mlb.com/api";
const UPSTREAM_TIMEOUT_MS = 12_000;

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  const names = String(req.query?.names || "Shohei Ohtani").trim();
  const upstreamUrl = new URL(`${MLB_STATS_ORIGIN}/v1/people/search`);
  upstreamUrl.searchParams.set("names", names);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: mlbStatsHeaders(),
      signal: controller.signal,
    });
    const text = await upstream.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    console.info("[MLB Stats search proxy]", {
      names,
      status: upstream.status,
      preview: text.slice(0, 200),
    });

    if (!upstream.ok) {
      return sendJson(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        ok: false,
        source: "MLB Stats API",
        status: upstream.status,
        error: `MLB Stats API returned status ${upstream.status}.`,
        preview: text.slice(0, 300),
        people: [],
      });
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=60");
    res.end(text);
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `MLB Stats API timed out after ${UPSTREAM_TIMEOUT_MS}ms`
        : error?.message || "MLB Stats API search proxy failed";
    sendJson(res, 502, { ok: false, source: "MLB Stats API", error: message, people: [] });
  } finally {
    clearTimeout(timer);
  }
}

function mlbStatsHeaders() {
  return {
    accept: "application/json",
    "user-agent":
      "Mozilla/5.0 (compatible; MLBPICK/1.0; +https://github.com/mrboyd1999-debug/mlb-edge-finder)",
  };
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}
