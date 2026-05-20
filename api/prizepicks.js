const APIFY_PRIZEPICKS_ACTOR = "zen-studio~prizepicks-player-props";

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const providerUrl = process.env.PRIZEPICKS_PROXY_URL;
    const apifyToken = process.env.APIFY_TOKEN;
    const url = providerUrl || apifyActorUrl(APIFY_PRIZEPICKS_ACTOR, apifyToken);

    if (!url) {
      return res.status(200).json({
        error: true,
        needsSetup: true,
        source: "PrizePicks",
        message: "PrizePicks proxy is ready. Add APIFY_TOKEN or PRIZEPICKS_PROXY_URL to load live lines.",
        data: [],
      });
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });
    const text = await response.text();

    if (!response.ok) {
      return res.status(200).json({
        error: true,
        source: "PrizePicks",
        status: response.status,
        message: `PrizePicks provider returned status ${response.status}.`,
        preview: text.slice(0, 300),
        data: [],
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(200).json({
        error: true,
        source: "PrizePicks",
        message: "PrizePicks provider did not return valid JSON.",
        preview: text.slice(0, 300),
        data: [],
      });
    }

    return res.status(200).json({
      error: false,
      source: "PrizePicks",
      data,
    });
  } catch (error) {
    return res.status(200).json({
      error: true,
      source: "PrizePicks",
      message: error.message || "PrizePicks proxy failed.",
      data: [],
    });
  }
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
