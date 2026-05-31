/**
 * Best Plays qualification helpers — lean direction, edge magnitude, weighted rank score.
 */

import { resolveProjectionValue, computeAbsoluteProjectionEdge } from "./projectionQuality.js";
import { formatValidatedEdgeDisplay } from "./boardQuality.js";
import { computeStandardEdge, computeStandardEdgePercent } from "./standardPropMetrics.js";
import {
  passesMinimalBestPlaysFilter,
  resolveBestPlayInvalidReason,
  resolveBestPlayStatSpecificProjection,
  classifyBestPlayTier,
  sanitizeProjectionValue,
} from "./bestPlaysPipelineDebug.js";
import { computeMlbPlayConfidence, computeMlbConfidenceBreakdown, applyConfidenceDisplayFloor, qualifiesEliteRecentFormCap } from "./mlbPlayConfidence.js";
import { buildConfidenceAuditLog, buildTierAuditEntry, logPropConfidenceAudit } from "./tierAudit.js";
import { normalizePropPitcherFields } from "./opponentStarter.js";
import { attachBestPlayExplanation } from "./bestPlayExplanation.js";
import { attachModelValidationFields } from "./modelValidation.js";
import {
  applySanityConfidencePenalty,
  applySanityPlayabilityPenalty,
  attachProjectionSanityAudit,
  buildProjectionSanityAudit,
} from "./projectionSanityAudit.js";
import {
  computePlayabilityBreakdown,
} from "./playabilityScoring.js";
import {
  computeTopPickScore,
  annotateTopPickRankingFields,
  annotateBestPlayRankingAudit,
} from "./bestPlayRankingScore.js";
import { buildMlbProjectionFormulaAudit } from "./mlbProjectionFormulaAudit.js";
import { enrichPickDirectionFields, resolveProjectionLeanDisplay } from "./pickDirectionAudit.js";
import { isPitcherStrikeoutMarket } from "./topMlbPlaysRanking.js";
import { isMlbPitcherMarket } from "../modules/mlbPitcherData.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { resolveProjectionConfidenceLevel, classifyPropTier, attachBoardQualityFields, attachFinalTierFields, resolvePropEdge, TIER_A_MIN_CONFIDENCE, TIER_A_MIN_PLAYABILITY, TIER_A_MIN_EDGE } from "./boardQuality.js";
import { applyBoardProbabilityCaps } from "./mlbBoardPipeline.js";
import { attachFinalPlayMetrics, applyPitcherPendingMetricPenalty } from "./tierClassification.js";
import { computeCalibratedProbability } from "./probabilityCalibration.js";
import { isInflatedProbabilityProp } from "./probabilityIntegrity.js";
import { attachMarketProjectionValidation } from "./marketProjectionValidation.js";
import {
  computeDisplayPropMetrics,
  evaluateMlbPlayability,
  isVerifiedPlay,
} from "./conservativeProjection.js";

export const BEST_PLAYS_MIN_EDGE = 0.015;
export const BEST_PLAYS_MIN_GAMES = 5;
export const BEST_PLAYS_VERIFIED_THRESHOLD = 65;

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isHitterMarket(prop = {}) {
  return !isMlbPitcherMarket(prop.statType || prop.market || prop.propType || "");
}

export function resolveGamesPlayed(prop = {}) {
  const explicit = finiteOr(prop.games ?? prop.sampleSize ?? prop.gamesPlayed, NaN);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (prop.hasGameLogs || prop.hasVerifiedStats || prop.isVerifiedProjection) {
    return BEST_PLAYS_MIN_GAMES;
  }
  return 0;
}

/** Percent-based edge score aligned with Best Plays Engine. */
export function computePlayEdgeScore({ projection, line, games } = {}) {
  const proj = finiteOr(projection, NaN);
  const ln = finiteOr(line, NaN);
  const sample = finiteOr(games, 0);
  if (!Number.isFinite(proj) || !Number.isFinite(ln) || ln <= 0) return 0;

  const diff = proj - ln;
  const percentEdge = diff / ln;
  const confidenceWeight = sample > 20 ? 1.2 : sample > 10 ? 1.0 : 0.7;
  const stability = Math.min(sample / 25, 1);
  return round(percentEdge * confidenceWeight * stability, 4);
}

/** @deprecated Use conservative probability from computeDisplayPropMetrics. */
export function computeVerifiedProbability(edgeScore = 0) {
  const magnitude = Math.abs(finiteOr(edgeScore, 0));
  return Math.max(50, Math.min(70, Math.round(50 + magnitude * 40)));
}

export function resolvePlayConfidenceLabel(games = 0) {
  const sample = finiteOr(games, 0);
  if (sample >= 20) return "HIGH";
  if (sample >= 8) return "MED";
  return "LOW";
}

/** OVER/UNDER/PASS from projection vs line — never from platform side. */
export function resolveLeanDirection(prop = {}) {
  const lean = resolveProjectionLeanDisplay(prop);
  if (lean === "Higher") return "OVER";
  if (lean === "Lower") return "UNDER";
  return "PASS";
}

/** Magnitude of projection vs line — always positive for playable leans. */
export function resolveEdgeMagnitude(prop = {}) {
  const absFromLine = computeAbsoluteProjectionEdge(prop);
  if (absFromLine > 0) return absFromLine;
  const edge = finiteOr(prop.edge ?? prop.rawEdge, NaN);
  return Number.isFinite(edge) ? Math.abs(edge) : 0;
}

export function computeRecentFormScore(prop = {}) {
  const line = Number(prop.line);
  const lean = resolveLeanDirection(prop);
  const last5 = finiteOr(prop.last5Average ?? prop.recentForm, NaN);
  const last10 = finiteOr(prop.last10Average, NaN);
  const hitRate = finiteOr(prop.last10HitRate ?? prop.last5HitRate ?? prop.recentHitRate, NaN);

  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0 && lean && lean !== "PASS") {
    const favor = lean === "UNDER" ? line - last5 : last5 - line;
    return Math.max(0, Math.min(100, 50 + favor * 10));
  }
  if (Number.isFinite(last10) && Number.isFinite(line) && line > 0 && lean && lean !== "PASS") {
    const favor = lean === "UNDER" ? line - last10 : last10 - line;
    return Math.max(0, Math.min(100, 50 + favor * 8));
  }
  if (Number.isFinite(hitRate)) return Math.max(0, Math.min(100, hitRate * 100));
  const sample = Number(prop.sampleSize || 0);
  if (sample >= 8) return 62;
  if (sample >= 5) return 55;
  if (sample >= 3) return 48;
  return 40;
}

/** @deprecated Use computeTopPickScore from bestPlayRankingScore.js */
export {
  computeTopPickScore,
  computeVerifiedRankingScore,
  compareVerifiedRankingPlays,
  compareTopPickScore,
  computeWeightedBestPlayScore,
  compareWeightedBestPlays,
  resolveRankingEdgePercent,
  buildTopPickRankingReason,
} from "./bestPlayRankingScore.js";

/** rankScore = (confidence * 0.45) + (abs(edge) * 35) + (recentFormScore * 0.20) */
export function computeBestPlayRankScore(prop = {}) {
  const confidence = finiteOr(prop.verifiedProbability ?? prop.confidenceScore ?? prop.confidence, 0);
  const edgeMag = Math.abs(finiteOr(prop.edgeScore, resolveEdgeMagnitude(prop)));
  const recentFormScore = computeRecentFormScore(prop);
  return confidence * 0.45 + edgeMag * 35 + recentFormScore * 0.2;
}

export function buildMarketContextNote(prop = {}) {
  const parts = [];
  if (isPitcherStrikeoutMarket(prop) || isMlbPitcherMarket(prop.statType || "")) {
    const oppK =
      prop.opponentContext?.strikeoutsPerGame ??
      prop.opponentStrikeoutRate ??
      prop.opponentContext?.note;
    if (oppK != null && oppK !== "") parts.push(typeof oppK === "number" ? `Opp K/G ${oppK}` : String(oppK));
    if (prop.last5Average != null) parts.push(`L5 K ${prop.last5Average}`);
    if (prop.seasonAverage != null) parts.push(`Season ${prop.seasonAverage}`);
    const trend = prop.pitchCountTrend?.label || prop.pitchCountTrend;
    if (trend) parts.push(String(trend));
    if (prop.projectedInnings != null) parts.push(`Proj IP ${prop.projectedInnings}`);
  } else if (isHitterMarket(prop)) {
    if (prop.last10Average != null) parts.push(`L10 avg ${prop.last10Average}`);
    else if (prop.last5Average != null) parts.push(`L5 avg ${prop.last5Average}`);
    if (prop.matchupNote) parts.push(prop.matchupNote);
    if (prop.battingOrder || prop.lineupSlot) parts.push(`Order ${prop.battingOrder || prop.lineupSlot}`);
    if (prop.handednessMatchup) parts.push(prop.handednessMatchup);
  }
  return parts.filter(Boolean).join(" · ");
}

export function enrichBestPlayRankingFields(prop = {}) {
  try {
    return enrichBestPlayRankingFieldsUnsafe(prop);
  } catch (error) {
    console.error("[BestPlays] enrich failed", prop?.playerName || prop?.player, error);
    return {
      ...prop,
      playabilityScore: prop?.playabilityScore ?? 0,
      probabilityScore: prop?.probabilityScore ?? 0,
      verifiedTier: prop?.verifiedTier ?? "C",
      historicalDataPresent: false,
      enrichmentError: error?.message || "Enrichment failed",
    };
  }
}

function enrichBestPlayRankingFieldsUnsafe(prop = {}) {
  prop = normalizePropPitcherFields(prop);
  const rawProjection = resolveBestPlayStatSpecificProjection(prop);
  const validatedProp = attachMarketProjectionValidation(
    { ...prop, projection: rawProjection, projectedValue: rawProjection },
    rawProjection
  );
  const projection = validatedProp.projection;
  const marketValidation = validatedProp.projectionValidation;
  const line = finiteOr(prop.line, NaN);
  const games = resolveGamesPlayed(prop);
  const leanDirection = resolveLeanDirection(prop);
  const metrics =
    prop.probabilityScore != null && prop.edge != null && !validatedProp.projectionClamped
      ? {
          edge: prop.edge,
          edgePercent: prop.edgePercent,
          probabilityScore: prop.probabilityScore,
          lean: prop.lean,
        }
      : computeDisplayPropMetrics({ ...validatedProp, projection, line });
  const playability = evaluateMlbPlayability(
    {
      ...prop,
      projection,
      projectedValue: projection,
      confidenceScore:
        metrics.adjustedConfidence ??
        computeMlbPlayConfidence({ ...prop, projection }, projection) ??
        prop.confidenceScore ??
        prop.confidence,
    },
    metrics
  );
  let verifiedProbability = playability.probabilityScore ?? metrics.probabilityScore;
  const baseConfidenceBreakdown =
    prop.confidenceComponents ??
    computeMlbConfidenceBreakdown({ ...prop, projection }, projection);
  const modelConfidence =
    baseConfidenceBreakdown.afterPenalties ??
    baseConfidenceBreakdown.final ??
    computeMlbPlayConfidence({ ...prop, projection }, projection) ??
    metrics.adjustedConfidence ??
    prop.displayConfidenceScore ??
    prop.confidenceScore ??
    prop.confidence;
  const sanityAudit = buildProjectionSanityAudit({
    ...validatedProp,
    projection,
    projectedValue: projection,
  });
  const projectionFormulaAudit = buildMlbProjectionFormulaAudit({
    ...prop,
    projection,
    projectedValue: projection,
    projectionSanityAudit: sanityAudit,
  });
  let afterSanityConfidence = applySanityConfidencePenalty(modelConfidence, sanityAudit);
  let sanityPenalty = Math.max(0, Math.round(modelConfidence - afterSanityConfidence));
  if (qualifiesEliteRecentFormCap({ ...prop, projectionSanityAudit: sanityAudit }) && sanityPenalty > 5) {
    afterSanityConfidence = Math.round(modelConfidence - 5);
    sanityPenalty = 5;
  }
  const playabilityBreakdown = computePlayabilityBreakdown(
    {
      ...prop,
      projection,
      projectedValue: projection,
      edge: metrics.edge,
      edgePercent: metrics.edgePercent,
      displayConfidenceScore: afterSanityConfidence,
      probabilityScore: verifiedProbability,
    },
    {
      metrics,
      sanityAudit,
      confidence: afterSanityConfidence,
      probability: verifiedProbability,
    }
  );
  const playabilityScore = Math.max(
    playabilityBreakdown.finalPlayability,
    finiteOr(prop.playabilityScore, NaN)
  );
  let displayConfidence = applyConfidenceDisplayFloor(
    { ...prop, projectionSanityAudit: sanityAudit },
    projection,
    afterSanityConfidence,
    playabilityScore
  );
  if (
    qualifiesEliteRecentFormCap({ ...prop, projectionSanityAudit: sanityAudit }) &&
    modelConfidence >= 70 &&
    playabilityScore >= TIER_A_MIN_PLAYABILITY &&
    resolvePropEdge({ ...prop, projection, edge: metrics.edge ?? prop.edge }) >= TIER_A_MIN_EDGE
  ) {
    displayConfidence = Math.max(displayConfidence, TIER_A_MIN_CONFIDENCE);
  }
  const confidenceBreakdown = {
    ...baseConfidenceBreakdown,
    sanityPenalty,
    afterSanity: afterSanityConfidence,
    final: displayConfidence,
    floorApplied: displayConfidence > afterSanityConfidence,
  };
  const confidenceExplanation = baseConfidenceBreakdown.confidenceExplanation || null;
  const confidenceAudit = buildConfidenceAuditLog(
    { ...prop, projectionSanityAudit: sanityAudit, displayConfidenceScore: displayConfidence, playabilityScore },
    projection,
    {
      breakdown: confidenceBreakdown,
      sanityPenalty,
      finalConfidence: displayConfidence,
      tier: classifyPropTier({ ...prop, displayConfidenceScore: displayConfidence, playabilityScore }),
    }
  );
  logPropConfidenceAudit(prop, confidenceAudit);
  const tierAudit = buildTierAuditEntry(
    { ...prop, displayConfidenceScore: displayConfidence, playabilityScore, confidenceAudit },
    { confidenceAudit, projection, playability: playabilityScore }
  );
  const tierLabel = classifyBestPlayTier({
    ...prop,
    projection,
    projectedValue: projection,
    probabilityScore: verifiedProbability,
    displayConfidenceScore: displayConfidence,
    pickTierLabel: playability.pickTierLabel,
  });
  const tierSnapshot = attachFinalTierFields({
    ...prop,
    projection,
    projectedValue: projection,
    probabilityScore: verifiedProbability,
    displayConfidenceScore: displayConfidence,
    playabilityScore,
    projectionSanityAudit: sanityAudit,
  });
  const verifiedTier = tierSnapshot.finalTier;
  const edge = metrics.edge ?? (projection != null && line > 0 ? computeStandardEdge(projection, line) : null);
  const edgePercent =
    metrics.edgePercent ?? (edge != null && line > 0 ? computeStandardEdgePercent(edge, line) : null);
  const edgeMagnitude = Number.isFinite(Number(edge)) ? Math.abs(Number(edge)) : resolveEdgeMagnitude(prop);
  const probabilityCalibration = computeCalibratedProbability(
    {
      ...prop,
      projection,
      projectedValue: projection,
      displayConfidenceScore: displayConfidence,
      playabilityScore,
    },
    {
      edge,
      edgePercent,
      projection,
      confidence: displayConfidence,
      playability: playabilityScore,
    },
    { verified: true, seasonStats: prop.seasonStats || [] }
  );
  if (probabilityCalibration?.probability != null) {
    verifiedProbability = applyBoardProbabilityCaps(
      { ...prop, projectionSanityAudit: sanityAudit, probabilityCalibration },
      probabilityCalibration.probability
    );
  }
  const edgeScore = edgeMagnitude;
  const edgeLabels = playability.edgeDisplay ?? formatValidatedEdgeDisplay({ ...prop, edge, edgePercent, line });
  const direction =
    leanDirection && leanDirection !== "PASS"
      ? leanDirection
      : projection != null && line > 0
        ? projection >= line
          ? "OVER"
          : "UNDER"
        : null;
  const enrichedProp = {
    ...prop,
    projection,
    probabilityScore: verifiedProbability,
    displayConfidenceScore: displayConfidence,
    playabilityScore,
    pickTierLabel: playability.pickTierLabel,
    pickTierRank: playability.pickTierRank,
  };
  const verified = isVerifiedPlay(enrichedProp, {
    probability: verifiedProbability,
    confidence: displayConfidence ?? prop.confidenceScore ?? prop.confidence,
  });
  const marketContext = buildMarketContextNote(prop);
  const explained = attachBestPlayExplanation({
    ...prop,
    projection,
    probabilityScore: verifiedProbability,
    displayConfidenceScore: displayConfidence,
    edge,
    edgePercent,
    verifiedTier,
    marketContext,
  });
  const directed = enrichPickDirectionFields({
    ...explained,
    projection,
    projectedValue: projection ?? prop.projectedValue,
    edge,
    edgePercent,
    playabilityScore,
    verifiedTier,
  });

  const statSpecificMissing = projection == null && resolvePropSport(prop) === "MLB";
  const ranked = annotateBestPlayRankingAudit({
    ...directed,
    projection,
    projectedValue: projection ?? prop.projectedValue,
    ...(statSpecificMissing
      ? {
          projectionMissingReason:
            prop.projectionMissingReason || "Stat-specific projection unavailable",
          projectionUnavailable: true,
        }
      : {}),
    games,
    leanDirection,
    lean: metrics.lean,
    edge,
    edgePercent,
    edgeMagnitude,
    edgeScore,
    verifiedProbability,
    probabilityScore: verifiedProbability,
    probabilityCalibration,
    probabilityExplanation: probabilityCalibration?.probabilityExplanation ?? null,
    historicalProbability: probabilityCalibration?.historicalProbability ?? null,
    projectionProbability: probabilityCalibration?.projectionProbability ?? null,
    calibrationPenalty: probabilityCalibration?.calibrationPenalty ?? 0,
    inflatedProbability: isInflatedProbabilityProp(
      { ...prop, probabilityScore: verifiedProbability },
      verifiedProbability
    ),
    displayConfidenceScore: displayConfidence,
    adjustedConfidence: playability.adjustedConfidence,
    confidence: displayConfidence ?? prop.confidenceScore ?? prop.confidence,
    confidenceScore: displayConfidence ?? prop.confidenceScore ?? prop.confidence,
    rawEdgeLabel: edgeLabels.rawEdgeLabel,
    displayEdgeLabel: edgeLabels.displayEdgeLabel,
    relativeEdgePercent: edgePercent,
    verified,
    isDisplayPlayable: tierLabel === "Verified Play" || playability.isDisplayPlayable,
    displayResearchOnly: tierLabel !== "Verified Play",
    bettingLabel: tierLabel || playability.bettingLabel,
    pickTierLabel: tierLabel || playability.pickTierLabel,
    pickTierRank: tierLabel === "Verified Play" ? 0 : 1,
    verifiedTier,
    verifiedTierLabel: verifiedTier ? `Tier ${verifiedTier}` : null,
    playabilityScore,
    playabilityBreakdown,
    playabilityAudit: playabilityBreakdown,
    confidenceBreakdown,
    confidenceComponents: confidenceBreakdown,
    confidenceExplanation,
    confidenceAudit,
    tierAudit,
    confidenceSanityPenalty: sanityPenalty,
    projectionFormulaAudit,
    projectionFormulaValid: projectionFormulaAudit.projectionFormulaValid,
    projectionFormulaError: projectionFormulaAudit.projectionFormulaError,
    projectionFormulaErrorReason: projectionFormulaAudit.projectionFormulaErrorReason,
    researchReasons: playability.researchReasons,
    whyNotPlayable: playability.whyNotPlayable,
    direction,
    marketContext,
    recommendedSide: prop.recommendedSide || direction,
    invalidReason: resolveBestPlayInvalidReason({ ...prop, projection }),
    rawProjection: marketValidation?.rawProjection ?? rawProjection,
    projectionValidation: marketValidation,
    projectionValidationConfidence: marketValidation?.projectionConfidence,
    projectionRisk: marketValidation?.projectionRisk,
    projectionOutlierDetected: marketValidation?.outlierDetected,
    projectionOutlierWarning: marketValidation?.outlierWarning,
    projectionClamped: marketValidation?.projectionClamped,
  });
  ranked.rankScore = ranked.bestPlayRankingScore ?? computeTopPickScore(ranked);
  ranked.weightedBestPlayScore = ranked.bestPlayRankingScore ?? ranked.topPickScore;
  ranked.verifiedRankingScore = ranked.bestPlayRankingScore ?? ranked.topPickScore;
  ranked.projectionConfidenceLevel = resolveProjectionConfidenceLevel(ranked);
  const finalized = attachBoardQualityFields(
    attachModelValidationFields(
      attachProjectionSanityAudit(ranked, {
        audit: sanityAudit,
        confidence: displayConfidence,
        playability: playabilityScore,
        skipSanityRescore: true,
      }),
      {
        edge,
        edgePercent,
        projection,
        adjustedConfidence: playability.adjustedConfidence,
      }
    )
  );
  finalized.playabilityScore = playabilityScore;
  finalized.playabilityBreakdown = {
    ...(finalized.playabilityBreakdown || playabilityBreakdown),
    finalPlayability: playabilityScore,
  };
  const withFinalMetrics = attachFinalPlayMetrics(finalized, {
    confidence: displayConfidence,
    probability: verifiedProbability,
  });
  const withPitcherPenalty = applyPitcherPendingMetricPenalty(withFinalMetrics);
  return attachFinalTierFields(withPitcherPenalty);
}

export function passesBestPlaysFilter(prop = {}) {
  return passesMinimalBestPlaysFilter(prop);
}
