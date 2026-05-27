/**
 * Best Plays debug helpers — MLB-only, no fabricated projections.
 */

import { resolveProjectionValue } from "./projectionQuality.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { resolveEdgeMagnitude } from "./bestPlayRanking.js";

export const BEST_PLAYS_DEBUG_MODE = false;
export const BEST_PLAYS_DEBUG_SAMPLE_SIZE = 0;
export const PROJECTION_JOIN_DEBUG = import.meta.env?.DEV === true;

export const VERIFIED_MIN_PROJECTION = 0.01;
export const VERIFIED_MIN_CONFIDENCE = 65;
export const VERIFIED_MIN_EDGE = 0.015;

function resolveNumericConfidence(prop = {}) {
  const score = Number(prop.confidenceScore);
  if (Number.isFinite(score)) return score;
  const verified = Number(prop.verifiedProbability);
  if (Number.isFinite(verified)) return verified;
  const raw = Number(prop.confidence);
  if (Number.isFinite(raw)) return raw;
  return NaN;
}

export function normalizeMatchName(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeProjectionValue(value) {
  const projection = Number(value);
  if (Number.isNaN(projection) || !Number.isFinite(projection) || projection <= 0) {
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
  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  const team = String(prop.team || "").trim();
  return Boolean(player) && Number.isFinite(line) && line > 0 && Boolean(statType) && Boolean(team);
}

export function passesVerifiedBestPlaysFilter(prop = {}) {
  if (!passesMinimalBestPlaysFilter(prop)) return false;
  if (resolvePropSport(prop) !== "MLB") return false;
  if (!PROJECTION_JOIN_DEBUG) {
    const projection = resolveBestPlayProjection(prop);
    if (projection == null || projection <= VERIFIED_MIN_PROJECTION) return false;
    const confidence = resolveNumericConfidence(prop);
    if (!Number.isFinite(confidence) || confidence < VERIFIED_MIN_CONFIDENCE) return false;
    const edge = resolveEdgeMagnitude(prop);
    if (!Number.isFinite(edge) || edge < VERIFIED_MIN_EDGE) return false;
    if (prop.projectionUnavailable || prop.unverifiedGradeBlocked) return false;
  }
  return true;
}

export function resolveBestPlayInvalidReason(prop = {}) {
  const player = resolveBestPlayPlayerName(prop);
  if (!player) return "missing player";
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return "missing line";
  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  if (!statType) return "missing stat type";
  if (!String(prop.team || "").trim()) return "missing team";
  if (resolvePropSport(prop) !== "MLB") return "non-MLB sport";
  const projection = resolveBestPlayProjection(prop);
  if (projection == null || projection <= 0) {
    return prop.projectionMissingReason || prop.sportsDataMatchReason || "missing projection";
  }
  const confidence = resolveNumericConfidence(prop);
  if (!Number.isFinite(confidence) || confidence < VERIFIED_MIN_CONFIDENCE) return "low confidence";
  const edge = resolveEdgeMagnitude(prop);
  if (!Number.isFinite(edge) || edge < VERIFIED_MIN_EDGE) return "weak edge";
  if (prop.projectionUnavailable || prop.unverifiedGradeBlocked) return "invalid projection quality";
  return "";
}

export function logBestPlaysPipelineStage(label, payload = {}) {
  console.log(label, payload);
}
