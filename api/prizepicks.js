import {
  buildPrizePicksFallbackPayload,
  getPrizePicksServerCooldownRemainingMs,
  isPrizePicksServerCooldown,
  markPrizePicksUpstreamAttempt,
  savePrizePicksPayload,
  withPrizePicksServerLock,
} from "./lib/prizepicksServerCache.js";
import {
  fetchPrizePicks,
  PRIZEPICKS_MLB_LEAGUE_ID,
} from "./lib/prizepicksFetch.js";
import { parsePrizePicksProjections } from "../src/utils/prizepicksParse.js";

const APIFY_PRIZEPICKS_ACTOR = "zen-studio~prizepicks-player-props";

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const leagueId = req.query?.league_id || "";
    const proxyUrl = req.query?.proxyUrl || "";
    return await respondWithPrizePicks(res, leagueId, proxyUrl);
  } catch (error) {
    const fallback = buildPrizePicksFallbackPayload(null, {
      rateLimited: false,
      message: "Showing cached props.",
    });
    if (fallback) return res.status(200).json(fallback);
    return res.status(200).json({
      ok: true,
      source: "PrizePicks",
      fallback: true,
      status: "empty",
      data: { data: [], included: [] },
      props: [],
      message: error.message || "upstream fetch failed",
    });
  }
}

async function respondWithPrizePicks(res, leagueId, proxyUrl) {
  const cooldownPayload = buildCooldownFallbackPayload();
  if (cooldownPayload) return res.status(200).json(cooldownPayload);

  return withPrizePicksServerLock(async () => {
    const cooldownAgain = buildCooldownFallbackPayload();
    if (cooldownAgain) return res.status(200).json(cooldownAgain);

    markPrizePicksUpstreamAttempt();
    const result = await fetchPrizePicksBoard(leagueId, proxyUrl);

    if (result.ok && result.data) {
      savePrizePicksPayload(result.data);
      return respondWithFetch(res, result);
    }

    const fallback = buildPrizePicksFallbackPayload(null, {
      rateLimited: result.status === 429,
      message: fallbackMessageForStatus(result.status),
    });
    if (fallback) return res.status(200).json(fallback);

    return respondWithFetch(res, result);
  });
}

function buildCooldownFallbackPayload() {
  if (!isPrizePicksServerCooldown()) return null;
  const remainingSec = Math.ceil(getPrizePicksServerCooldownRemainingMs() / 1000);
  return buildPrizePicksFallbackPayload(null, {
    rateLimited: true,
    message: `Rate limited. Showing cached props. Wait ${remainingSec}s.`,
  });
}

function fallbackMessageForStatus(status) {
  if (status === 429) return "Rate limited. Showing cached props.";
  if (status === 403) return "PrizePicks blocked the request. Showing cached props.";
  if (status === 404) return "PrizePicks returned no data. Showing cached props.";
  return "Showing cached props.";
}

async function fetchPrizePicksBoard(leagueId = "", proxyUrl = "") {
  const providerUrl =
    proxyUrl ||
    process.env.VITE_PRIZEPICKS_PROXY_URL ||
    process.env.PRIZEPICKS_PROXY_URL;
  const apifyToken = process.env.APIFY_TOKEN;
  const configuredUrl = providerUrl || apifyActorUrl(APIFY_PRIZEPICKS_ACTOR, apifyToken);

  if (configuredUrl) {
    return fetchConfiguredProxy(configuredUrl, leagueId);
  }

  const effectiveLeagueId = leagueId || PRIZEPICKS_MLB_LEAGUE_ID;
  const data = await fetchPrizePicks({ leagueId: effectiveLeagueId });
  const valid = parsePrizePicksProjections(data);
  const hasData = Array.isArray(data?.data) && data.data.length > 0;

  if (hasData) {
    return { ok: true, data, status: 200, parsedValid: valid.length };
  }

  return {
    ok: false,
    status: 0,
    error: leagueId
      ? `PrizePicks returned no projection data (league ${leagueId}).`
      : "PrizePicks returned no projection data.",
    data: null,
  };
}

async function fetchConfiguredProxy(url, leagueId) {
  try {
    const response = await fetch(url, { headers: prizePicksHeaders() });
    const text = await response.text();
    const parsed = parseJsonOrError(text, "PrizePicks", response.headers.get("content-type") || "");
    console.info("[PrizePicks API] configured proxy", {
      leagueId: leagueId || "all",
      status: response.status,
      ok: response.ok,
    });
    if (response.ok && parsed.ok) {
      return { ok: true, data: parsed.data, status: response.status };
    }
    return {
      ok: false,
      status: response.status,
      error: !response.ok ? prizePicksStatusMessage(response.status, leagueId) : parsed.error,
      preview: text.slice(0, 200),
      data: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message || "configured proxy failed",
      data: null,
    };
  }
}

function respondWithFetch(res, result) {
  if (!result.ok) {
    const message = result.error || "PrizePicks returned non-JSON response";
    return res.status(200).json({
      ok: false,
      source: "PrizePicks",
      status: "failed",
      error: message,
      htmlError: /non-json|html/i.test(message),
      props: [],
      data: { data: [], included: [] },
      preview: result.preview || "",
      upstreamStatus: result.status || 0,
    });
  }

  const data = result.data;
  return res.status(200).json({
    ok: true,
    error: false,
    source: "PrizePicks",
    props: Array.isArray(data) ? data : data?.data || [],
    data,
  });
}

function parseJsonOrError(text, source, contentType = "") {
  const trimmed = String(text || "").trim();
  const looksHtml = trimmed.startsWith("<") || /text\/html/i.test(contentType);
  const looksJavaScript =
    /^export\s+default\b/.test(trimmed) || trimmed.includes("export default async function");
  if (!trimmed) {
    return { ok: false, error: `${source} returned empty response`, preview: "" };
  }
  if (looksHtml || looksJavaScript) {
    return {
      ok: false,
      error: "API route is serving source/HTML instead of JSON. Check proxy/backend routing.",
      preview: trimmed.slice(0, 300),
    };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch {
    return { ok: false, error: `${source} returned invalid JSON`, preview: trimmed.slice(0, 300) };
  }
}

function prizePicksStatusMessage(status, leagueId) {
  if (status === 403) return "PrizePicks blocked the request (403)";
  if (status === 429) return "PrizePicks rate limited (429)";
  if (status === 404) return "PrizePicks returned no projection data (404)";
  return `PrizePicks provider returned status ${status} (league ${leagueId}).`;
}

function prizePicksHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    Accept: "application/json",
    origin: "https://app.prizepicks.com",
    referer: "https://app.prizepicks.com/",
  };
}

function apifyActorUrl(actor, token) {
  if (!token) return "";
  return `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
