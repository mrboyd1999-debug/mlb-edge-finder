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

function round1(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 10) / 10;
}

function round2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

function scoreProjectionQuality(prop = {}, projection = null) {
  const edgePct = resolveBestPlayEdgePercent({ ...prop, projection });
  const source = String(prop.projectionSource || "").toLowerCase();
  let score = 45 + Math.min(30, Math.abs(edgePct) * 120);
  if (/mlb-verified|sportsdataio|merged/.test(source)) score += 6;
  if (/missing|fallback|estimate/.test(source)) score -= 12;
  if (prop.isFallbackProjection || prop.projectionUnavailable) score -= 15;
  const line = finite(prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  if (proj != null && line != null && line > 0) {
    score += Math.min(8, (Math.abs(proj - line) / line) * 18);
  }
  return round2(clamp(score, 30, 88));
}

function scoreSampleSize(prop = {}) {
  const sample = finite(prop.sampleSize ?? prop.games ?? prop.gamesPlayed) ?? 0;
  return round2(clamp(40 + Math.min(45, sample * 2.2), 40, 88));
}

function scoreMatchupQuality(prop = {}) {
  const matchupScore = finite(prop.matchupScore ?? prop.formConfidenceScore ?? prop.matchupAudit?.matchupScore);
  if (matchupScore != null) return round2(clamp(matchupScore, 35, 88));

  if (prop.matchupConfidence === "HIGH") return 82;
  if (prop.matchupConfidence === "MEDIUM") return 68;
  if (prop.matchupConfidence === "FORM") return round2(clamp(matchupScore ?? 68, 35, 88));
  if (prop.matchupConfidence === "LOW") return 52;

  const rank = finite(prop.opponentRank);
  if (rank != null) return round2(clamp(78 - rank * 0.55, 38, 85));

  if (prop.matchupNote || prop.handednessMatchup) return 64;
  if (String(prop.opponent || "").trim()) return 58;
  return 50;
}

function scoreSourceReliability(prop = {}, projection = null) {
  if (prop.isFallbackProjection || prop.projectionUnavailable || prop.unverifiedGradeBlocked) return 42;
  const source = String(prop.projectionSource || prop.source || prop.platform || "").toLowerCase();
  let base = 58;
  if (/sportsdataio|mlb-verified|merged/.test(source)) base = 68;
  else if (/prizepicks|underdog/.test(source)) base = 62;
  else if (/missing|fallback|estimate/.test(source)) base = 46;
  else if (prop.isVerifiedProjection || prop.hasVerifiedStats) base = 70;

  const edgePct = resolveBestPlayEdgePercent({ ...prop, projection });
  base += Math.min(14, Math.abs(edgePct) * 35);
  const sample = finite(prop.sampleSize ?? prop.games ?? prop.gamesPlayed) ?? 0;
  base += Math.min(8, sample * 0.35);
  const line = finite(prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  if (proj != null && line != null && line > 0) {
    base += Math.min(8, (Math.abs(proj - line) / line) * 22);
    base += Math.min(2.5, Math.abs(proj) * 0.004);
  }
  return round2(clamp(base, 35, 88));
}

function scoreLineEdge(prop = {}, projection = null) {
  const edgePct = resolveBestPlayEdgePercent({ ...prop, projection });
  const line = finite(prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  let score = 45 + Math.min(38, Math.abs(edgePct) * 140);
  if (proj != null && line != null && line > 0) {
    score += Math.min(6, (Math.abs(proj - line) / line) * 12);
  }
  return round2(clamp(score, 35, 90));
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
export function computeMlbConfidenceBreakdown(prop = {}, projection = null) {
  const projectionQuality = scoreProjectionQuality(prop, projection);
  const sourceReliability = scoreSourceReliability(prop, projection);
  const lineEdge = scoreLineEdge(prop, projection);
  const recentForm = scoreRecentForm(prop, projection);
  const sampleSize = scoreSampleSize(prop);
  const matchupQuality = scoreMatchupQuality(prop);

  let rawScore;
  if (hasRecentFormData(prop)) {
    rawScore =
      projectionQuality * 0.3 +
      lineEdge * 0.28 +
      sourceReliability * 0.18 +
      recentForm * 0.12 +
      sampleSize * 0.07 +
      matchupQuality * 0.05;
  } else {
    rawScore =
      projectionQuality * 0.38 +
      lineEdge * 0.32 +
      sourceReliability * 0.22 +
      sampleSize * 0.04 +
      matchupQuality * 0.04;
  }

  return {
    projectionQuality,
    sourceReliability,
    lineEdge,
    recentForm,
    sampleSize,
    matchupQuality,
    rawScore: round2(rawScore),
    final: round2(clamp(rawScore, 35, 90)),
  };
}

export function computeMlbPlayConfidence(prop = {}, projection = null) {
  return computeMlbConfidenceBreakdown(prop, projection).final;
}
