import {
  probeSportsDataMlbStatus,
  resolveSportsDataApiKeyFromRequest,
  setSportsDataCorsHeaders,
} from "../lib/sportsDataServer.js";

export default async function handler(req, res) {
  setSportsDataCorsHeaders(res);
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const startedAt = Date.now();
  const apiKey = resolveSportsDataApiKeyFromRequest(req);

  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      success: false,
      status: "not_configured",
      responseCode: 401,
      proxied: true,
      data: null,
      message: "SportsDataIO key not configured",
      durationMs: Date.now() - startedAt,
      route: "/api/sportsdataio/mlb-status",
    });
  }

  const result = await probeSportsDataMlbStatus(apiKey);
  return res.status(200).json({
    ...result,
    durationMs: Date.now() - startedAt,
    route: "/api/sportsdataio/mlb-status",
  });
}
