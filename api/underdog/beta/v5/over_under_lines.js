import {
  fetchWithProxyTimeout,
  normalizeProxyUrl,
  PROVIDER_PROXY_FETCH_TIMEOUT_MS,
  UNDERDOG_PROXY_DISABLED_LOG,
} from "../../../../src/utils/providerProxy.js";

export default async function handler(req, res) {
  return proxyUnderdog(req, res, "v5");
}

async function proxyUnderdog(req, res, version) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const directUrl = `https://api.underdogfantasy.com/beta/${version}/over_under_lines`;
  const rawQueryProxy = String(req.query?.proxyUrl || "").trim();
  if (rawQueryProxy && !normalizeProxyUrl(rawQueryProxy)) {
    console.error(UNDERDOG_PROXY_DISABLED_LOG);
  }
  const url = normalizeProxyUrl(rawQueryProxy) || directUrl;
  const result = await fetchJsonOnly(String(url), "Underdog");

  if (!result.ok) {
    return res.status(200).json({
      ok: false,
      error: true,
      source: "Underdog",
      message: result.error,
      errorMessage: result.error,
      preview: result.preview || "",
      props: [],
      data: [],
    });
  }

  return res.status(200).json({
    ok: true,
    error: false,
    source: "Underdog",
    props: Array.isArray(result.data) ? result.data : result.data?.over_under_lines || result.data?.data || [],
    data: result.data,
    over_under_lines: Array.isArray(result.data) ? result.data : result.data?.over_under_lines || [],
    players: Array.isArray(result.data) ? [] : result.data?.players || [],
    games: Array.isArray(result.data) ? [] : result.data?.games || result.data?.matches || [],
    appearances: Array.isArray(result.data) ? [] : result.data?.appearances || [],
  });
}

async function fetchJsonOnly(url, source) {
  try {
    const response = await fetchWithProxyTimeout(url, { headers: underdogHeaders() }, PROVIDER_PROXY_FETCH_TIMEOUT_MS);
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const preview = text.slice(0, 200);

    console.info("[Underdog v5 API] upstream", {
      status: response.status,
      contentType,
      preview,
    });

    if (!response.ok) {
      return { ok: false, error: `${source} returned status ${response.status}.`, preview };
    }
    return parseJsonOnly(text, source, contentType);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return {
      ok: false,
      error: timedOut
        ? `${source} fetch timed out after ${PROVIDER_PROXY_FETCH_TIMEOUT_MS}ms`
        : error.message || `${source} direct proxy failed.`,
      preview: "",
    };
  }
}

function parseJsonOnly(text, source, contentType = "") {
  const trimmed = String(text || "").trim();
  if (
    !trimmed ||
    trimmed.startsWith("<") ||
    /html|javascript/i.test(contentType) ||
    /^export\s+default\b/.test(trimmed) ||
    trimmed.includes("export default async function")
  ) {
    return {
      ok: false,
      error: "API route is serving source/HTML instead of JSON. Check proxy/backend routing.",
      preview: trimmed.slice(0, 200),
    };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed), preview: trimmed.slice(0, 200) };
  } catch {
    return { ok: false, error: `${source} returned invalid JSON.`, preview: trimmed.slice(0, 200) };
  }
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
