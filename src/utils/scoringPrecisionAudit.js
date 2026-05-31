/**
 * Scoring precision audit — expose raw formula outputs and detect clone buckets.
 */

import { enrichBestPlayRankingFields } from "./bestPlayRanking.js";
import {
  resolveBestPlayStatSpecificProjection,
  resolveBestPlayProjection,
} from "./bestPlaysPipelineDebug.js";
import { computeCalibratedProbability } from "./probabilityCalibration.js";
import { computeMlbConfidenceBreakdown } from "./mlbPlayConfidence.js";
import { computePlayabilityBreakdown, NEUTRAL_PLAYABILITY_COMPONENT } from "./playabilityScoring.js";
import {
  computeStandardEdge,
  computeRelativeEdgePercent,
  computeStandardPropMetrics,
} from "./standardPropMetrics.js";
import { computeTopPickScore, compareVerifiedPlaysRank } from "./bestPlayRankingScore.js";
import { passesTopVerifiedPlaysGate, passesVerifiedTierFilter } from "./verifiedTierSystem.js";
import {
  buildMlbProjectionFormulaAudit,
  PROJECTION_FORMULA_ERROR,
  summarizeProjectionFormulaErrors,
} from "./mlbProjectionFormulaAudit.js";

const CLONE_SUSPECT_VALUES = [50, 61, 74, 75, 88];

function round2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

function round4(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 10000) / 10000;
}

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveSportsDataProjection(prop = {}) {
  const direct =
    prop.sportsDataProjection ??
    prop.sportsDataProjectedValue ??
    prop.statSpecificProjection ??
    prop.mergedProjection;
  if (finite(direct) != null) return finite(direct);
  const source = String(prop.projectionSource || "").toLowerCase();
  if (/sportsdataio|mlb-verified|merged/.test(source)) {
    return finite(prop.projection ?? prop.projectedValue);
  }
  return null;
}

function resolveMarketAverage(prop = {}) {
  return finite(
    prop.sportsbookLine ??
      prop.sportsbookComparison?.marketAverageLine ??
      prop.lineComparison?.marketAverageLine
  );
}

export function buildVerifiedPlayScoringAuditRow(prop = {}, rank = null) {
  const enriched = prop?.playabilityBreakdown ? prop : enrichBestPlayRankingFields(prop);
  const projection =
    resolveBestPlayStatSpecificProjection(enriched) ??
    finite(enriched.projection ?? enriched.projectedValue);
  const rawProjection = finite(enriched.projection ?? enriched.projectedValue);
  const line = finite(enriched.line);
  const metrics =
    projection != null && line != null
      ? computeStandardPropMetrics({ projection, line, edge: enriched.edge, edgePercent: enriched.edgePercent })
      : {
          edge: finite(enriched.edge),
          edgePercent: finite(enriched.edgePercent),
        };

  if (metrics.edge == null && projection != null && line != null) {
    metrics.edge = computeStandardEdge(projection, line);
    metrics.edgePercent = computeRelativeEdgePercent(metrics.edge, line);
  }

  const calibration = computeCalibratedProbability(enriched, metrics, { verified: true });
  const confidenceBreakdown = computeMlbConfidenceBreakdown(enriched, projection);
  const playabilityBreakdown =
    enriched.playabilityBreakdown ??
    computePlayabilityBreakdown(enriched, {
      metrics: { ...metrics, projection, probabilityScore: enriched.probabilityScore },
      confidence: enriched.displayConfidenceScore ?? enriched.confidenceScore,
      probability: enriched.probabilityScore ?? calibration?.probability,
      sanityAudit: enriched.projectionSanityAudit,
    });

  const probabilityRaw =
    finite(enriched.probabilityScore ?? enriched.verifiedProbability) ?? calibration?.probability;
  const confidenceRaw =
    finite(enriched.displayConfidenceScore ?? enriched.confidenceScore ?? enriched.confidence) ??
    confidenceBreakdown.final;
  const playabilityRaw =
    playabilityBreakdown.weightedRaw ??
    playabilityBreakdown.finalPlayability ??
    finite(enriched.playabilityScore);

  const formulaAudit =
    enriched.projectionFormulaAudit ?? buildMlbProjectionFormulaAudit(enriched);

  return {
    rank,
    player: String(enriched.playerName || enriched.player || "Unknown").trim() || "Unknown",
    market: String(enriched.statType || enriched.market || enriched.propType || "N/A").trim() || "N/A",
    rawProjection: round4(rawProjection),
    sportsDataProjection: round4(resolveSportsDataProjection(enriched)),
    marketAverage: round4(resolveMarketAverage(enriched)),
    line: round4(line),
    edge: round4(metrics.edge),
    edgePercent: round4(metrics.edgePercent),
    probability: round4(probabilityRaw),
    confidence: round4(confidenceRaw),
    playability: round4(playabilityRaw),
    probabilityDisplay: Math.round(probabilityRaw ?? 0),
    confidenceDisplay: Math.round(confidenceRaw ?? 0),
    playabilityDisplay: Math.round(playabilityRaw ?? 0),
    probabilityFormulaOutput: round4(calibration?.probability),
    confidenceFormulaOutput: round4(confidenceBreakdown.rawScore ?? confidenceBreakdown.final),
    playabilityFormulaOutput: round4(playabilityBreakdown.weightedRaw ?? playabilityBreakdown.finalPlayability),
    compositeScore: round4(computeTopPickScore(enriched)),
    probabilityBreakdown: calibration?.breakdown || null,
    confidenceBreakdown,
    playabilityBreakdown,
    projectionSource: enriched.projectionSource || enriched.source || "—",
    usesNeutralHistoricalFallback: Boolean(enriched.usesNeutralHistoricalFallback),
    historicalComponent: playabilityBreakdown.historicalComponent,
    trendComponent: playabilityBreakdown.trendComponent,
    projectionComponent: playabilityBreakdown.projectionComponent,
    penaltyComponent: playabilityBreakdown.penaltyComponent,
    verifiedTier: enriched.verifiedTier || "—",
    projectionFormulaUsed: formulaAudit.projectionFormulaUsed,
    rawSportsDataFields: formulaAudit.rawSportsDataFields,
    gamesCount: formulaAudit.gamesCount,
    sampleSize: formulaAudit.sampleSize,
    projectionComponentsLabel: formulaAudit.projectionComponentsLabel,
    projectionFormulaValid: formulaAudit.projectionFormulaValid,
    projectionFormulaError: formulaAudit.projectionFormulaError,
    projectionFormulaErrorReason: formulaAudit.projectionFormulaErrorReason,
  };
}

export function buildTopVerifiedScoringAuditRows(projectedPool = [], limit = 20) {
  return [...(projectedPool || [])]
    .map((prop) => enrichBestPlayRankingFields(prop))
    .filter((prop) => passesVerifiedTierFilter(prop) && passesTopVerifiedPlaysGate(prop))
    .sort(compareVerifiedPlaysRank)
    .slice(0, limit)
    .map((prop, index) => buildVerifiedPlayScoringAuditRow(prop, index + 1))
    .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function buildProjectionFormulaAuditRows(projectedPool = [], limit = 20) {
  return [...(projectedPool || [])]
    .map((prop) => enrichBestPlayRankingFields(prop))
    .map((prop) => buildVerifiedPlayScoringAuditRow(prop))
    .filter((row) => row.projection != null || row.rawProjection != null)
    .sort((a, b) => {
      if (a.projectionFormulaValid !== b.projectionFormulaValid) {
        return a.projectionFormulaValid ? 1 : -1;
      }
      return (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
    })
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export { PROJECTION_FORMULA_ERROR, summarizeProjectionFormulaErrors } from "./mlbProjectionFormulaAudit.js";

export function detectScoreClonePatterns(rows = []) {
  const probabilityCounts = {};
  const confidenceCounts = {};
  const playabilityCounts = {};
  const compositeCounts = {};
  const suspects = [];

  for (const row of rows || []) {
    const probKey = String(row.probabilityDisplay ?? Math.round(row.probability ?? 0));
    const confKey = String(row.confidenceDisplay ?? Math.round(row.confidence ?? 0));
    const playKey = String(row.playabilityDisplay ?? Math.round(row.playability ?? 0));
    const compositeKey = String(round2(row.compositeScore));

    probabilityCounts[probKey] = (probabilityCounts[probKey] || 0) + 1;
    confidenceCounts[confKey] = (confidenceCounts[confKey] || 0) + 1;
    playabilityCounts[playKey] = (playabilityCounts[playKey] || 0) + 1;
    compositeCounts[compositeKey] = (compositeCounts[compositeKey] || 0) + 1;
  }

  for (const value of CLONE_SUSPECT_VALUES) {
    const key = String(value);
    if ((probabilityCounts[key] || 0) >= 3) {
      suspects.push({ field: "probability", value, count: probabilityCounts[key] });
    }
    if ((confidenceCounts[key] || 0) >= 3) {
      suspects.push({ field: "confidence", value, count: confidenceCounts[key] });
    }
    if ((playabilityCounts[key] || 0) >= 3) {
      suspects.push({ field: "playability", value, count: playabilityCounts[key] });
    }
  }

  const identicalTriplets = (rows || []).filter((row) => {
    const matches = (rows || []).filter(
      (other) =>
        round2(other.probability) === round2(row.probability) &&
        round2(other.confidence) === round2(row.confidence) &&
        round2(other.playability) === round2(row.playability)
    );
    return matches.length >= 3;
  }).length;

  return {
    suspects,
    identicalScoreGroups: identicalTriplets,
    probabilityCounts,
    confidenceCounts,
    playabilityCounts,
    compositeCounts,
    neutralHistoricalComponentCount: (rows || []).filter(
      (row) => row.historicalComponent === NEUTRAL_PLAYABILITY_COMPONENT
    ).length,
  };
}
