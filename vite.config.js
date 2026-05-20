import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxyCache = new Map();
const PROXY_CACHE_MS = 60 * 1000;
const PROXY_STALE_MS = 10 * 60 * 1000;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.VITE_BALLDONTLIE_API_KEY || "";
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || "";

export default defineConfig({
  plugins: [react(), dfsApiProxy()],
});

function dfsApiProxy() {
  return {
    name: "dfs-api-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url || "";
        const isPrizePicks = requestUrl.startsWith("/api/prizepicks");
        const isUnderdog = requestUrl.startsWith("/api/underdog");
        const isBallDontLie = requestUrl.startsWith("/api/balldontlie");
        const isApiFootball = requestUrl.startsWith("/api/api-football");

        if (!isPrizePicks && !isUnderdog && !isBallDontLie && !isApiFootball) {
          next();
          return;
        }

        const targetBase = proxyTargetBase({ isPrizePicks, isUnderdog, isBallDontLie, isApiFootball });
        const targetPath = requestUrl.replace(proxyPrefix({ isPrizePicks, isUnderdog, isBallDontLie, isApiFootball }), "");
        const upstreamUrl = new URL(targetPath || "/", targetBase);
        const cacheKey = upstreamUrl.toString();
        const cached = proxyCache.get(cacheKey);

        if (cached && Date.now() - cached.createdAt < PROXY_CACHE_MS) {
          sendProxyResponse(res, 200, cached.contentType, cached.body);
          return;
        }

        try {
          const upstream = await fetch(upstreamUrl, {
            headers: proxyHeaders({ isPrizePicks, isUnderdog, isBallDontLie, isApiFootball }),
          });
          const body = Buffer.from(await upstream.arrayBuffer());
          const contentType = upstream.headers.get("content-type") || "application/json";

          if (upstream.ok) {
            proxyCache.set(cacheKey, { body, contentType, createdAt: Date.now() });
          } else if (cached && Date.now() - cached.createdAt < PROXY_STALE_MS) {
            sendProxyResponse(res, 200, cached.contentType, cached.body);
            return;
          }

          sendProxyResponse(res, upstream.status, contentType, body);
        } catch (error) {
          if (cached && Date.now() - cached.createdAt < PROXY_STALE_MS) {
            sendProxyResponse(res, 200, cached.contentType, cached.body);
            return;
          }

          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: error.message || "DFS proxy failed" }));
        }
      });
    },
  };
}

function proxyTargetBase({ isPrizePicks, isUnderdog, isBallDontLie }) {
  if (isPrizePicks) return "https://api.prizepicks.com";
  if (isUnderdog) return "https://api.underdogfantasy.com";
  if (isBallDontLie) return "https://api.balldontlie.io";
  return "https://v3.football.api-sports.io";
}

function proxyPrefix({ isPrizePicks, isUnderdog, isBallDontLie }) {
  if (isPrizePicks) return "/api/prizepicks";
  if (isUnderdog) return "/api/underdog";
  if (isBallDontLie) return "/api/balldontlie";
  return "/api/api-football";
}

function proxyHeaders({ isPrizePicks, isUnderdog, isBallDontLie, isApiFootball }) {
  if (isPrizePicks) return prizePicksHeaders();
  if (isUnderdog) return underdogHeaders();
  if (isBallDontLie) return ballDontLieHeaders();
  if (isApiFootball) return apiFootballHeaders();
  return { accept: "application/json" };
}

function sendProxyResponse(res, statusCode, contentType, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

function prizePicksHeaders() {
  return {
    accept: "application/json",
    origin: "https://app.prizepicks.com",
    referer: "https://app.prizepicks.com/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  };
}

function underdogHeaders() {
  return {
    accept: "application/json",
    origin: "https://underdogfantasy.com",
    referer: "https://underdogfantasy.com/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  };
}

function ballDontLieHeaders() {
  return {
    accept: "application/json",
    ...(BALLDONTLIE_API_KEY ? { Authorization: BALLDONTLIE_API_KEY } : {}),
  };
}

function apiFootballHeaders() {
  return {
    accept: "application/json",
    ...(API_FOOTBALL_KEY ? { "x-apisports-key": API_FOOTBALL_KEY } : {}),
  };
}
