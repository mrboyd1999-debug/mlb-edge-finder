import { buildBestPlays } from "./lib/bestPlaysEngine.js";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed." });
  }

  try {
    const result = await buildBestPlays();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Best Plays Engine failed.",
    });
  }
}
