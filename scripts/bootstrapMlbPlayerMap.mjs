#!/usr/bin/env node
/**
 * Bootstrap src/data/mlbPlayerMap.json from SportsDataIO season stats.
 * Usage: node scripts/bootstrapMlbPlayerMap.mjs
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outPath = resolve(root, "src/data/mlbPlayerMap.json");

function normalizePlayerName(name = "") {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/[''.`-]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAliases(fullName = "") {
  const normalized = normalizePlayerName(fullName);
  const tokens = normalized.split(" ").filter(Boolean);
  const aliases = new Set([normalized]);
  if (tokens.length >= 2) {
    aliases.add(`${tokens[0][0]} ${tokens[tokens.length - 1]}`.trim());
    aliases.add(`${tokens[tokens.length - 1]}`);
  }
  return [...aliases];
}

async function loadEnvKey() {
  try {
    const { readFileSync } = await import("node:fs");
    const envPath = resolve(root, ".env.local");
    const text = readFileSync(envPath, "utf8");
    const match = text.match(/^SPORTSDATAIO_API_KEY=(.+)$/m) || text.match(/^VITE_SPORTSDATAIO_API_KEY=(.+)$/m);
    return match?.[1]?.trim() || process.env.SPORTSDATAIO_API_KEY || process.env.VITE_SPORTSDATAIO_API_KEY || "";
  } catch {
    return process.env.SPORTSDATAIO_API_KEY || process.env.VITE_SPORTSDATAIO_API_KEY || "";
  }
}

async function main() {
  const key = await loadEnvKey();
  if (!key) {
    console.error("No SportsDataIO API key found — skipping bootstrap.");
    process.exit(1);
  }

  const season = new Date().getFullYear();
  const url = `https://api.sportsdata.io/v3/mlb/stats/json/PlayerSeasonStats/${season}?key=${encodeURIComponent(key)}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error("SportsDataIO fetch failed", response.status, await response.text());
    process.exit(1);
  }

  const rows = await response.json();
  const players = (rows || [])
    .filter((row) => row?.Name && row?.Team)
    .map((row) => ({
      playerId: row.PlayerID,
      fullName: row.Name,
      normalizedName: normalizePlayerName(row.Name),
      team: String(row.Team || "").toUpperCase(),
      position: row.Position || "",
      aliases: buildAliases(row.Name),
    }));

  const payload = {
    meta: {
      description: "MLB player → team map bootstrapped from SportsDataIO PlayerSeasonStats",
      version: 1,
      season,
      generatedAt: new Date().toISOString(),
      count: players.length,
    },
    players,
  };

  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${players.length} players to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
