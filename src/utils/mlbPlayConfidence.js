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
  if (prop.matchupConfidence === "LOW") return 52;
  if (prop.matchupNote || prop.handednessMatchup || prop.opponent) return 75;
  return 50;
}

/** Weighted confidence aligned with projection edge and form. */
export function computeMlbPlayConfidence(prop = {}, projection = null) {
  const recentForm = scoreRecentForm(prop, projection);
  const projectionQuality = scoreProjectionQuality(prop, projection);
  const sampleSize = scoreSampleSize(prop);
  const matchupQuality = scoreMatchupQuality(prop);

  const score = Math.round(
    recentForm * 0.3 + projectionQuality * 0.3 + sampleSize * 0.2 + matchupQuality * 0.2
  );

  return clamp(score, 35, 90);
}
