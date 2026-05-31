/**
 * Best Plays debug helpers — MLB-only, no fabricated projections.
 */

import { resolveProjectionValue } from "./projectionQuality.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { resolveEdgeMagnitude } from "./bestPlayRanking.js";
import {
  computeDisplayPropMetrics,
  isResearchCandidate,
  isLowMatchupProp,
  PICK_TIER_VERIFIED,
  PICK_TIER_RESEARCH,
} from "./conservativeProjection.js";
import { statTypesAlign } from "./propMergeKeys.js";
import {
  passesVerifiedTierFilter,
  passesResearchTierFilter,
  classifyVerifiedTier,
} from "./verifiedTierSystem.js";

export const BEST_PLAYS_DEBUG_MODE = false;
export const BEST_PLAYS_DEBUG_SAMPLE_SIZE = 0;
/** When true, logs projection join samples only — never bypasses verified filters. */
export const PROJECTION_JOIN_DEBUG = import.meta.env?.VITE_PROJECTION_JOIN_DEBUG === "true";

export const VERIFIED_MIN_PROJECTION = 0.01;
/** Temporary stabilization thresholds — restore stricter gates once pipeline is stable. */
export const VERIFIED_MIN_CONFIDENCE = 50;
export const VERIFIED_MIN_PROBABILITY = 45;
export const VERIFIED_MIN_DATA_QUALITY = 50;
export const VERIFIED_MIN_EDGE = 0.02;

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

/** Stat-specific projection only — no last5/season cross-market reuse (Verified Plays / Chris Sale fix). */
export function resolveBestPlayStatSpecificProjection(prop = {}) {
  if (prop.projectionUnavailable || prop.isFallbackProjection || prop.unverifiedGradeBlocked) return null;
  const source = String(prop.projectionSource || "").toLowerCase();
  if (/missing|fallback|estimate|manual-fallback|line-neutral|unavailable|stat-type-mismatch/.test(source)) {
    return null;
  }
  const direct = sanitizeProjectionValue(prop.projection ?? prop.projectedValue);
  if (direct == null) return null;
  const forStat = prop.projectionForStatType;
  if (forStat && prop.statType && !statTypesAlign(prop.statType, forStat)) return null;
  return direct;
}

export function resolveBestPlayProjection(prop = {}) {
  const specific = resolveBestPlayStatSpecificProjection(prop);
  if (specific != null) return specific;
  const direct = sanitizeProjectionValue(prop.projection ?? prop.projectedValue);
  if (direct != null) return direct;
  return sanitizeProjectionValue(resolveProjectionValue(prop));
}

export function resolveBestPlayEdgePercent(prop = {}) {
  const edge = resolveEdgeMagnitude(prop);
  const line = Number(prop.line);
  if (!Number.isFinite(edge) || !Number.isFinite(line) || line <= 0) return 0;
  return Math.abs(edge) / line;
}

export function passesMinimalBestPlaysFilter(prop = {}) {
  const player = resolveBestPlayPlayerName(prop);
  const line = Number(prop.line);
  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  return Boolean(player) && Number.isFinite(line) && line > 0 && Boolean(statType);
}

export function passesResearchBestPlaysFilter(prop = {}) {
  return passesResearchTierFilter(prop);
}

export function classifyBestPlayTier(prop = {}) {
  if (passesVerifiedBestPlaysFilter(prop)) return PICK_TIER_VERIFIED;
  if (passesResearchBestPlaysFilter(prop)) return PICK_TIER_RESEARCH;
  return null;
}

/** Phase 3: tier A/B/C probability + confidence gates — matchup gaps no longer hard-block verified. */
export function passesVerifiedBestPlaysFilter(prop = {}) {
  return passesVerifiedTierFilter(prop);
}

export { classifyVerifiedTier };

export function resolveBestPlayInvalidReason(prop = {}) {
  const player = resolveBestPlayPlayerName(prop);
  if (!player) return "missing player";
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return "missing line";
  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  if (!statType) return "missing stat type";
  if (!String(prop.team || "").trim() && prop.teamConfidence !== "LOW") return "missing team";
  if (resolvePropSport(prop) !== "MLB") return "non-MLB sport";
  const projection = resolveBestPlayProjection(prop);
  if (projection == null || projection <= 0) {
    return prop.projectionMissingReason || prop.sportsDataMatchReason || "missing projection";
  }
  if (isResearchCandidate(prop) && !isLowMatchupProp(prop)) {
    const metrics = computeDisplayPropMetrics({ ...prop, projection });
    return metrics.probabilityScore != null ? "research candidate" : "research candidate";
  }
  if (passesResearchBestPlaysFilter(prop)) return "";
  const confidence = resolveNumericConfidence(prop);
  if (!Number.isFinite(confidence) || confidence < VERIFIED_MIN_CONFIDENCE) return "low confidence";
  const edge = resolveEdgeMagnitude(prop);
  const edgePercent = resolveBestPlayEdgePercent(prop);
  if (edgePercent < VERIFIED_MIN_EDGE) return "weak edge";
  if (prop.projectionUnavailable || prop.unverifiedGradeBlocked || prop.isFallbackProjection) {
    return "invalid projection quality";
  }
  return "";
}

export function logBestPlaysPipelineStage(label, payload = {}) {
  console.log(label, payload);
}
