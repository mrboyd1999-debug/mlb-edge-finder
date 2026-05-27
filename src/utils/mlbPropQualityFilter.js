/**
 * Phase 5 prop quality filters — remove low-signal / duplicate / stale props from ranked boards.
 */

import { resolveProjectionValue, computeAbsoluteProjectionEdge } from "./projectionQuality.js";
import { playerRoleStatMismatchReason } from "./propPlayerRole.js";
import { MIN_MLB_CONFIDENCE } from "./mlbWeightedConfidence.js";
import { buildPropDedupeKey } from "./displayPropScoring.js";
import { PROJECTION_JOIN_DEBUG } from "./bestPlaysPipelineDebug.js";

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function isStaleLine(prop = {}) {
  if (prop.isStale === true || prop.staleLine === true) return true;
  const badge = String(prop.lineSourceBadge || prop.statusLabel || "");
  return /stale|expired|final|live game|in progress/i.test(badge);
}

export function hasInsufficientStats(prop = {}) {
  if (prop.projectionUnavailable || prop.unverifiedGradeBlocked) return true;
  const sample = Number(prop.sampleSize || 0);
  const projection = resolveProjectionValue(prop);
  if (projection == null && sample < 3) return true;
  if (prop.sparseProfile || prop.fallbackProfile) return true;
  return false;
}

export function isBelowMinimumConfidence(prop = {}, floor = MIN_MLB_CONFIDENCE) {
  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (typeof conf === "string") return conf === "Data unavailable";
  return !Number.isFinite(conf) || conf < floor;
}

export function validateMlbPropQualityRejectReason(prop = {}) {
  if (!prop?.playerName && !prop?.player) return "Rejected: missing player";
  if (PROJECTION_JOIN_DEBUG) return "";
  if (isStaleLine(prop)) return "Rejected: stale line";
  if (hasInsufficientStats(prop)) return "Rejected: insufficient stats";
  if (isBelowMinimumConfidence(prop)) return "Rejected: confidence below floor";
  const roleMismatch = playerRoleStatMismatchReason(prop);
  if (roleMismatch) return roleMismatch;
  const edge = computeAbsoluteProjectionEdge(prop);
  if (resolveProjectionValue(prop) != null && edge < 0.12) {
    return "Rejected: projection too close to line";
  }
  return "";
}

export function auditQualityMlbProps(props = []) {
  const counters = {
    filteredMissingProjection: 0,
    filteredLowConfidence: 0,
    filteredWeakEdge: 0,
    filteredOther: 0,
    eligible: 0,
    attempted: (props || []).length,
  };

  for (const prop of props || []) {
    const reason = validateMlbPropQualityRejectReason(prop);
    if (!reason) {
      counters.eligible += 1;
      continue;
    }
    const text = reason.toLowerCase();
    if (/projection|insufficient stats|missing/.test(text)) {
      counters.filteredMissingProjection += 1;
    } else if (/confidence/.test(text)) {
      counters.filteredLowConfidence += 1;
    } else if (/edge|close to line/.test(text)) {
      counters.filteredWeakEdge += 1;
    } else {
      counters.filteredOther += 1;
    }
  }

  return counters;
}

export function filterQualityMlbProps(props = []) {
  const seen = new Set();
  const out = [];
  for (const prop of props || []) {
    const reason = validateMlbPropQualityRejectReason(prop);
    if (reason) continue;
    const key = buildPropDedupeKey(prop);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prop);
  }
  return out;
}
