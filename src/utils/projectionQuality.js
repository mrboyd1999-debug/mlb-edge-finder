/**
 * Projection quality gates — ranked sections require verified or estimated projections.
 */

import { resolvePropSportLabel } from "./underdogSportDetection.js";
import { lockSportFromStatType, sportStatMismatchReason } from "./propStatSportLock.js";

function isMalformedPlayerName(name = "") {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed.length < 2) return true;
  if (!/[a-zA-Z]/.test(trimmed)) return true;
  return /^unknown\s+player$/i.test(trimmed);
}

function goblinVarianceTooHigh(prop = {}) {
  const stat = String(prop.statType || prop.market || prop.propType || "").toLowerCase();
  if (/home run|\bhr\b|triple|first inning|walks?\s*allowed/.test(stat)) return true;
  const vol = Number(prop.volatility ?? prop.marketVolatility);
  return Number.isFinite(vol) && vol >= 4;
}

export const PROJECTION_QUALITY = {
  VERIFIED: "verified",
  ESTIMATED: "estimated",
  MISSING: "missing",
};

export const PROJECTION_SOURCE_LABEL = {
  SPORTSDATAIO: "SportsDataIO",
  ODDS_API: "Odds API",
  ESTIMATED: "Estimated",
  CACHED: "Cached",
  MISSING: "Missing",
};

const VERIFIED_SOURCES = new Set([
  "sportsdataio",
  "sportsdata",
  "player-stats",
  "player_stats",
  "model",
  "manual-stats",
  "odds-api",
  "oddsapi",
  "the-odds-api",
]);

const ESTIMATED_SOURCES = new Set([
  "estimated",
  "player-stats-estimate",
  "player_stats_estimate",
  "cached",
  "cache",
  "rolling-average",
  "recent-games",
]);

const MISSING_SOURCES = new Set(["missing", "line-neutral", "none", ""]);

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function resolveProjectionValue(prop = {}) {
  const raw = prop.projection ?? prop.projectedValue;
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function normalizeProjectionSourceKey(source = "") {
  return String(source || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

export function resolveProjectionSourceLabel(prop = {}) {
  const key = normalizeProjectionSourceKey(prop.projectionSource);
  if (/sportsdata/.test(key)) return PROJECTION_SOURCE_LABEL.SPORTSDATAIO;
  if (/odds/.test(key)) return PROJECTION_SOURCE_LABEL.ODDS_API;
  if (key === "cached" || key === "cache") return PROJECTION_SOURCE_LABEL.CACHED;
  if (prop.estimatedProjection || ESTIMATED_SOURCES.has(key)) return PROJECTION_SOURCE_LABEL.ESTIMATED;
  if (VERIFIED_SOURCES.has(key)) {
    if (/odds/.test(key)) return PROJECTION_SOURCE_LABEL.ODDS_API;
    if (/sportsdata/.test(key)) return PROJECTION_SOURCE_LABEL.SPORTSDATAIO;
    return PROJECTION_SOURCE_LABEL.ESTIMATED;
  }
  if (MISSING_SOURCES.has(key)) return PROJECTION_SOURCE_LABEL.MISSING;
  if (resolveProjectionValue(prop) != null) return PROJECTION_SOURCE_LABEL.ESTIMATED;
  return PROJECTION_SOURCE_LABEL.MISSING;
}

export function resolveProjectionQuality(prop = {}) {
  const projection = resolveProjectionValue(prop);
  if (projection == null) return PROJECTION_QUALITY.MISSING;

  const key = normalizeProjectionSourceKey(prop.projectionSource);
  if (MISSING_SOURCES.has(key) || key === "line-neutral") return PROJECTION_QUALITY.MISSING;

  if (prop.estimatedProjection || ESTIMATED_SOURCES.has(key)) {
    return PROJECTION_QUALITY.ESTIMATED;
  }

  if (VERIFIED_SOURCES.has(key) || /sportsdata|player-stats|model|odds/.test(key)) {
    return PROJECTION_QUALITY.VERIFIED;
  }

  return PROJECTION_QUALITY.ESTIMATED;
}

export function hasRenderableProjection(prop = {}) {
  const quality = resolveProjectionQuality(prop);
  return quality === PROJECTION_QUALITY.VERIFIED || quality === PROJECTION_QUALITY.ESTIMATED;
}

/** edge = abs(projection - line) */
export function computeAbsoluteProjectionEdge(prop = {}) {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  if (projection == null || !Number.isFinite(line) || line <= 0) return 0;
  return Math.abs(projection - line);
}

export function hasMatchupContext(prop = {}) {
  const matchup = String(prop.matchup || "").trim();
  const team = String(prop.team || "").trim();
  const opponent = String(prop.opponent || "").trim();
  return Boolean(matchup || (team && opponent));
}

function baseSportStatRejectReason(prop = {}) {
  if (!prop) return "Rejected: missing prop";
  if (prop.isDemoData || prop.manualEntry || prop.isFallback || prop.displayFallback) {
    return "Rejected: fallback/non-live prop";
  }
  if (isMalformedPlayerName(prop.playerName || prop.player)) {
    return "Rejected: player missing";
  }
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return "Rejected: line invalid";
  const statType = prop.statType || prop.market || prop.propType || "";
  if (!statType) return "Rejected: missing stat type";

  const sport = resolvePropSportLabel(prop) || prop.inferredSport || prop.sport || prop.league || "";
  const statLock = lockSportFromStatType(statType);
  const effectiveSport = sport && sport !== "Unknown" && sport !== "Unsupported" ? sport : statLock || "";

  if (statLock && effectiveSport && statLock !== effectiveSport) {
    return "Rejected: invalid sport/stat combo";
  }
  if (effectiveSport) {
    const mismatch = sportStatMismatchReason(effectiveSport, statType);
    if (mismatch) return mismatch;
  }
  return "";
}

export function validateProjectionRejectReason(prop = {}) {
  const base = baseSportStatRejectReason(prop);
  if (base) return base;

  const quality = resolveProjectionQuality(prop);
  if (quality === PROJECTION_QUALITY.MISSING) {
    return "Rejected: no projection data available";
  }

  const edge = computeAbsoluteProjectionEdge(prop);
  if (edge <= 0) {
    return "Rejected: zero edge";
  }

  return "";
}

export function isProjectionRankedProp(prop = {}) {
  return !validateProjectionRejectReason(prop);
}

export function validateBestPlayRejectReason(prop = {}) {
  const projectionReject = validateProjectionRejectReason(prop);
  if (projectionReject) return projectionReject;

  if (!hasMatchupContext(prop)) {
    return "Rejected: matchup missing";
  }

  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(conf) || conf < 55) {
    return "Rejected: confidence below Best Plays floor";
  }

  return "";
}

export function isBestPlayEligible(prop = {}) {
  return !validateBestPlayRejectReason(prop);
}

export function validateGoblinRejectReason(prop = {}) {
  const projectionReject = validateProjectionRejectReason(prop);
  if (projectionReject) return projectionReject;

  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(conf) || conf < 58) {
    return "Rejected: confidence below Goblin floor";
  }

  const edge = computeAbsoluteProjectionEdge(prop);
  if (edge <= 0.5) {
    return "Rejected: Goblin edge too small";
  }

  if (goblinVarianceTooHigh(prop)) {
    return "Rejected: variance too high for Goblin";
  }

  return "";
}

export function isGoblinRankEligible(prop = {}) {
  return !validateGoblinRejectReason(prop);
}

export function validateDemonRejectReason(prop = {}) {
  const projectionReject = validateProjectionRejectReason(prop);
  if (projectionReject) return projectionReject;

  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(conf) || conf < 52) {
    return "Rejected: confidence below Demon floor";
  }

  const edge = computeAbsoluteProjectionEdge(prop);
  if (edge <= 1.0) {
    return "Rejected: Demon edge too small";
  }

  return "";
}

export function isDemonRankEligible(prop = {}) {
  return !validateDemonRejectReason(prop);
}

export function validateStreakRejectReason(prop = {}) {
  return validateProjectionRejectReason(prop);
}

export function isStreakRankEligible(prop = {}) {
  return !validateStreakRejectReason(prop);
}

export function isTopMlbPlayCandidate(prop = {}) {
  const base = baseSportStatRejectReason(prop);
  if (base) return false;

  const sport = resolvePropSportLabel(prop) || prop.inferredSport || prop.sport || "";
  const statType = prop.statType || prop.market || prop.propType || "";
  const statLock = lockSportFromStatType(statType);

  if (statLock === "NBA" || statLock === "WNBA" || statLock === "NHL") return false;
  if (sport && !["MLB", ""].includes(sport) && sport !== "Unknown") {
    if (sport !== "MLB") return false;
  }
  if (statLock && statLock !== "MLB") return false;

  return true;
}

export function annotateProjectionFields(prop = {}) {
  const quality = resolveProjectionQuality(prop);
  const projection = resolveProjectionValue(prop);
  const edge = computeAbsoluteProjectionEdge(prop);
  const sourceLabel = resolveProjectionSourceLabel(prop);
  const noProjection = quality === PROJECTION_QUALITY.MISSING;

  return {
    ...prop,
    projection: projection ?? null,
    projectedValue: projection ?? null,
    edge: edge > 0 ? edge : prop.edge ?? 0,
    projectionQuality: quality,
    projectionSourceLabel: sourceLabel,
    projectionLabel:
      quality === PROJECTION_QUALITY.VERIFIED
        ? "Verified Projection"
        : quality === PROJECTION_QUALITY.ESTIMATED
          ? "Estimated Projection"
          : "No projection data available",
    noProjectionData: noProjection,
    hideFromRankedSections: noProjection || edge <= 0,
  };
}
