import {
  buildPrizePicksFallbackPayload,
  getPrizePicksServerCooldownRemainingMs,
  isPrizePicksServerCooldown,
  markPrizePicksUpstreamAttempt,
  savePrizePicksPayload,
  withPrizePicksServerLock,
} from "./lib/prizepicksServerCache.js";

const APIFY_PRIZEPICKS_ACTOR = "zen-studio~prizepicks-player-props";
const PRIZEPICKS_PROJECTION_BASES = [
  "https://partner-api.prizepicks.com/projections",
  "https://api.prizepicks.com/projections",
];

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
      ok: false,
      source: "PrizePicks",
      status: "failed",
      error: error.message || "upstream fetch failed",
      props: [],
      data: [],
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

    if (result.ok) {
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
  const urls = configuredUrl ? [configuredUrl] : prizePicksProjectionUrls(leagueId);
  let lastError = null;

  for (const url of urls) {
    const response = await fetch(url, {
      headers: prizePicksHeaders(),
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const preview = text.slice(0, 200);
    const parsed = parseJsonOrError(text, "PrizePicks", contentType);

    console.info("[PrizePicks API] upstream", {
      leagueId: leagueId || "all",
      url: redactPrizePicksUrl(url),
      status: response.status,
      contentType,
      ok: response.ok,
      preview,
    });
    console.log("PrizePicks raw response", preview);

    if (response.ok && parsed.ok) {
      return { ok: true, data: parsed.data, status: response.status };
    }

    lastError = {
      ok: false,
      status: response.status,
      error: !response.ok ? prizePicksStatusMessage(response.status, leagueId) : parsed.error,
      preview,
      data: null,
    };

    if (!shouldTryNextUrl(response.status)) break;
  }

  return (
    lastError || {
      ok: false,
      status: 0,
      error: leagueId
        ? `PrizePicks returned no projection data (league ${leagueId}).`
        : "PrizePicks returned no projection data.",
      data: null,
    }
  );
}

function shouldTryNextUrl(status) {
  return status === 0 || status >= 500;
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
      data: [],
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
  if (looksHtml) {
    return {
      ok: false,
      error: "API route is serving source/HTML instead of JSON. Check proxy/backend routing.",
      preview: trimmed.slice(0, 300),
    };
  }
  if (looksJavaScript) {
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

function prizePicksProjectionUrls(leagueId) {
  return PRIZEPICKS_PROJECTION_BASES.map((base) => {
    const url = new URL(base);
    if (leagueId) url.searchParams.set("league_id", leagueId);
    url.searchParams.set("per_page", "250");
    url.searchParams.set("single_stat", "true");
    url.searchParams.set("game_mode", "pickem");
    return url.toString();
  });
}

function prizePicksStatusMessage(status, leagueId) {
  if (status === 403) return "PrizePicks blocked the request (403)";
  if (status === 429) return "PrizePicks rate limited (429)";
  if (status === 404) return "PrizePicks returned no projection data (404)";
  return `PrizePicks provider returned status ${status} (league ${leagueId}).`;
}

function redactPrizePicksUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("token")) parsed.searchParams.set("token", "***");
    return parsed.toString();
  } catch {
    return url;
  }
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
