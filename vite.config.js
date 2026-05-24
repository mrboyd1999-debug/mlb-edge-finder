import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  buildPrizePicksFallbackPayload,
  getPrizePicksServerCooldownRemainingMs,
  isPrizePicksServerCooldown,
  markPrizePicksUpstreamAttempt,
  savePrizePicksPayload,
  withPrizePicksServerLock,
} from "./api/lib/prizepicksServerCache.js";
import {
  fetchSportsDataUpstream,
  probeSportsDataMlbStatus,
  resolveSportsDataApiKeyFromRequest,
} from "./api/lib/sportsDataServer.js";

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || "";
const ODDS_API_KEY = process.env.ODDS_API_KEY || process.env.VITE_ODDS_API_KEY || "";

const PRIZEPICKS_TARGETS = ["https://partner-api.prizepicks.com", "https://api.prizepicks.com"];
const UNDERDOG_TARGET = "https://api.underdogfantasy.com";
const UPSTREAM_TIMEOUT_MS = 8_000;

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
                sportsdataio: "/api/sportsdataio/mlb-status",
              },
              timestamp: new Date().toISOString(),
            });
            return;
          }

          if (pathname.startsWith("/api/prizepicks")) {
            await proxyPrizePicksWithCache(req, res);
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

          if (pathname === "/api/sportsdataio/mlb-status") {
            await handleSportsDataMlbStatus(req, res);
            return;
          }

          if (pathname.startsWith("/api/sportsdataio/")) {
            await proxySportsDataIoPath(req, res);
            return;
          }

          if (pathname.startsWith("/api/sportsdata")) {
            await proxySportsDataIoPath(req, res, pathname.replace(/^\/api\/sportsdata/, "/api/sportsdataio"));
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
    pathname.startsWith("/api/sportsdataio") ||
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
    const sent = await proxyUpstream(req, res, target, rewriteFn, headers, source);
    if (sent) return;
  }
  if (!res.writableEnded) {
    sendJson(res, 200, apiErrorPayload(source, "upstream fetch failed"));
  }
}

async function proxyPrizePicksWithCache(req, res) {
  const cooldownPayload = buildPrizePicksCooldownPayload();
  if (cooldownPayload) {
    sendJson(res, 200, cooldownPayload);
    return;
  }

  await withPrizePicksServerLock(async () => {
    const cooldownAgain = buildPrizePicksCooldownPayload();
    if (cooldownAgain) {
      sendJson(res, 200, cooldownAgain);
      return;
    }

    markPrizePicksUpstreamAttempt();

    let lastFailure = { status: 0, error: "upstream fetch failed", preview: "" };

    for (const target of PRIZEPICKS_TARGETS) {
      const result = await fetchPrizePicksUpstream(req, target);
      if (result.sent) return;
      if (result.ok) {
        try {
          savePrizePicksPayload(JSON.parse(result.text));
        } catch {
          // keep raw text response even if cache parse fails
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(result.text);
        return;
      }
      lastFailure = result;
      if (!shouldRetryPrizePicksTarget(result.status)) break;
    }

    const fallback = buildPrizePicksFallbackPayload(null, {
      rateLimited: lastFailure.status === 429,
      message: prizePicksFallbackMessage(lastFailure.status),
    });
    if (fallback) {
      sendJson(res, 200, fallback);
      return;
    }

    sendJson(
      res,
      200,
      apiErrorPayload("PrizePicks", lastFailure.error || "upstream fetch failed", {
        preview: lastFailure.preview,
        upstreamStatus: lastFailure.status,
      })
    );
  });
}

function buildPrizePicksCooldownPayload() {
  if (!isPrizePicksServerCooldown()) return null;
  const remainingSec = Math.ceil(getPrizePicksServerCooldownRemainingMs() / 1000);
  return buildPrizePicksFallbackPayload(null, {
    rateLimited: true,
    message: `Rate limited. Showing cached props. Wait ${remainingSec}s.`,
  });
}

function prizePicksFallbackMessage(status) {
  if (status === 429) return "Rate limited. Showing cached props.";
  if (status === 403) return "PrizePicks blocked the request. Showing cached props.";
  if (status === 404) return "PrizePicks returned no data. Showing cached props.";
  return "Showing cached props.";
}

function shouldRetryPrizePicksTarget(status) {
  return status === 0 || status >= 500;
}

async function fetchPrizePicksUpstream(req, targetBase) {
  const fullUrl = req.url || "";
  const targetPath = rewritePrizePicksPath(fullUrl);
  const upstreamUrl = configuredProxyUrl(fullUrl, "PrizePicks") || new URL(targetPath, targetBase);
  const headers = prizePicksHeaders();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, { headers, signal: controller.signal });
    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "";
    const preview = text.slice(0, 200);

    console.info("[DFS proxy]", {
      source: "PrizePicks",
      requestUrl: fullUrl,
      upstreamUrl: upstreamUrl.toString(),
      status: upstream.status,
      contentType,
      preview,
    });
    console.log("PrizePicks raw response", preview);

    if (isJsSourceResponse(text, contentType)) {
      return {
        sent: false,
        ok: false,
        status: 502,
        error: "API route is serving source/HTML instead of JSON. Check proxy/backend routing.",
        preview,
        text: "",
      };
    }

    if (!upstream.ok) {
      const error =
        upstream.status === 403
          ? "PrizePicks blocked the request (403)"
          : upstream.status === 429
            ? "PrizePicks rate limited (429)"
            : `PrizePicks returned status ${upstream.status}.`;
      return { sent: false, ok: false, status: upstream.status, error, preview, text: "" };
    }

    return { sent: false, ok: true, status: upstream.status, text, preview, error: "" };
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `upstream fetch timed out after ${UPSTREAM_TIMEOUT_MS}ms`
        : error?.message || "upstream fetch failed";
    console.warn("[DFS proxy] PrizePicks fetch failed", { message });
    return { sent: false, ok: false, status: 0, error: message, preview: "", text: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function proxyUpstream(req, res, targetBase, rewriteFn, headers, source) {
  const fullUrl = req.url || "";
  let targetPath = rewriteFn(fullUrl);
  const upstreamUrl = configuredProxyUrl(fullUrl, source) || new URL(targetPath, targetBase);

  if (source === "Odds" && ODDS_API_KEY && !upstreamUrl.searchParams.has("apiKey")) {
    upstreamUrl.searchParams.set("apiKey", ODDS_API_KEY.trim());
  }
  const clientOddsKey = upstreamUrl.searchParams.get("apiKey");
  if (clientOddsKey) {
    upstreamUrl.searchParams.set("apiKey", clientOddsKey.trim().replace(/\s+/g, ""));
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
      upstreamUrl: upstreamUrl.toString().replace(/apiKey=[^&]+/gi, "apiKey=[REDACTED]"),
      status: upstream.status,
      contentType,
      preview,
    });
    if (source === "Odds") {
      console.info("[Odds API proxy]", {
        responseStatus: upstream.status,
        responseBody: preview,
      });
    }
    if (source === "PrizePicks") console.log("PrizePicks raw response", preview);

    if (isJsSourceResponse(text, contentType)) {
      console.warn("[DFS proxy] JS/HTML source detected — routing misconfigured", { requestUrl: fullUrl });
      sendJson(res, 502, apiErrorPayload(source, "API route is serving source/HTML instead of JSON. Check proxy/backend routing.", { preview }));
      return true;
    }

    if (!upstream.ok) {
      const error =
        source === "PrizePicks" && upstream.status === 403
          ? "PrizePicks blocked the request (403)"
          : source === "Odds" && (upstream.status === 401 || upstream.status === 403)
            ? "Invalid Odds API key or subscription access."
          : `${source} returned status ${upstream.status}.`;
      const statusCode = source === "Underdog" || source === "PrizePicks" ? 200 : upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      sendJson(res, statusCode, apiErrorPayload(source, error, { preview, upstreamStatus: upstream.status }));
      return true;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(text);
    return true;
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `upstream fetch timed out after ${UPSTREAM_TIMEOUT_MS}ms`
        : error?.message || "upstream fetch failed";
    console.warn("[DFS proxy] fetch failed", { source, message });
    const statusCode = source === "Underdog" || source === "PrizePicks" ? 200 : 502;
    sendJson(res, statusCode, apiErrorPayload(source, message));
    return true;
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

function apiFootballHeaders() {
  return {
    accept: "application/json",
    ...(API_FOOTBALL_KEY ? { "x-apisports-key": API_FOOTBALL_KEY } : {}),
  };
}

async function handleSportsDataMlbStatus(req, res) {
  const startedAt = Date.now();
  const apiKey = resolveSportsDataApiKeyFromRequest(req);
  if (!apiKey) {
    sendJson(res, 200, {
      ok: false,
      success: false,
      status: "not_configured",
      responseCode: 401,
      proxied: true,
      data: null,
      message: "SportsDataIO key not configured",
      durationMs: Date.now() - startedAt,
      route: "/api/sportsdataio/mlb-status",
    });
    return;
  }

  const result = await probeSportsDataMlbStatus(apiKey);
  sendJson(res, 200, {
    ...result,
    durationMs: Date.now() - startedAt,
    route: "/api/sportsdataio/mlb-status",
  });
}

async function proxySportsDataIoPath(req, res, rewrittenPath = "") {
  const fullUrl = rewrittenPath || req.url || "";
  const parsed = new URL(fullUrl, "http://localhost");
  const subPath = parsed.pathname.replace(/^\/api\/sportsdataio/, "") || "/";
  const apiKey = resolveSportsDataApiKeyFromRequest(req);

  if (!apiKey) {
    sendJson(res, 200, {
      ok: false,
      success: false,
      status: "not_configured",
      responseCode: 401,
      proxied: true,
      data: null,
      message: "SportsDataIO key not configured",
    });
    return;
  }

  const result = await fetchSportsDataUpstream(subPath, { apiKey });
  console.info("[DFS proxy]", {
    source: "SportsDataIO",
    requestUrl: req.url,
    subPath,
    status: result.responseCode,
    proxied: true,
    preview: result.text?.slice(0, 200) || "",
  });

  if (result.ok) {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(result.text || JSON.stringify(result.data));
    return;
  }

  sendJson(res, result.responseCode >= 400 && result.responseCode < 600 ? result.responseCode : 502, {
    ok: false,
    success: false,
    status: result.status,
    responseCode: result.responseCode,
    proxied: true,
    data: null,
    message: result.message,
    preview: result.text?.slice(0, 200) || "",
  });
}
