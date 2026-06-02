import {
  fetchSportsDataUpstream,
  resolveSportsDataApiKeyFromRequest,
  setSportsDataCorsHeaders,
} from "../lib/sportsDataServer.js";

export default async function handler(req, res) {
  setSportsDataCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const segments = req.query?.path;
  const subPath = Array.isArray(segments) ? `/${segments.join("/")}` : segments ? `/${segments}` : "";
  if (!subPath || subPath === "/") {
    return res.status(200).json({
      ok: false,
      success: false,
      status: "failed",
      responseCode: 400,
      proxied: true,
      data: null,
      message: "Missing SportsDataIO proxy path.",
    });
  }

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
    });
  }

  const result = await fetchSportsDataUpstream(subPath, { apiKey });
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (result.ok) {
    return res.status(200).json(result.data);
  }

  return res.status(result.responseCode >= 400 && result.responseCode < 600 ? result.responseCode : 502).json({
    ok: false,
    success: false,
    status: result.status,
    responseCode: result.responseCode,
    proxied: true,
    data: null,
    message: result.message,
    preview: result.text?.slice(0, 200) || "",
  });
}
