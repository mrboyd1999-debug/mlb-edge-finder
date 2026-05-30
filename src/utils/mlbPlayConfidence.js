/**
 * MLB play confidence — recent form, projection quality, sample size, matchup quality.
 */

import { resolveBestPlayEdgePercent } from "./bestPlaysPipelineDebug.js";
import { computeFormConfidenceScore } from "./matchupEnrichment.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreRecentForm(prop = {}, projection = null) {
  return computeFormConfidenceScore(prop, projection);
}

function scoreProjectionQuality(prop = {}, projection = null) {
  const edgePct = resolveBestPlayEdgePercent({ ...prop, projection });
  const source = String(prop.projectionSource || "").toLowerCase();
  let score = 45 + Math.min(30, edgePct * 120);
  if (/mlb-verified|sportsdataio|merged/.test(source)) score += 6;
  if (/missing|fallback|estimate/.test(source)) score -= 12;
  if (prop.isFallbackProjection || prop.projectionUnavailable) score -= 15;
  return clamp(Math.round(score), 30, 88);
}

function scoreSampleSize(prop = {}) {
  const sample = finite(prop.sampleSize ?? prop.games ?? prop.gamesPlayed) ?? 0;
  if (sample >= 20) return 85;
  if (sample >= 12) return 72;
  if (sample >= 8) return 62;
  if (sample >= 5) return 54;
  if (sample >= 3) return 48;
  return 42;
}

function scoreMatchupQuality(prop = {}) {
  if (prop.matchupConfidence === "HIGH") return 82;
  if (prop.matchupConfidence === "MEDIUM") return 68;
  if (prop.matchupConfidence === "FORM") {
    return finite(prop.matchupScore ?? prop.formConfidenceScore) ?? 68;
  }
  if (prop.matchupConfidence === "LOW") return 52;
  if (prop.matchupNote || prop.handednessMatchup || prop.opponent) return 75;
  return 50;
}

function scoreSourceReliability(prop = {}) {
  if (prop.isFallbackProjection || prop.projectionUnavailable || prop.unverifiedGradeBlocked) return 42;
  const source = String(prop.projectionSource || prop.source || prop.platform || "").toLowerCase();
  if (/sportsdataio|mlb-verified|merged/.test(source)) return 80;
  if (/prizepicks|underdog/.test(source)) return 74;
  if (/missing|fallback|estimate/.test(source)) return 46;
  if (prop.isVerifiedProjection || prop.hasVerifiedStats) return 72;
  return 58;
}

function scoreLineEdge(prop = {}, projection = null) {
  const edgePct = resolveBestPlayEdgePercent({ ...prop, projection });
  return clamp(Math.round(45 + Math.min(38, Math.abs(edgePct) * 140)), 35, 90);
}

function hasRecentFormData(prop = {}) {
  return (
    finite(prop.last5HitRate) != null ||
    finite(prop.last10HitRate ?? prop.recentHitRate) != null ||
    finite(prop.last5Average ?? prop.recentForm) != null ||
    finite(prop.last10Average) != null
  );
}

/** Weighted confidence aligned with projection edge and form. */
export function computeMlbPlayConfidence(prop = {}, projection = null) {
  const projectionQuality = scoreProjectionQuality(prop, projection);
  const sourceReliability = scoreSourceReliability(prop);
  const lineEdge = scoreLineEdge(prop, projection);
  const recentForm = scoreRecentForm(prop, projection);
  const sampleSize = scoreSampleSize(prop);
  const matchupQuality = scoreMatchupQuality(prop);

  let score;
  if (hasRecentFormData(prop)) {
    score =
      projectionQuality * 0.3 +
      lineEdge * 0.28 +
      sourceReliability * 0.18 +
      recentForm * 0.12 +
      sampleSize * 0.07 +
      matchupQuality * 0.05;
  } else {
    score =
      projectionQuality * 0.38 +
      lineEdge * 0.32 +
      sourceReliability * 0.22 +
      sampleSize * 0.04 +
      matchupQuality * 0.04;
  }

  return clamp(Math.round(score), 35, 90);
}
