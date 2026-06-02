import {
  fetchWithProxyTimeout,
  normalizeProxyUrl,
  PROVIDER_PROXY_FETCH_TIMEOUT_MS,
  resolveFirstValidProxyUrl,
  UNDERDOG_PROXY_DISABLED_LOG,
} from "../src/utils/providerProxy.js";

const UNDERDOG_DIRECT_URL = "https://api.underdogfantasy.com/beta/v5/over_under_lines";

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const rawQueryProxy = String(req.query?.proxyUrl || "").trim();
    if (rawQueryProxy && !normalizeProxyUrl(rawQueryProxy)) {
      console.error(UNDERDOG_PROXY_DISABLED_LOG);
    }

    const apifyToken = process.env.APIFY_TOKEN;
    const apifyActor = process.env.UNDERDOG_APIFY_ACTOR;
    const providerUrl = resolveFirstValidProxyUrl([
      req.query?.proxyUrl,
      process.env.VITE_UNDERDOG_PROXY_URL,
      process.env.UNDERDOG_PROXY_URL,
      apifyActorUrl(apifyActor, apifyToken),
    ]);
    const url = providerUrl || UNDERDOG_DIRECT_URL;

    const response = await fetchWithProxyTimeout(url, { headers: underdogHeaders() }, PROVIDER_PROXY_FETCH_TIMEOUT_MS);
    const text = await response.text();
    const parsed = parseJsonOrError(text, "Underdog");

    console.info("[Underdog API] upstream", {
      url,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      ok: response.ok,
      preview: text.slice(0, 300),
    });

    if (!response.ok || !parsed.ok) {
      return res.status(200).json({
        ok: false,
        source: "Underdog",
        status: "failed",
        error: !response.ok ? `Underdog provider returned status ${response.status}.` : parsed.error,
        preview: text.slice(0, 300),
        props: [],
        data: [],
      });
    }

    const props = underdogPropsFromPayload(parsed.data);
    const root = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : {};
    return res.status(200).json({
      ok: true,
      error: false,
      source: "Underdog",
      props,
      data: parsed.data,
      over_under_lines: root.over_under_lines || props,
      players: root.players || [],
      games: root.games || root.matches || [],
      appearances: root.appearances || [],
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return res.status(200).json({
      ok: false,
      source: "Underdog",
      status: "failed",
      error: timedOut
        ? `Underdog fetch timed out after ${PROVIDER_PROXY_FETCH_TIMEOUT_MS}ms`
        : error.message || "upstream fetch failed",
      props: [],
      data: [],
    });
  }
}

function underdogPropsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.props)) return payload.props;
  if (Array.isArray(payload?.over_under_lines)) return payload.over_under_lines;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function parseJsonOrError(text, source) {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed.startsWith("<") || /^export\s+default\b/.test(trimmed) || trimmed.includes("export default async function")) {
    return { ok: false, error: "API route is serving source/HTML instead of JSON. Check proxy/backend routing." };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch {
    return { ok: false, error: `${source} returned invalid JSON.` };
  }
}

function apifyActorUrl(actor, token) {
  if (!actor || !token) return "";
  return normalizeProxyUrl(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`
  );
}

function underdogHeaders() {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    origin: "https://underdogfantasy.com",
    referer: "https://underdogfantasy.com/",
    "x-requested-with": "XMLHttpRequest",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  };
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept");
}
