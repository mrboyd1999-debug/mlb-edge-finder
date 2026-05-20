export default async function handler(req, res) {
  return proxyUnderdog(req, res, "v3");
}

async function proxyUnderdog(req, res, version) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const upstream = await fetch(`https://api.underdogfantasy.com/beta/${version}/over_under_lines`, {
      headers: underdogHeaders(),
    });
    const text = await upstream.text();

    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (error) {
    return res.status(502).json({
      error: true,
      source: "Underdog",
      message: error.message || "Underdog direct proxy failed.",
    });
  }
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

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
