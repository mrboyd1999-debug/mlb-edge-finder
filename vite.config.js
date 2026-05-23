import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SPORTSDATA_API_KEY =
  process.env.SPORTSDATA_API_KEY ||
  process.env.VITE_SPORTSDATA_API_KEY ||
  "";
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || "";
const ODDS_API_KEY = process.env.ODDS_API_KEY || process.env.VITE_ODDS_API_KEY || "";

const PRIZEPICKS_TARGETS = ["https://partner-api.prizepicks.com", "https://api.prizepicks.com"];
const UNDERDOG_TARGET = "https://api.underdogfantasy.com";
const UPSTREAM_TIMEOUT_MS = 15_000;

export default defineConfig({
  plugins: [dfsApiProxy(), react()],
  server: {
    host: "0.0.0.0",
  },
});

/**
 * Intercepts /api/* BEFORE Vite can serve api/*.js source files from the repo root.
 */
function dfsApiProxy() {
  return {
    name: "dfs-api-proxy",
    enforce: "pre",
    configureServer(server) {
      const handler = async (req, res, next) => {
        try {
          const pathname = (req.url || "").split("?")[0];

          if (!isApiRoute(pathname)) {
            next();
            return;
          }

          if (pathname.endsWith(".js") || pathname.endsWith(".mjs")) {
            sendJson(res, 404, apiErrorPayload("API", "API route is serving JS source instead of JSON. Check vite proxy/backend routing."));
            return;
          }

          if (pathname === "/api/health") {
            sendJson(res, 200, {
              ok: true,
              routes: {
                prizepicks: "/api/prizepicks",
                underdog: "/api/underdog",
              },
              timestamp: new Date().toISOString(),
            });
            return;
          }

          if (pathname.startsWith("/api/prizepicks")) {
            await proxyWithFallback(req, res, PRIZEPICKS_TARGETS, rewritePrizePicksPath, prizePicksHeaders(), "PrizePicks");
            return;
          }

          if (pathname.startsWith("/api/underdog")) {
            await proxyUpstream(req, res, UNDERDOG_TARGET, rewriteUnderdogPath, underdogHeaders(), "Underdog");
            return;
          }

          if (pathname.startsWith("/api/sportsbookOdds")) {
            await proxyUpstream(req, res, "https://api.the-odds-api.com", rewriteSportsbookPath, { accept: "application/json" }, "Odds");
            return;
          }

          if (pathname.startsWith("/api/sportsdata")) {
            await proxyUpstream(
              req,
              res,
              "https://api.sportsdata.io/v3/mlb",
              (p) => p.replace(/^\/api\/sportsdata/, ""),
              sportsDataHeaders(),
              "SportsDataIO"
            );
            return;
          }

          if (pathname.startsWith("/api/api-football")) {
            await proxyUpstream(req, res, "https://v3.football.api-sports.io", (p) => p.replace(/^\/api\/api-football/, ""), apiFootballHeaders(), "API-Football");
            return;
          }

          next();
        } catch (error) {
          console.warn("[DFS proxy] handler error", error?.message || error);
          if (!res.headersSent) {
            sendJson(res, 500, apiErrorPayload("API", error?.message || "proxy handler failed"));
          }
        }
      };

      prependMiddleware(server.middlewares, handler);
    },
  };
}

function prependMiddleware(app, handler) {
  if (app?.stack?.unshift) {
    app.stack.unshift({ route: "", handle: handler });
    return;
  }
  app.use(handler);
}

function isApiRoute(pathname) {
  return (
    pathname === "/api/health" ||
    pathname.startsWith("/api/prizepicks") ||
    pathname.startsWith("/api/underdog") ||
    pathname.startsWith("/api/sportsbookOdds") ||
    pathname.startsWith("/api/sportsdata") ||
    pathname.startsWith("/api/api-football")
  );
}

function apiErrorPayload(source, error, extra = {}) {
  return {
    ok: false,
    source,
    status: "failed",
    error: error || "upstream fetch failed",
    fallback: false,
    data: [],
    props: [],
    ...extra,
  };
}

async function proxyWithFallback(req, res, targets, rewriteFn, headers, source) {
  for (const target of targets) {
    const ok = await proxyUpstream(req, res, target, rewriteFn, headers, source);
    if (ok) return;
  }
  sendJson(res, 200, apiErrorPayload(source, "upstream fetch failed"));
}

async function proxyUpstream(req, res, targetBase, rewriteFn, headers, source) {
  const fullUrl = req.url || "";
  let targetPath = rewriteFn(fullUrl);
  const upstreamUrl = configuredProxyUrl(fullUrl, source) || new URL(targetPath, targetBase);

  if (source === "Odds" && ODDS_API_KEY && !upstreamUrl.searchParams.has("apiKey")) {
    upstreamUrl.searchParams.set("apiKey", ODDS_API_KEY);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, { headers, signal: controller.signal });
    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "";
    const preview = text.slice(0, 200);

    console.info("[DFS proxy]", {
      source,
      requestUrl: fullUrl,
      upstreamUrl: upstreamUrl.toString(),
      status: upstream.status,
      contentType,
      preview,
    });
    if (source === "PrizePicks") console.log("PrizePicks raw response", preview);

    if (isJsSourceResponse(text, contentType)) {
      console.warn("[DFS proxy] JS/HTML source detected — routing misconfigured", { requestUrl: fullUrl });
      sendJson(res, 502, apiErrorPayload(source, "API route is serving source/HTML instead of JSON. Check proxy/backend routing.", { preview }));
      return;
    }

    if (!upstream.ok) {
      const error =
        source === "PrizePicks" && upstream.status === 403
          ? "PrizePicks blocked the request (403)"
          : `${source} returned status ${upstream.status}.`;
      const statusCode = source === "Underdog" || source === "PrizePicks" ? 200 : upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      sendJson(res, statusCode, apiErrorPayload(source, error, { preview, upstreamStatus: upstream.status }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(text);
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `upstream fetch timed out after ${UPSTREAM_TIMEOUT_MS}ms`
        : error?.message || "upstream fetch failed";
    console.warn("[DFS proxy] fetch failed", { source, message });
    const statusCode = source === "Underdog" || source === "PrizePicks" ? 200 : 502;
    sendJson(res, statusCode, apiErrorPayload(source, message));
  } finally {
    clearTimeout(timer);
  }
}

function configuredProxyUrl(fullUrl, source) {
  if (source !== "PrizePicks" && source !== "Underdog") return null;
  try {
    const parsed = new URL(fullUrl, "http://localhost");
    const proxyUrl = parsed.searchParams.get("proxyUrl") || parsed.searchParams.get("providerUrl");
    return proxyUrl ? new URL(proxyUrl) : null;
  } catch {
    return null;
  }
}

function rewritePrizePicksPath(path) {
  const parsed = new URL(path, "http://localhost");
  let sub = parsed.pathname.replace(/^\/api\/prizepicks\/?/, "");
  if (!sub || sub === "/") sub = "/projections";
  if (!sub.startsWith("/")) sub = `/${sub}`;
  const query =
    parsed.search ||
    (sub === "/projections" || sub.endsWith("/projections")
      ? "?per_page=250&single_stat=true&game_mode=pickem"
      : "");
  return `${sub}${query}`;
}

function rewriteUnderdogPath(path) {
  const parsed = new URL(path, "http://localhost");
  const sub = parsed.pathname.replace(/^\/api\/underdog\/?/, "");
  if (sub && sub !== "/") {
    const route = sub.startsWith("/") ? sub : `/${sub}`;
    return `${route}${parsed.search}`;
  }
  return `/beta/v3/over_under_lines${parsed.search}`;
}

function rewriteSportsbookPath(path) {
  const parsed = new URL(path, "http://localhost");
  const apiPath = parsed.searchParams.get("path") || "/";
  parsed.searchParams.delete("path");
  const query = parsed.searchParams.toString();
  return `${apiPath}${query ? `?${query}` : ""}`;
}

function isJsSourceResponse(text, contentType) {
  const trimmed = String(text || "").trim();
  return (
    /javascript/i.test(contentType) ||
    trimmed.startsWith("<") ||
    /^export\s+default\b/.test(trimmed) ||
    trimmed.includes("export default async function") ||
    trimmed.includes("const APIFY_PRIZEPICKS_ACTOR")
  );
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
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

function sportsDataHeaders() {
  return {
    accept: "application/json",
    ...(SPORTSDATA_API_KEY ? { "Ocp-Apim-Subscription-Key": SPORTSDATA_API_KEY } : {}),
  };
}

function apiFootballHeaders() {
  return {
    accept: "application/json",
    ...(API_FOOTBALL_KEY ? { "x-apisports-key": API_FOOTBALL_KEY } : {}),
  };
}
