export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  return res.status(200).json({
    ok: true,
    routes: {
      prizepicks: "/api/prizepicks",
      underdog: "/api/underdog",
      odds: "/api/sportsbookOdds",
      sportsdataio: "/api/sportsdataio/mlb-status",
      bestPlays: "/api/best-plays",
      health: "/api/health",
    },
    configured: {
      oddsApi: Boolean(process.env.ODDS_API_KEY || process.env.VITE_ODDS_API_KEY),
      sportsDataApi: Boolean(
        process.env.SPORTSIO_KEY ||
          process.env.SPORTSDATA_API_KEY ||
          process.env.VITE_SPORTSDATA_API_KEY
      ),
      prizepicksProxy: Boolean(process.env.VITE_PRIZEPICKS_PROXY_URL || process.env.PRIZEPICKS_PROXY_URL),
      underdogProxy: Boolean(process.env.VITE_UNDERDOG_PROXY_URL || process.env.UNDERDOG_PROXY_URL),
      apify: Boolean(process.env.APIFY_TOKEN),
    },
    timestamp: new Date().toISOString(),
  });
}
