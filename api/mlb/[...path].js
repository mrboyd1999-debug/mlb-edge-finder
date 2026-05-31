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

  const segments = req.query?.path;
  const subpath = Array.isArray(segments) ? segments.join("/") : String(segments || "").trim();
  if (!subpath) {
    return sendJson(res, 400, { ok: false, error: "Missing MLB Stats API path" });
  }

  const upstreamUrl = new URL(`${MLB_STATS_ORIGIN}/${subpath.replace(/^\/+/, "")}`);
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === "path") return;
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => upstreamUrl.searchParams.append(key, String(entry)));
      return;
    }
    upstreamUrl.searchParams.set(key, String(value));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: mlbStatsHeaders(),
      signal: controller.signal,
    });
    const text = await upstream.text();
    const preview = text.slice(0, 300);

    console.info("[MLB Stats API proxy]", {
      requestPath: `/api/mlb/${subpath}`,
      upstreamUrl: upstreamUrl.toString(),
      status: upstream.status,
      preview,
    });

    if (!upstream.ok) {
      return sendJson(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        ok: false,
        source: "MLB Stats API",
        status: upstream.status,
        error: `MLB Stats API returned status ${upstream.status}.`,
        preview,
      });
    }

    res.statusCode = 200;
    res.setHeader("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=60");
    res.end(text);
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `MLB Stats API timed out after ${UPSTREAM_TIMEOUT_MS}ms`
        : error?.message || "MLB Stats API proxy failed";
    console.warn("[MLB Stats API proxy] failed", { message, subpath });
    sendJson(res, 502, { ok: false, source: "MLB Stats API", error: message });
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
