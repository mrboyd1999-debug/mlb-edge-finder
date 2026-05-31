/**
 * Standalone PrizePicks proxy for local development.
 * Run: npm run proxy
 *
 * GET /api/prizepicks/mlb — MLB projections from PrizePicks API
 */

import express from "express";

const app = express();
const port = Number(process.env.PRIZEPICKS_PROXY_PORT || process.env.PORT || 4000);
const FETCH_TIMEOUT_MS = Number(process.env.PRIZEPICKS_PROXY_TIMEOUT_MS || 15_000);

const PRIZEPICKS_MLB_URLS = [
  "https://partner-api.prizepicks.com/projections?league_id=2&per_page=250&single_stat=true&game_mode=pickem",
  "https://api.prizepicks.com/projections?league_id=2&per_page=250&single_stat=true&game_mode=pickem",
];

const PRIZEPICKS_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  Origin: "https://app.prizepicks.com",
  Referer: "https://app.prizepicks.com/",
};

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "prizepicks-proxy",
    routes: { mlb: "/api/prizepicks/mlb" },
    timestamp: new Date().toISOString(),
  });
});

function isBlockPayload(payload) {
  return Boolean(payload?.appId && (payload?.blockScript || payload?.jsClientSrc));
}

async function fetchMlbProjections() {
  let lastError = null;

  for (const url of PRIZEPICKS_MLB_URLS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const upstream = await fetch(url, {
        method: "GET",
        headers: PRIZEPICKS_HEADERS,
        signal: controller.signal,
      });

      const text = await upstream.text();
      const contentType = upstream.headers.get("content-type") || "";

      if (!upstream.ok) {
        lastError = new Error(`HTTP ${upstream.status}`);
        continue;
      }

      if (/html|javascript/i.test(contentType) || text.trim().startsWith("<")) {
        lastError = new Error("Upstream returned HTML instead of JSON");
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(text);
      } catch (parseError) {
        lastError = parseError;
        continue;
      }

      console.log("PrizePicks response keys", Object.keys(payload));
      console.log("PrizePicks sample", JSON.stringify(payload).slice(0, 5000));

      if (isBlockPayload(payload)) {
        lastError = new Error("PrizePicks returned bot-protection payload instead of projections");
        continue;
      }

      const rawCount = Array.isArray(payload?.data) ? payload.data.length : 0;
      console.info("[prizepicks-proxy] MLB fetch OK", {
        url,
        status: upstream.status,
        rawResponseCount: rawCount,
      });

      return { payload, rawCount, url };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("All PrizePicks endpoints failed");
}

app.get("/api/prizepicks/mlb", async (_req, res) => {
  try {
    const { payload, rawCount } = await fetchMlbProjections();
    res.setHeader("cache-control", "no-store");
    res.json(payload);
    console.info("[prizepicks-proxy] served MLB payload", { rawResponseCount: rawCount });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    res.status(200).json({
      ok: false,
      error: "PrizePicks fetch failed",
      status: timedOut ? 408 : 0,
      details: timedOut
        ? `Request timed out after ${FETCH_TIMEOUT_MS}ms`
        : error?.message || String(error),
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.info(`PrizePicks proxy listening on http://localhost:${port}`);
  console.info(`MLB endpoint: http://localhost:${port}/api/prizepicks/mlb`);
});
