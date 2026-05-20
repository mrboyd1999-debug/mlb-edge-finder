export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const providerUrl = process.env.UNDERDOG_PROXY_URL;
    const apifyToken = process.env.APIFY_TOKEN;
    const apifyActor = process.env.UNDERDOG_APIFY_ACTOR;
    const url = providerUrl || apifyActorUrl(apifyActor, apifyToken);

    if (!url) {
      return res.status(200).json({
        error: true,
        needsSetup: true,
        source: "Underdog",
        message: "Underdog proxy is ready. Add UNDERDOG_PROXY_URL or APIFY_TOKEN plus UNDERDOG_APIFY_ACTOR to load live lines.",
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
        source: "Underdog",
        status: response.status,
        message: `Underdog provider returned status ${response.status}.`,
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
        source: "Underdog",
        message: "Underdog provider did not return valid JSON.",
        preview: text.slice(0, 300),
        data: [],
      });
    }

    return res.status(200).json({
      error: false,
      source: "Underdog",
      data,
    });
  } catch (error) {
    return res.status(200).json({
      error: true,
      source: "Underdog",
      message: error.message || "Underdog proxy failed.",
      data: [],
    });
  }
}

function apifyActorUrl(actor, token) {
  if (!actor || !token) return "";
  return `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
