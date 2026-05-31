/**
 * Probability calibration — projection-led blend with realistic MLB caps.
 */

import {
  resolveMlbPerformanceBundle,
  formatSeasonHitRateSource,
  MIN_SDIO_SEASON_GAMES,
} from "./seasonHitRate.js";
import { resolveProjectionQuality, PROJECTION_QUALITY } from "./projectionQuality.js";

export const CALIBRATION_MIN_PROBABILITY = 50;
export const CALIBRATION_DEFAULT_MAX_PROBABILITY = 75;
export const CALIBRATION_ELITE_MAX_PROBABILITY = 88;
export const CALIBRATION_SEASON_MISSING_MAX_PROBABILITY = 70;
export const CALIBRATION_MAX_PROBABILITY = CALIBRATION_ELITE_MAX_PROBABILITY;
export const CALIBRATION_MAX_VERIFIED = CALIBRATION_ELITE_MAX_PROBABILITY;
export const CALIBRATION_MAX_RESEARCH = CALIBRATION_DEFAULT_MAX_PROBABILITY;

export const PROJECTION_QUALITY_LOW_CONFIDENCE_CAP = 70;
export const PENALTY_OUTLIER = 15;
export const PENALTY_AGGRESSIVE_RISK = 10;
export const SAMPLE_SIZE_MIN_GAMES = 20;
export const SAMPLE_SIZE_CONFIDENCE_MULTIPLIER = 0.85;
export const CONFIDENCE_PROBABILITY_BUFFER = 5;

export const CALIBRATION_HISTOGRAM_BUCKETS = [
  { id: "50-55", label: "50-55%", min: 50, max: 55 },
  { id: "55-60", label: "55-60% playable", min: 55, max: 60 },
  { id: "60-65", label: "60-65% solid", min: 60, max: 65 },
  { id: "65-72", label: "65-72% strong", min: 65, max: 72 },
  { id: "72-75", label: "72-75% elite", min: 72, max: 75 },
  { id: "75-88", label: "75-88% exceptional", min: 75, max: 88 },
];

const PROBABILITY_BLEND = {
  projectionQuality: 0.4,
  seasonPerformance: 0.25,
  recentForm: 0.2,
  matchup: 0.1,
  marketEdge: 0.05,
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHitRatePercent(value) {
  const num = finite(value);
  if (num == null) return null;
  if (num <= 1) return round1(num * 100);
  return round1(num);
}

export function resolveCalibrationHitRates(prop = {}, line = null, context = {}) {
  const ln = finite(line ?? prop.line);
  const performance = resolveMlbPerformanceBundle(prop, context);
  const last5 = performance.last5HitRate;
  const last10 = performance.last10HitRate;
  const season = performance.seasonRateValid ? performance.seasonHitRate : null;

  return {
    last5HitRate: last5,
    last10HitRate: last10,
    last20HitRate: performance.last20HitRate,
    recentFormRate: performance.recentFormRate,
    seasonHitRate: season,
    seasonGamesPlayed: performance.seasonGamesPlayed,
    seasonRateValid: Boolean(performance.seasonRateValid && season != null),
    seasonEstimated: Boolean(performance.seasonEstimated),
    seasonHitRateSource: performance.seasonHitRateSource,
    last5Label: performance.last5Label,
    last10Label: performance.last10Label,
    last20Label: performance.last20Label,
    last10Games: performance.last10Games,
    seasonLabel: performance.seasonRateValid ? performance.displayLabel : "—",
  };
}

function resolveProjectionValue(prop = {}) {
  const proj = finite(prop.projection ?? prop.projectedValue);
  if (proj == null || proj <= 0) return null;
  return proj;
}

function hasMissingMatchupData(prop = {}) {
  if (prop.matchupConfidence === "LOW") return false;
  return !prop.matchupNote && !prop.handednessMatchup && !String(prop.opponent || "").trim();
}

function isLowMatchupProp(prop = {}) {
  if (prop.matchupConfidence === "HIGH" || prop.matchupConfidence === "MEDIUM" || prop.matchupConfidence === "FORM") {
    return false;
  }
  if (prop.formBaseline != null || prop.formConfidenceScore != null) return false;
  if (prop.matchupNote || prop.handednessMatchup) return false;
  return prop.matchupConfidence === "LOW" || (!prop.matchupNote && !prop.handednessMatchup);
}

function hasMissingOpponentData(prop = {}) {
  const opponent = String(prop.opponent || "").trim();
  return (
    !opponent &&
    prop.opponentRank == null &&
    prop.opponentAllowed == null &&
    !prop.opponentContext
  );
}

export function computeMatchupAdjustment(prop = {}) {
  let adj = 0;

  const matchupScore = finite(prop.matchupScore ?? prop.matchupAudit?.matchupScore);
  if (matchupScore != null) adj += (matchupScore - 50) * 0.16;

  const rank = finite(prop.opponentRank);
  if (rank != null) {
    if (rank >= 24) adj += 6;
    else if (rank >= 20) adj += 2.5;
    else if (rank <= 8) adj -= 5;
    else if (rank <= 12) adj -= 2;
  } else if (hasMissingOpponentData(prop)) {
    adj -= 4;
  } else if (String(prop.opponent || "").trim()) {
    adj += 1.5;
  }

  const confidence = String(prop.matchupConfidence || "").toUpperCase();
  if (confidence === "HIGH") adj += 3;
  else if (confidence === "MEDIUM" || confidence === "FORM") adj += 1;
  else if (isLowMatchupProp(prop)) adj -= 5;
  else if (hasMissingMatchupData(prop)) adj -= 7;

  const form = finite(prop.formConfidenceScore);
  if (form != null) adj += (form - 50) * 0.07;

  const note = String(prop.matchupNote || prop.handednessMatchup || "").toLowerCase();
  if (/favorable|boost|plus|weak pitching|short porch|wind out/i.test(note)) adj += 2;
  if (/tough|suppress|elite|degrom|skubal/i.test(note)) adj -= 2;

  return round1(clamp(adj, -14, 16));
}

function resolveProbabilityConfidence(prop = {}, options = {}) {
  return (
    finite(options.confidence) ??
    finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence) ??
    50
  );
}

function resolveProjectionValidationFlags(prop = {}) {
  const audit = prop.projectionSanityAudit || {};
  const validation = prop.projectionValidation || audit.marketValidation || {};
  const projectionConfidence = String(
    prop.projectionValidationConfidence ||
      validation.projectionConfidence ||
      audit.projectionValidationConfidence ||
      ""
  ).toUpperCase();
  const projectionRisk = String(
    prop.projectionRisk || validation.projectionRisk || audit.projectionRisk || ""
  ).toUpperCase();
  const outlierDetected = Boolean(
    prop.projectionOutlierDetected ||
      validation.outlierDetected ||
      audit.projectionOutlierDetected ||
      audit.outlierWarning ||
      prop.projectionOutlierWarning
  );

  return {
    projectionConfidence,
    projectionRisk,
    outlierDetected,
    projectionConfidenceLow: projectionConfidence === "LOW",
    projectionRiskAggressive: projectionRisk === "AGGRESSIVE",
  };
}

function resolveSampleGames(prop = {}, hitRates = {}) {
  return (
    finite(hitRates.last10Games) ??
    finite(prop.sampleGames) ??
    finite(prop.gameLogCount) ??
    finite(prop.sampleSize) ??
    null
  );
}

export function resolveProbabilityPenalties(prop = {}, hitRates = {}, confidence = 50) {
  const flags = resolveProjectionValidationFlags(prop);
  const seasonValid = Boolean(hitRates.seasonRateValid && hitRates.seasonHitRate != null);
  const sampleGames = resolveSampleGames(prop, hitRates);
  const sampleSizeSmall = sampleGames != null && sampleGames < SAMPLE_SIZE_MIN_GAMES;

  const outlierPenalty = flags.outlierDetected ? PENALTY_OUTLIER : 0;
  const aggressiveRiskPenalty = flags.projectionRiskAggressive ? PENALTY_AGGRESSIVE_RISK : 0;
  const missingSeasonPenalty = 0;
  const sampleSizePenalty = 0;

  const totalPenalty = outlierPenalty + aggressiveRiskPenalty;

  return {
    ...flags,
    seasonValid,
    sampleGames,
    sampleSizeSmall,
    outlierPenalty,
    aggressiveRiskPenalty,
    missingSeasonPenalty,
    sampleSizePenalty,
    totalPenalty,
    seasonMissingCap: seasonValid ? null : CALIBRATION_SEASON_MISSING_MAX_PROBABILITY,
  };
}

function resolveProjectionQualityScore(prop = {}, flags = {}) {
  const sanity = finite(prop.projectionSanityScore ?? prop.projectionSanityAudit?.sanityScore);
  let score =
    sanity != null
      ? clamp(sanity, 45, 95)
      : resolveProjectionQuality(prop) === PROJECTION_QUALITY.VERIFIED
        ? 82
        : resolveProjectionQuality(prop) === PROJECTION_QUALITY.ESTIMATED
          ? 62
          : 50;

  if (flags.projectionConfidenceLow) score = Math.min(score, PROJECTION_QUALITY_LOW_CONFIDENCE_CAP);
  if (flags.outlierDetected) score = Math.min(score, PROJECTION_QUALITY_LOW_CONFIDENCE_CAP);
  if (flags.projectionRiskAggressive) score = Math.min(score, 65);
  return score;
}

function resolveMarketEdgeScore(projection, line, edgePercent = null, flags = {}) {
  let score;
  const pct = finite(edgePercent);
  if (pct != null) {
    score = clamp(round1(50 + Math.abs(pct) * 0.85), 50, 95);
  } else {
    const proj = finite(projection);
    const ln = finite(line);
    if (proj == null || ln == null || ln <= 0) score = 50;
    else {
      const relativeGap = (Math.abs(proj - ln) / ln) * 100;
      score = clamp(round1(50 + relativeGap * 0.75), 50, 95);
    }
  }

  if (flags.projectionConfidenceLow) score = Math.min(score, PROJECTION_QUALITY_LOW_CONFIDENCE_CAP);
  if (flags.outlierDetected) score = Math.min(score, PROJECTION_QUALITY_LOW_CONFIDENCE_CAP);
  if (flags.projectionRiskAggressive) score = Math.min(score, 65);
  return score;
}

function resolveRecentFormScore(hitRates = {}) {
  const recent = finite(hitRates.recentFormRate);
  if (recent != null) return recent;
  const l5 = finite(hitRates.last5HitRate);
  const l10 = finite(hitRates.last10HitRate);
  if (l5 != null && l10 != null) return round1(l5 * 0.4 + l10 * 0.6);
  return l10 ?? l5 ?? 50;
}

function resolveBlendWeights(seasonValid) {
  if (seasonValid) return PROBABILITY_BLEND;
  return {
    projectionQuality: PROBABILITY_BLEND.projectionQuality + PROBABILITY_BLEND.seasonPerformance,
    seasonPerformance: 0,
    recentForm: PROBABILITY_BLEND.recentForm,
    matchup: PROBABILITY_BLEND.matchup,
    marketEdge: PROBABILITY_BLEND.marketEdge,
  };
}

function resolveMatchupScore(prop = {}) {
  const direct = finite(prop.matchupScore ?? prop.matchupAudit?.matchupScore);
  if (direct != null) return clamp(direct, 40, 90);
  const adj = computeMatchupAdjustment(prop);
  return clamp(round1(50 + adj * 2), 40, 90);
}

function resolveProbabilityCeiling(prop = {}, metrics = {}, hitRates = {}, confidence = 50, penalties = {}) {
  const projection = finite(metrics.projection ?? resolveProjectionValue(prop));
  const line = finite(prop.line);
  const edgePercent =
    finite(metrics.edgePercent) ??
    (projection != null && line != null && line > 0
      ? round1((Math.abs(projection - line) / line) * 100)
      : null);
  const seasonGames = finite(hitRates.seasonGamesPlayed ?? prop.seasonGamesPlayed ?? prop.seasonGames);
  const effectiveConfidence = penalties.sampleSizeSmall
    ? round1(confidence * SAMPLE_SIZE_CONFIDENCE_MULTIPLIER)
    : confidence;
  const confidenceCap = round1(effectiveConfidence + CONFIDENCE_PROBABILITY_BUFFER);
  const eliteUnlock =
    penalties.seasonValid &&
    edgePercent != null &&
    edgePercent >= 20 &&
    seasonGames != null &&
    seasonGames >= MIN_SDIO_SEASON_GAMES &&
    effectiveConfidence >= 80 &&
    !penalties.outlierDetected &&
    !penalties.projectionRiskAggressive &&
    !penalties.projectionConfidenceLow;

  let ceiling = eliteUnlock ? CALIBRATION_ELITE_MAX_PROBABILITY : CALIBRATION_DEFAULT_MAX_PROBABILITY;
  if (!penalties.seasonValid) {
    ceiling = Math.min(ceiling, CALIBRATION_SEASON_MISSING_MAX_PROBABILITY);
  }
  ceiling = Math.min(ceiling, confidenceCap);

  return {
    ceiling,
    eliteUnlock,
    edgePercent,
    seasonGames,
    effectiveConfidence,
    confidenceCap,
  };
}

export function resolveProbabilityTier(probability) {
  const prob = finite(probability);
  if (prob == null) return "—";
  if (prob >= 80) return "exceptional";
  if (prob >= 72) return "elite";
  if (prob >= 65) return "strong";
  if (prob >= 60) return "solid";
  if (prob >= 55) return "playable";
  return "below playable";
}

export function computeCalibratedProbability(prop = {}, metrics = {}, options = {}) {
  const projection = finite(metrics.projection ?? resolveProjectionValue(prop));
  const line = finite(prop.line);
  if (projection == null || line == null || line <= 0) return null;

  const confidence = resolveProbabilityConfidence(prop, options);
  const context = { seasonStats: options.seasonStats || prop.seasonStats || [] };
  const hitRates = resolveCalibrationHitRates(prop, line, context);
  const seasonValid = Boolean(hitRates.seasonRateValid && hitRates.seasonHitRate != null);
  const weights = resolveBlendWeights(seasonValid);
  const validationFlags = resolveProjectionValidationFlags(prop);
  const penalties = resolveProbabilityPenalties(prop, hitRates, confidence);

  const projectionQualityScore = resolveProjectionQualityScore(prop, validationFlags);
  const seasonPerformanceScore = seasonValid ? hitRates.seasonHitRate : 50;
  const recentFormScore = resolveRecentFormScore(hitRates);
  const matchupScore = resolveMatchupScore(prop);
  const marketEdgeScore = resolveMarketEdgeScore(projection, line, metrics.edgePercent, validationFlags);

  const projectionContribution = round2(projectionQualityScore * weights.projectionQuality);
  const seasonContribution = round2(seasonPerformanceScore * weights.seasonPerformance);
  const recentContribution = round2(recentFormScore * weights.recentForm);
  const matchupContribution = round2(matchupScore * weights.matchup);
  const edgeContribution = round2(marketEdgeScore * weights.marketEdge);

  const prePenaltyProbability = round2(
    projectionContribution +
      seasonContribution +
      recentContribution +
      matchupContribution +
      edgeContribution
  );

  const cap = resolveProbabilityCeiling(prop, metrics, hitRates, confidence, penalties);
  const penalizedProbability = round2(prePenaltyProbability - penalties.totalPenalty);
  const probability = clamp(penalizedProbability, CALIBRATION_MIN_PROBABILITY, cap.ceiling);
  const probabilityTier = resolveProbabilityTier(probability);

  const inputs = {
    recentHitRate: `${round1(recentFormScore)}%`,
    last5HitRate: hitRates.last5Label,
    last10HitRate: hitRates.last10Label,
    seasonHitRate: seasonValid ? `${round1(hitRates.seasonHitRate)}%` : "—",
    seasonRateValid: seasonValid,
    seasonGamesPlayed: hitRates.seasonGamesPlayed ?? "—",
    seasonHitRateSource: formatSeasonHitRateSource(hitRates.seasonHitRateSource) || "—",
    confidence: `${round1(confidence)}%`,
    effectiveConfidence: `${round1(cap.effectiveConfidence)}%`,
    projectionQuality: `${round1(projectionQualityScore)}%`,
    projectionEdge: `${round1(marketEdgeScore)}%`,
    edgeScore: `${round1(marketEdgeScore)}%`,
    edgeContribution,
    prePenaltyProbability: `${round1(prePenaltyProbability)}%`,
    rawProbability: `${round1(prePenaltyProbability)}%`,
    penalizedProbability: `${round1(penalizedProbability)}%`,
    calibratedProbability: `${round1(probability)}%`,
    probabilityTier,
    finalProbability: `${round1(probability)}%`,
    seasonHitRateLabel: hitRates.seasonLabel,
    projectionContribution,
    seasonContribution,
    recentContribution,
    matchupContribution,
    edgeContributionValue: edgeContribution,
    outlierPenalty: penalties.outlierPenalty ? `-${penalties.outlierPenalty}` : "0",
    aggressiveRiskPenalty: penalties.aggressiveRiskPenalty ? `-${penalties.aggressiveRiskPenalty}` : "0",
    missingSeasonPenalty: penalties.seasonValid ? "0" : `Cap ${CALIBRATION_SEASON_MISSING_MAX_PROBABILITY}%`,
    sampleSizePenalty: penalties.sampleSizeSmall
      ? `Confidence ×${SAMPLE_SIZE_CONFIDENCE_MULTIPLIER}`
      : "0",
    totalPenalty: penalties.totalPenalty ? `-${penalties.totalPenalty}` : "0",
    probabilityCap: `${round1(cap.ceiling)}%`,
    projectionVsLine:
      projection != null && line != null
        ? `${round1(projection - line) > 0 ? "+" : ""}${round1(projection - line)}`
        : "—",
  };

  return {
    probability,
    rawProbability: prePenaltyProbability,
    prePenaltyProbability,
    penalizedProbability,
    calibratedProbability: probability,
    probabilityTier,
    inputs,
    hitRates,
    probabilityPenalties: {
      outlierPenalty: penalties.outlierPenalty,
      aggressiveRiskPenalty: penalties.aggressiveRiskPenalty,
      missingSeasonPenalty: penalties.missingSeasonPenalty,
      sampleSizePenalty: penalties.sampleSizePenalty,
      totalPenalty: penalties.totalPenalty,
      sampleSizeSmall: penalties.sampleSizeSmall,
      seasonMissingCap: penalties.seasonMissingCap,
    },
    breakdown: {
      rawProbability: prePenaltyProbability,
      prePenaltyProbability,
      penalizedProbability,
      calibratedProbability: probability,
      probabilityTier,
      projectionQualityScore,
      seasonPerformanceScore: seasonValid ? hitRates.seasonHitRate : null,
      recentFormRate: recentFormScore,
      recentHitRate: recentFormScore,
      seasonHitRate: seasonValid ? hitRates.seasonHitRate : null,
      seasonRateValid: seasonValid,
      seasonGamesPlayed: hitRates.seasonGamesPlayed,
      seasonEstimated: hitRates.seasonEstimated,
      seasonHitRateSource: hitRates.seasonHitRateSource,
      matchupScore,
      edgeScore: marketEdgeScore,
      edgePercent: cap.edgePercent,
      confidence,
      effectiveConfidence: cap.effectiveConfidence,
      confidenceCap: cap.confidenceCap,
      projectionContribution,
      seasonContribution,
      recentContribution,
      matchupContribution,
      edgeContribution,
      outlierPenalty: penalties.outlierPenalty,
      aggressiveRiskPenalty: penalties.aggressiveRiskPenalty,
      missingSeasonPenalty: penalties.missingSeasonPenalty,
      sampleSizePenalty: penalties.sampleSizePenalty,
      totalPenalty: penalties.totalPenalty,
      probabilityPenalties: {
        outlierPenalty: penalties.outlierPenalty,
        aggressiveRiskPenalty: penalties.aggressiveRiskPenalty,
        missingSeasonPenalty: penalties.missingSeasonPenalty,
        sampleSizePenalty: penalties.sampleSizePenalty,
        totalPenalty: penalties.totalPenalty,
      },
      projectionValidationConfidence: validationFlags.projectionConfidence,
      projectionRisk: validationFlags.projectionRisk,
      outlierDetected: validationFlags.outlierDetected,
      ceiling: cap.ceiling,
      eliteProbabilityUnlock: cap.eliteUnlock,
      blendWeights: weights,
      capped: penalizedProbability > cap.ceiling || prePenaltyProbability > cap.ceiling,
      doubleCountingPrevented: !seasonValid,
    },
  };
}

export function assignCalibratedProbabilityBucket(probability) {
  const prob = finite(probability);
  if (prob == null) return null;
  if (prob >= 75) return "75-88";
  if (prob >= 72) return "72-75";
  if (prob >= 65) return "65-72";
  if (prob >= 60) return "60-65";
  if (prob >= 55) return "55-60";
  if (prob >= 50) return "50-55";
  return "below-50";
}

export function buildCalibratedProbabilityHistogram(probabilities = []) {
  const counts = CALIBRATION_HISTOGRAM_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.id] = 0;
    return acc;
  }, {});

  for (const value of probabilities) {
    const bucket = assignCalibratedProbabilityBucket(value);
    if (bucket && counts[bucket] != null) counts[bucket] += 1;
  }

  return CALIBRATION_HISTOGRAM_BUCKETS.map((bucket) => ({
    ...bucket,
    count: counts[bucket.id] ?? 0,
  }));
}

export function summarizeCalibrationInputs(pool = []) {
  const rows = (pool || [])
    .map((prop) => prop.probabilityCalibration?.inputs || prop.probabilityAudit)
    .filter(Boolean);
  if (!rows.length) {
    return {
      count: 0,
      last5HitRate: "—",
      last10HitRate: "—",
      seasonHitRate: "—",
      edgeContribution: "—",
      matchupAdjustment: "—",
    };
  }

  const numeric = (values) => {
    const nums = values.filter((value) => Number.isFinite(value));
    if (!nums.length) return null;
    return round1(nums.reduce((sum, value) => sum + value, 0) / nums.length);
  };

  return {
    count: rows.length,
    last5HitRate: numeric(rows.map((row) => row.recentContribution ?? row.last5Contribution)) ?? "—",
    last10HitRate: numeric(rows.map((row) => row.last10Contribution ?? row.recentContribution)) ?? "—",
    seasonHitRate: numeric(rows.map((row) => row.seasonContribution)) ?? "—",
    edgeContribution: numeric(rows.map((row) => row.edgeContribution ?? row.edgeContributionValue)) ?? "—",
    matchupAdjustment:
      numeric(rows.map((row) => row.matchupContribution ?? row.matchupAdjustmentValue ?? row.matchupAdjustment)) ??
      "—",
  };
}

export function computeEdgeContribution(edge, edgePercent, hitRates = {}, lean = "pass") {
  void edge;
  void hitRates;
  void lean;
  const pct = finite(edgePercent);
  if (pct == null) return 0;
  const edgeScore = clamp(50 + Math.abs(pct) * 0.85, 50, 95);
  return round1(edgeScore * PROBABILITY_BLEND.marketEdge);
}
