/**
 * Merge .env layers — empty values do NOT override non-empty values from earlier files.
 */

import fs from "node:fs";
import path from "node:path";

const PLACEHOLDER_PATTERN =
  /^(your_|paste_|replace_|example_|xxx+|000+)|(_here|_key)$/i;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function isUsableEnvValue(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_PATTERN.test(trimmed)) return false;
  return true;
}

function firstUsable(...values) {
  for (const value of values) {
    if (isUsableEnvValue(value)) return String(value).trim();
  }
  return "";
}

/** Merge env files in Vite priority order; skip empty overrides. */
export function resolveProjectEnv(mode = "development", root = process.cwd()) {
  const layers = [
    path.join(root, ".env"),
    path.join(root, ".env.local"),
    path.join(root, `.env.${mode}`),
    path.join(root, `.env.${mode}.local`),
  ];

  const merged = {};
  for (const file of layers) {
    const parsed = parseEnvFile(file);
    for (const [key, value] of Object.entries(parsed)) {
      if (isUsableEnvValue(value)) merged[key] = value;
    }
  }

  const oddsKey = firstUsable(
    merged.VITE_ODDS_API_KEY,
    merged.ODDS_API_KEY,
    merged.THE_ODDS_API_KEY,
    process.env.VITE_ODDS_API_KEY,
    process.env.ODDS_API_KEY,
    process.env.THE_ODDS_API_KEY
  );
  const sportsDataKey = firstUsable(
    merged.VITE_SPORTSDATAIO_API_KEY,
    merged.VITE_SPORTSDATA_API_KEY,
    merged.SPORTSDATAIO_API_KEY,
    merged.SPORTSDATA_API_KEY,
    merged.SPORTS_DATA_IO_API_KEY,
    process.env.VITE_SPORTSDATAIO_API_KEY,
    process.env.VITE_SPORTSDATA_API_KEY,
    process.env.SPORTSDATAIO_API_KEY,
    process.env.SPORTSDATA_API_KEY,
    process.env.SPORTS_DATA_IO_API_KEY
  );

  return {
    ...merged,
    VITE_ODDS_API_KEY: oddsKey,
    ODDS_API_KEY: oddsKey,
    THE_ODDS_API_KEY: oddsKey,
    VITE_SPORTSDATA_API_KEY: sportsDataKey,
    VITE_SPORTSDATAIO_API_KEY: firstUsable(
      merged.VITE_SPORTSDATAIO_API_KEY,
      sportsDataKey,
      process.env.VITE_SPORTSDATAIO_API_KEY
    ),
    SPORTSDATAIO_API_KEY: firstUsable(merged.SPORTSDATAIO_API_KEY, sportsDataKey, process.env.SPORTSDATAIO_API_KEY),
    SPORTSDATA_API_KEY: sportsDataKey,
    SPORTS_DATA_IO_API_KEY: firstUsable(merged.SPORTS_DATA_IO_API_KEY, sportsDataKey, process.env.SPORTS_DATA_IO_API_KEY),
  };
}
