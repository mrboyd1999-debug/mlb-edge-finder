const PRIZEPICKS_PROJECTION_BASES = [
  "https://partner-api.prizepicks.com/projections",
  "https://api.prizepicks.com/projections",
];

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const urls = projectionUrls(req.query);
  let lastResult = null;

  for (const url of urls) {
    lastResult = await fetchJsonOnly(url, "PrizePicks");
    if (lastResult.ok) {
      return res.status(200).json({
        ok: true,
        error: false,
        source: "PrizePicks",
        props: Array.isArray(lastResult.data) ? lastResult.data : lastResult.data?.data || [],
        data: lastResult.data,
      });
    }
  }

  return res.status(200).json({
    ok: false,
    error: true,
    source: "PrizePicks",
    message: lastResult?.error || "PrizePicks returned no JSON data.",
    errorMessage: lastResult?.error || "PrizePicks returned no JSON data.",
    preview: lastResult?.preview || "",
    props: [],
    data: [],
  });
}

function projectionUrls(query = {}) {
  if (query.proxyUrl) return [String(query.proxyUrl)];
  return PRIZEPICKS_PROJECTION_BASES.map((base) => {
    const url = new URL(base);
    Object.entries(query).forEach(([key, value]) => {
      if (key === "proxyUrl") return;
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
      else if (value != null && value !== "") url.searchParams.set(key, value);
    });
    if (!url.searchParams.has("per_page")) url.searchParams.set("per_page", "250");
    if (!url.searchParams.has("single_stat")) url.searchParams.set("single_stat", "true");
    if (!url.searchParams.has("game_mode")) url.searchParams.set("game_mode", "pickem");
    return url.toString();
  });
}

async function fetchJsonOnly(url, source) {
  try {
    const response = await fetch(url, { headers: prizePicksHeaders() });
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const preview = text.slice(0, 200);

    console.info("[PrizePicks projections API] upstream", {
      url: redactUrl(url),
      status: response.status,
      contentType,
      preview,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: response.status === 403 ? "PrizePicks blocked the request (403)" : `${source} returned status ${response.status}.`,
        preview,
      };
    }

    return parseJsonOnly(text, source, contentType);
  } catch (error) {
    return { ok: false, error: error.message || `${source} proxy failed.`, preview: "" };
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

function redactUrl(url) {
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
    accept: "application/json",
    origin: "https://app.prizepicks.com",
    referer: "https://app.prizepicks.com/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  };
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
