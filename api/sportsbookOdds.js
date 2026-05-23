export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const path = typeof req.query?.path === "string" ? req.query.path : "";
    if (!path || !path.startsWith("/v4/")) {
      return res.status(200).json({
        error: true,
        source: "The Odds API",
        message: "Missing or invalid sportsbook proxy path.",
        data: null,
      });
    }

    const apiKey = req.query?.apiKey || process.env.ODDS_API_KEY || process.env.VITE_ODDS_API_KEY || "";
    if (!apiKey) {
      return res.status(200).json({
        error: true,
        source: "The Odds API",
        message: "Missing API key.",
        data: null,
      });
    }

    const upstreamUrl = new URL(path, "https://api.the-odds-api.com");
    Object.entries(req.query || {}).forEach(([key, value]) => {
      if (key === "path") return;
      if (Array.isArray(value)) {
        value.forEach((item) => upstreamUrl.searchParams.append(key, item));
      } else if (value != null) {
        upstreamUrl.searchParams.set(key, value);
      }
    });
    upstreamUrl.searchParams.set("apiKey", apiKey);

    const upstream = await fetch(upstreamUrl, {
      headers: { accept: "application/json" },
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "application/json";

    console.info("[Sportsbook Odds API] upstream", {
      path,
      status: upstream.status,
      contentType,
    });

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(200).json({
        error: true,
        source: "The Odds API",
        status: upstream.status,
        message: "The Odds API did not return valid JSON.",
        preview: text.slice(0, 300),
        data: null,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(200).json({
      error: true,
      source: "The Odds API",
      message: error.message || "Sportsbook odds proxy failed.",
      data: null,
    });
  }
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
