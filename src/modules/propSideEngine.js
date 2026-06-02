import {
  AWAITING_VERIFIED_MLB_DATA,
  DATA_STATUS,
  EDGE_CALCULATION_UNAVAILABLE,
  EDGE_FORMULA_DISABLED,
  isFallbackDataStatus,
  PROJECTION_SOURCE_MISSING,
} from "./projectionBreakdown.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

export const EDGE_NEUTRAL_THRESHOLD = 0.05;
export const MIN_PLAY_EDGE = 0.35;
export const MIN_PLAY_CONFIDENCE = 58;
export const INSUFFICIENT_DATA_LABEL = "Insufficient verified data";
export const NO_VERIFIED_PLAY_STATUS = "NO VERIFIED PLAY";
export const AWAITING_PROJECTION_STATUS = "Awaiting projection data";
export const PASS_STATUS = "PASS";
export const NO_VERIFIED_GRADE_MESSAGE = "No verified projection available — do not grade this prop.";

/** True when a numeric projection exists and is positive. */
export function hasValidProjection(prop = {}) {
  if (prop.projectionUnavailable) return false;
  const projection = prop.projectedValue ?? prop.projection;
  if (projection == null || projection === undefined) return false;
  const numeric = Number(projection);
  return Number.isFinite(numeric) && numeric > 0;
}

export function hasSportsbookLine(prop = {}) {
  const line = Number(prop.line);
  return Number.isFinite(line) && line > 0;
}

/** Edge is only valid when projection, line, and player match are all verified. */
export function canCalculateVerifiedEdge(prop = {}) {
  if (!hasValidProjection(prop)) return false;
  if (!hasSportsbookLine(prop)) return false;
  if (prop.isFallbackProjection || prop.projectionSource === "missing" || prop.projectionSource === "manual-fallback") {
    return false;
  }
  if (prop.projectionUnavailable || prop.unverifiedGradeBlocked) return false;
  if (prop.isManualAnalyzer || prop.manualAnalyzer) {
    return Boolean(prop.isVerifiedProjection && prop.playerMatchVerified !== false);
  }
  return Boolean(prop.isVerifiedProjection || prop.hasVerifiedStats);
}

export function hasCalculatedEdge(prop = {}) {
  if (!canCalculateVerifiedEdge(prop)) return false;
  const edge = Number(prop.edge);
  return Number.isFinite(edge) && edge > 0;
}

/** Gate for curated boards and recommendations. */
export function isVerifiedRecommendableProp(prop = {}) {
  if (!hasValidProjection(prop)) return false;
  if (!hasSportsbookLine(prop)) return false;
  if (!hasCalculatedEdge(prop)) return false;
  if (prop.isFallbackProjection) return false;
  if (prop.projectionUnavailable || prop.noEdge) return false;

  if (prop.isManualAnalyzer || prop.manualAnalyzer) {
    return Boolean(prop.isVerifiedProjection);
  }

  if (prop.isVerifiedProjection || prop.hasVerifiedStats || prop.manualEnriched) return true;
  if (prop.projectionSource === "player-stats-model") return true;
  return false;
}

export function propRequiresVerifiedPlayStatus(prop = {}) {
  if (prop.isManualAnalyzer || prop.manualAnalyzer) {
    return !hasValidProjection(prop) || prop.projectionUnavailable;
  }
  return !isVerifiedRecommendableProp(prop);
}

export function normalizePropSide(side = "") {
  const key = String(side || "").toLowerCase();
  if (key === "over" || key === "more" || key === "higher") return "over";
  if (key === "under" || key === "less" || key === "lower") return "under";
  return "";
}

/** Raw model edge: projection minus line (positive favors OVER). */
export function computeRawEdge(projection, line) {
  const proj = Number(projection);
  const numericLine = Number(line);
  if (!Number.isFinite(proj) || !Number.isFinite(numericLine)) return null;
  return round(proj - numericLine, 2);
}

/** Recommended side from projection vs line only. */
export function resolveRecommendedSide(projection, line) {
  const raw = computeRawEdge(projection, line);
  if (raw == null) return null;
  if (Math.abs(raw) < EDGE_NEUTRAL_THRESHOLD) return null;
  return raw > 0 ? "over" : "under";
}

/** Directional edge for a given side (positive = side supported). */
export function computeDirectionalEdgeForSide(projection, line, side) {
  const raw = computeRawEdge(projection, line);
  if (raw == null) return 0;
  const normalized = normalizePropSide(side);
  if (normalized === "over") return raw;
  if (normalized === "under") return round(-raw, 2);
  return 0;
}

export function validateSideAgainstProjection(side, projection, line) {
  const recommended = resolveRecommendedSide(projection, line);
  const normalized = normalizePropSide(side);
  if (!recommended) {
    return { ok: false, recommended: null, reason: "No edge — projection equals line", aligned: false };
  }
  if (!normalized) {
    return { ok: false, recommended, reason: "Missing pick side", aligned: false };
  }
  const aligned = normalized === recommended;
  return {
    ok: aligned,
    recommended,
    aligned,
    reason: aligned
      ? `${normalized.toUpperCase()} supported by projection`
      : `Projection supports ${recommended.toUpperCase()}, not ${normalized.toUpperCase()}`,
  };
}

export function sideConsistencyCheck(prop = {}) {
  const side = normalizePropSide(prop.bestPick || prop.side || prop.pick);
  const projection = Number(prop.projectedValue ?? prop.projection);
  const line = Number(prop.line);
  if (!side || !Number.isFinite(projection) || !Number.isFinite(line)) return false;
  if (side === "over") return projection > line + EDGE_NEUTRAL_THRESHOLD;
  if (side === "under") return projection < line - EDGE_NEUTRAL_THRESHOLD;
  return false;
}

export function confidenceFromEdge(absEdge, {
  volatility = { tier: "MEDIUM", score: 0.5 },
  payoutType = "standard",
  marketKey = "",
  isVerified = true,
  consistencyScore = null,
  matchupQuality = null,
  lineMovementFavorable = null,
} = {}) {
  if (!isVerified || !Number.isFinite(absEdge)) return 0;

  let score = 44 + absEdge * 9;
  if (absEdge >= 1.5) score += 5;
  else if (absEdge >= 1.0) score += 3;
  else if (absEdge >= 0.7) score += 2;
  else if (absEdge >= 0.4) score += 1;
  else if (absEdge < 0.2) score -= 8;

  if (volatility?.tier === "LOW") score += 3;
  else if (volatility?.tier === "HIGH") score -= 10;

  if (Number.isFinite(consistencyScore)) {
    if (consistencyScore >= 0.85) score += 2;
    else if (consistencyScore <= 0.5) score -= 6;
  }

  if (matchupQuality === "strong") score += 2;
  else if (matchupQuality === "weak") score -= 4;

  if (lineMovementFavorable === true) score += 1;
  else if (lineMovementFavorable === false) score -= 4;

  const payout = String(payoutType || "standard").toLowerCase();
  if (payout === "goblin") {
    score += 2;
    return Math.round(clamp(score, 58, 68));
  }
  if (payout === "demon") {
    score -= 5;
    return Math.round(clamp(score, 45, 58));
  }
  if (marketKey === "strikeouts" && absEdge >= 0.7) score += 1;
  return Math.round(clamp(score, 50, 65));
}

export function shouldPassPlay({ edge, confidence, isVerified = true }) {
  if (!isVerified) return true;
  if (!Number.isFinite(Number(edge)) || Number(edge) < MIN_PLAY_EDGE) return true;
  if (!Number.isFinite(Number(confidence)) || Number(confidence) < MIN_PLAY_CONFIDENCE) return true;
  return false;
}

export function hitChanceFromVerifiedEdge({
  absEdge,
  rawEdge,
  volatility = { tier: "MEDIUM" },
  confidence = 0,
  payoutType = "standard",
} = {}) {
  if (!Number.isFinite(absEdge) || !Number.isFinite(rawEdge)) return null;
  if (absEdge < EDGE_NEUTRAL_THRESHOLD) return null;

  let pct = 50 + absEdge * 7 + (Number(confidence) - 50) * 0.22;
  if (volatility?.tier === "LOW") pct += 4;
  else if (volatility?.tier === "HIGH") pct -= 7;

  const payout = String(payoutType || "standard").toLowerCase();
  if (payout === "goblin") pct += 3;
  if (payout === "demon") pct -= 6;

  return Math.round(clamp(pct, 42, 82));
}

export function meetsPlayQualityThresholds({
  projection,
  line,
  side,
  edge,
  confidence,
  isVerified = false,
  projectionUnavailable = false,
}) {
  if (projectionUnavailable || !isVerified) return false;
  if (!Number.isFinite(projection) || !Number.isFinite(line)) return false;
  if (!normalizePropSide(side)) return false;
  if (!sideConsistencyCheck({ bestPick: side, projectedValue: projection, line })) return false;
  if (Number(edge) < MIN_PLAY_EDGE) return false;
  if (Number(confidence) < MIN_PLAY_CONFIDENCE) return false;
  return true;
}

export function buildSideEngineDebug({
  projection,
  line,
  side,
  projectionSource,
  dataStatus,
  rawEdge,
  recommendedSide,
  aligned,
  volatility,
  recentAverage,
  matchupNote,
  sportsbookLine,
  projectionUnavailable = false,
} = {}) {
  const unavailable =
    projectionUnavailable ||
    !Number.isFinite(Number(projection)) ||
    isFallbackDataStatus(dataStatus) ||
    projectionSource === "missing";

  if (unavailable) {
    return {
      projectionUnavailable: true,
      projectionSource: PROJECTION_SOURCE_MISSING,
      dataStatus: AWAITING_VERIFIED_MLB_DATA,
      edgeFormula: EDGE_FORMULA_DISABLED,
      edgeCalculation: EDGE_CALCULATION_UNAVAILABLE,
      rawEdge: null,
      recommendedSide: null,
      userSide: normalizePropSide(side),
      sideAligned: null,
      projection: null,
      line,
      sportsbookLine: sportsbookLine ?? line,
      recentAverage: null,
      matchupNote: null,
      volatilityTier: null,
    };
  }

  return {
    projectionUnavailable: false,
    projectionSource: projectionSource || "player-stats-model",
    dataStatus: dataStatus || DATA_STATUS.VERIFIED,
    edgeFormula: "rawEdge = projection - line; over edge = rawEdge, under edge = -rawEdge",
    edgeCalculation: null,
    rawEdge,
    recommendedSide,
    userSide: normalizePropSide(side),
    sideAligned: aligned,
    projection,
    line,
    sportsbookLine: sportsbookLine ?? line,
    recentAverage,
    matchupNote: matchupNote || null,
    volatilityTier: volatility?.tier || null,
  };
}
