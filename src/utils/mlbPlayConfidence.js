/**
 * MLB play confidence — weighted components with capped data penalties and display floor.
 */

import { resolveBestPlayEdgePercent } from "./bestPlaysPipelineDebug.js";
import { computeFormConfidenceScore } from "./matchupEnrichment.js";

export const CONFIDENCE_WEIGHTS = {
  projectionQuality: 0.3,
  recentForm: 0.25,
  edgeScore: 0.2,
  hitRate: 0.15,
  matchup: 0.1,
};

export const CONFIDENCE_PENALTY_CAPS = {
  missingPitcher: 5,
  missingSeason: 3,
  partialMatchup: 5,
};

export const CONFIDENCE_FLOOR_MIN = 65;
export const CONFIDENCE_MIN = 45;
export const CONFIDENCE_MAX = 92;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function scoreRecentForm(prop = {}, projection = null) {
  return computeFormConfidenceScore(prop, projection);
}

function scoreProjectionQuality(prop = {}, projection = null) {
  const edgePct = resolveBestPlayEdgePercent({ ...prop, projection });
  const source = String(prop.projectionSource || "").toLowerCase();
  let score = 52 + Math.min(32, Math.abs(edgePct) * 110);
  if (/mlb-verified|sportsdataio|merged/.test(source)) score += 8;
  if (/missing|fallback|estimate/.test(source)) score -= 8;
  if (prop.isFallbackProjection || prop.projectionUnavailable) score -= 10;
  const line = finite(prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  if (proj != null && line != null && line > 0) {
    score += Math.min(10, (Math.abs(proj - line) / line) * 22);
  }
  return round2(clamp(score, 40, 92));
}

function scoreMatchupQuality(prop = {}) {
  const matchupScore = finite(prop.matchupScore ?? prop.formConfidenceScore ?? prop.matchupAudit?.matchupScore);
  if (matchupScore != null) return round2(clamp(matchupScore, 40, 92));

  if (prop.matchupConfidence === "HIGH") return 84;
  if (prop.matchupConfidence === "MEDIUM") return 72;
  if (prop.matchupConfidence === "FORM") return round2(clamp(matchupScore ?? 68, 45, 80));
  if (prop.matchupConfidence === "LOW") return 55;

  const rank = finite(prop.opponentRank);
  if (rank != null) return round2(clamp(80 - rank * 0.5, 45, 88));

  if (prop.matchupNote || prop.handednessMatchup) return 66;
  if (String(prop.opponent || "").trim()) return 60;
  return 52;
}

function scoreLineEdge(prop = {}, projection = null) {
  const edgePct = resolveBestPlayEdgePercent({ ...prop, projection });
  const line = finite(prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  let score = 50 + Math.min(40, Math.abs(edgePct) * 130);
  if (proj != null && line != null && line > 0) {
    score += Math.min(8, (Math.abs(proj - line) / line) * 14);
  }
  return round2(clamp(score, 40, 92));
}

function resolveHistoricalHitRateScore(prop = {}) {
  const toPct = (value) => {
    const num = finite(value);
    if (num == null) return null;
    return num <= 1 ? num * 100 : num;
  };
  const l5 = toPct(prop.last5HitRate);
  const l10 = toPct(prop.last10HitRate ?? prop.recentHitRate);
  const season = toPct(prop.seasonHitRate);
  if (l5 != null && l10 != null && season != null) return round2(l5 * 0.25 + l10 * 0.45 + season * 0.3);
  if (l5 != null && l10 != null) return round2(l5 * 0.4 + l10 * 0.6);
  return l10 ?? l5 ?? season ?? 55;
}

function isMissingPitcherData(prop = {}) {
  const integrity = prop.integrityAudit || {};
  if (integrity.pitcherIntegrity === 0) return true;
  const pitcher = String(prop.opposingPitcher || prop.matchupAudit?.pitcher || prop.opponentStarterNote || "").trim();
  return (
    !pitcher ||
    pitcher === "—" ||
    /pitcher pending|starter pending/i.test(pitcher)
  );
}

function isMissingSeasonData(prop = {}) {
  if (prop.seasonRateValid) return false;
  const seasonLabel = prop.hitRateSnapshot?.seasonLabel ?? prop.seasonHitRate;
  if (seasonLabel == null || seasonLabel === "" || seasonLabel === "—" || seasonLabel === "0%") return true;
  return finite(prop.seasonHitRate) == null && finite(prop.seasonGamesPlayed ?? prop.seasonGames) == null;
}

function isPartialMatchupData(prop = {}) {
  if (prop.matchupAudit?.complete) return false;
  if (prop.matchupConfidence === "HIGH" || prop.matchupConfidence === "MEDIUM") return false;
  if (prop.matchupNote || prop.handednessMatchup) return false;
  return (
    prop.matchupConfidence === "LOW" ||
    prop.matchupConfidence === "FORM" ||
    !String(prop.opponent || "").trim()
  );
}

export function isProjectionIntegrityVerified(prop = {}) {
  const sanity = prop.projectionSanityAudit || {};
  if (sanity.sanityFail) return false;
  const projectionIntegrity = finite(prop.integrityAudit?.projectionIntegrity);
  if (projectionIntegrity != null) return projectionIntegrity >= 80;
  return (sanity.sanityScore ?? 0) >= 70 && !sanity.projectionMismatch;
}

export function resolveConfidencePenalties(prop = {}) {
  const penalties = [];
  if (isMissingPitcherData(prop)) {
    penalties.push({ key: "missingPitcher", label: "Missing pitcher", amount: CONFIDENCE_PENALTY_CAPS.missingPitcher });
  }
  if (isMissingSeasonData(prop)) {
    penalties.push({ key: "missingSeason", label: "Missing season rate", amount: CONFIDENCE_PENALTY_CAPS.missingSeason });
  }
  if (isPartialMatchupData(prop)) {
    penalties.push({ key: "partialMatchup", label: "Partial matchup", amount: CONFIDENCE_PENALTY_CAPS.partialMatchup });
  }
  const penaltyTotal = penalties.reduce((sum, row) => sum + row.amount, 0);
  return { penalties, penaltyTotal: round1(penaltyTotal) };
}

export function applyConfidenceDisplayFloor(prop = {}, projection = null, confidence = null, playability = null) {
  const score = finite(confidence);
  if (score == null) return confidence;
  const line = finite(prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  const play = finite(playability ?? prop.playabilityScore ?? prop.playabilityBreakdown?.finalPlayability);
  if (proj == null || line == null || line <= 0 || play == null) return Math.round(score);
  const gapPct = (proj - line) / line;
  if (gapPct < 0.2 || play <= 80 || !isProjectionIntegrityVerified(prop)) {
    return Math.round(score);
  }
  return Math.round(Math.max(score, CONFIDENCE_FLOOR_MIN));
}

/** Weighted confidence with capped penalties and strong-edge floor. */
export function computeMlbConfidenceBreakdown(prop = {}, projection = null) {
  const projectionQuality = scoreProjectionQuality(prop, projection);
  const recentForm = scoreRecentForm(prop, projection);
  const edgeScore = scoreLineEdge(prop, projection);
  const hitRate = resolveHistoricalHitRateScore(prop);
  const matchupQuality = scoreMatchupQuality(prop);

  const weightedBase = round2(
    projectionQuality * CONFIDENCE_WEIGHTS.projectionQuality +
      recentForm * CONFIDENCE_WEIGHTS.recentForm +
      edgeScore * CONFIDENCE_WEIGHTS.edgeScore +
      hitRate * CONFIDENCE_WEIGHTS.hitRate +
      matchupQuality * CONFIDENCE_WEIGHTS.matchup
  );

  const { penalties, penaltyTotal } = resolveConfidencePenalties(prop);
  const afterPenalties = round2(clamp(weightedBase - penaltyTotal, CONFIDENCE_MIN, CONFIDENCE_MAX));
  const withFloor = applyConfidenceDisplayFloor(prop, projection, afterPenalties, prop.playabilityScore);
  const floorApplied = withFloor > afterPenalties;

  return {
    projectionQuality,
    recentForm,
    edgeScore,
    hitRate,
    matchupQuality,
    components: {
      projectionQuality,
      recentForm,
      edgeScore,
      hitRate,
      matchup: matchupQuality,
    },
    weights: CONFIDENCE_WEIGHTS,
    weightedBase,
    penalties,
    penaltyTotal,
    rawScore: weightedBase,
    afterPenalties,
    floorApplied,
    final: withFloor,
    // legacy aliases
    historicalHitRate: hitRate,
    projectionQualityScore: projectionQuality,
    matchupQuality,
    lineEdge: edgeScore,
    sourceReliability: projectionQuality,
  };
}

export function computeMlbPlayConfidence(prop = {}, projection = null) {
  return computeMlbConfidenceBreakdown(prop, projection).final;
}
