/**
 * Best Plays debug helpers — MLB-only, no fabricated projections.
 */

import { resolveProjectionValue } from "./projectionQuality.js";

export const BEST_PLAYS_DEBUG_MODE = true;
export const BEST_PLAYS_DEBUG_SAMPLE_SIZE = 25;

export function normalizeMatchName(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeProjectionValue(value) {
  const projection = Number(value);
  if (Number.isNaN(projection) || !Number.isFinite(projection)) {
    return null;
  }
  return projection;
}

export function resolveBestPlayPlayerName(prop = {}) {
  return String(prop.playerName || prop.player || "").trim();
}

export function resolveBestPlayProjection(prop = {}) {
  const direct = sanitizeProjectionValue(prop.projection ?? prop.projectedValue);
  if (direct != null) return direct;
  const last5 = sanitizeProjectionValue(prop.last5Average);
  if (last5 != null) return last5;
  const season = sanitizeProjectionValue(prop.seasonAverage);
  if (season != null) return season;
  return sanitizeProjectionValue(resolveProjectionValue(prop));
}

export function passesMinimalBestPlaysFilter(prop = {}) {
  const player = resolveBestPlayPlayerName(prop);
  const line = Number(prop.line);
  return Boolean(player) && Number.isFinite(line) && line > 0;
}

export function passesVerifiedBestPlaysFilter(prop = {}) {
  return passesMinimalBestPlaysFilter(prop) && resolveBestPlayProjection(prop) != null;
}

export function resolveBestPlayInvalidReason(prop = {}) {
  const player = resolveBestPlayPlayerName(prop);
  if (!player) return "missing player";
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return "missing line";
  if (resolveBestPlayProjection(prop) == null) {
    return prop.projectionMissingReason || prop.sportsDataMatchReason || "missing projection";
  }
  return "";
}

export function logBestPlaysPipelineStage(label, payload = {}) {
  console.log(label, payload);
}
