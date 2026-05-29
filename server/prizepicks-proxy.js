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

const PRIZEPICKS_MLB_URL =
  "https://api.prizepicks.com/projections?league_id=2&per_page=250&single_stat=true";

const PRIZEPICKS_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0",
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

app.get("/api/prizepicks/mlb", async (_req, res) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(PRIZEPICKS_MLB_URL, {
      method: "GET",
      headers: PRIZEPICKS_HEADERS,
      signal: controller.signal,
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "";

    if (!upstream.ok) {
      res.status(200).json({
        ok: false,
        error: "PrizePicks fetch failed",
        status: upstream.status,
        details: text.slice(0, 500) || `HTTP ${upstream.status}`,
      });
      return;
    }

    if (/html|javascript/i.test(contentType) || text.trim().startsWith("<")) {
      res.status(200).json({
        ok: false,
        error: "PrizePicks fetch failed",
        status: upstream.status,
        details: "Upstream returned HTML instead of JSON",
      });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseError) {
      res.status(200).json({
        ok: false,
        error: "PrizePicks fetch failed",
        status: upstream.status,
        details: parseError?.message || "Invalid JSON from PrizePicks",
      });
      return;
    }

    const count = Array.isArray(payload?.data) ? payload.data.length : 0;
    console.info("[prizepicks-proxy] MLB fetch OK", {
      status: upstream.status,
      projections: count,
    });

    res.setHeader("cache-control", "no-store");
    res.json(payload);
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
  } finally {
    clearTimeout(timer);
  }
});

app.listen(port, "0.0.0.0", () => {
  console.info(`PrizePicks proxy listening on http://localhost:${port}`);
  console.info(`MLB endpoint: http://localhost:${port}/api/prizepicks/mlb`);
});
