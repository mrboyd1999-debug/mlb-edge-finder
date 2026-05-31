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

function resolveHistoricalHitRateScore(prop = {}) {
  const toPct = (value) => {
    const num = finite(value);
    if (num == null) return null;
    return num <= 1 ? num * 100 : num;
  };
  const l5 = toPct(prop.last5HitRate);
  const l10 = toPct(prop.last10HitRate ?? prop.recentHitRate);
  if (l5 != null && l10 != null) return round2(l5 * 0.4 + l10 * 0.6);
  return l10 ?? l5 ?? 50;
}

/** Weight: 40% historical hit rate, 30% projection quality, 20% matchup, 10% market edge. */
export function computeMlbConfidenceBreakdown(prop = {}, projection = null) {
  const historicalHitRate = resolveHistoricalHitRateScore(prop);
  const projectionQuality = scoreProjectionQuality(prop, projection);
  const matchupQuality = scoreMatchupQuality(prop);
  const lineEdge = scoreLineEdge(prop, projection);
  const sampleSize = scoreSampleSize(prop);

  let rawScore = round2(
    historicalHitRate * 0.4 +
      projectionQuality * 0.3 +
      matchupQuality * 0.2 +
      lineEdge * 0.1
  );

  const seasonGames = finite(prop.seasonGamesPlayed ?? prop.seasonGames) ?? 0;
  if (seasonGames < 100) {
    rawScore = Math.min(rawScore, historicalHitRate + 20);
  }

  return {
    historicalHitRate,
    projectionQuality,
    matchupQuality,
    lineEdge,
    sampleSize,
    sourceReliability: scoreSourceReliability(prop, projection),
    recentForm: scoreRecentForm(prop, projection),
    rawScore,
    final: round2(clamp(rawScore, 35, 90)),
  };
}

export function computeMlbPlayConfidence(prop = {}, projection = null) {
  return computeMlbConfidenceBreakdown(prop, projection).final;
}
