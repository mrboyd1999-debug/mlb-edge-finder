import express from "express";
import { buildBestPlays } from "./api/bestPlaysEngine.js";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    routes: {
      bestPlays: "/api/best-plays",
      health: "/api/health",
    },
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/best-plays", async (_req, res) => {
  try {
    const result = await buildBestPlays();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error?.message || "Best Plays Engine failed.",
    });
  }
});

app.listen(port, () => {
  console.info(`Best Plays Engine listening on http://localhost:${port}`);
});
