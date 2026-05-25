import { cleanApiKey } from "./lib/cleanApiKey.js";

function sanitizeOddsApiKey(key = "") {
  return cleanApiKey(key);
}

function redactOddsApiUrl(url = "") {
  return String(url).replace(/apiKey=[^&]+/gi, "apiKey=[REDACTED]");
}

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

    const apiKey = sanitizeOddsApiKey(
      req.query?.apiKey || process.env.ODDS_API_KEY || process.env.VITE_ODDS_API_KEY || ""
    );
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

    console.info("[Sportsbook Odds API] request", {
      path,
      upstreamUrl: redactOddsApiUrl(upstreamUrl.toString()),
      keyLength: apiKey.length,
    });

    const upstream = await fetch(upstreamUrl, {
      headers: { accept: "application/json" },
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "application/json";
    const preview = text.slice(0, 240);

    console.info("[Sportsbook Odds API] response", {
      path,
      status: upstream.status,
      contentType,
      bodyPreview: preview,
    });

    if (upstream.status === 401 || upstream.status === 403) {
      return res.status(upstream.status).json({
        error: true,
        source: "The Odds API",
        upstreamStatus: upstream.status,
        message: "Invalid Odds API key or subscription access.",
        preview,
        data: null,
      });
    }

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(200).json({
        error: true,
        source: "The Odds API",
        status: upstream.status,
        message: "The Odds API did not return valid JSON.",
        preview,
        data: null,
      });
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: true,
        source: "The Odds API",
        upstreamStatus: upstream.status,
        message: data?.message || `The Odds API returned status ${upstream.status}.`,
        preview,
        data: null,
      });
    }

    const remaining = upstream.headers.get("x-requests-remaining");
    const used = upstream.headers.get("x-requests-used");
    if (remaining != null) res.setHeader("x-requests-remaining", remaining);
    if (used != null) res.setHeader("x-requests-used", used);

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
  res.setHeader("Access-Control-Expose-Headers", "x-requests-remaining, x-requests-used");
}
