/**
 * Probability calibration — derive spread from hit rates, edge, and matchup inputs.
 */

import {
  computeStandardEdge,
  computeStandardEdgePercent,
} from "./standardPropMetrics.js";

export const CALIBRATION_MIN_PROBABILITY = 40;
export const CALIBRATION_MAX_VERIFIED = 92;
export const CALIBRATION_MAX_RESEARCH = 88;

export const CALIBRATION_HISTOGRAM_BUCKETS = [
  { id: "40-45", label: "40-45%", min: 40, max: 45 },
  { id: "45-50", label: "45-50%", min: 45, max: 50 },
  { id: "50-55", label: "50-55%", min: 50, max: 55 },
  { id: "55-60", label: "55-60%", min: 55, max: 60 },
  { id: "60-65", label: "60-65%", min: 60, max: 65 },
  { id: "65-70", label: "65-70%", min: 65, max: 70 },
  { id: "70-75", label: "70-75%", min: 70, max: 75 },
  { id: "75+", label: "75%+", min: 75, max: Infinity },
];

const BASE_PROBABILITY = 43;
const WEIGHTS = {
  last5: 0.36,
  last10: 0.24,
  season: 0.14,
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
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

function estimateHitRateFromAverage(avg, line) {
  const baseline = finite(avg);
  const ln = finite(line);
  if (baseline == null || ln == null || ln <= 0) return null;
  const gap = (baseline - ln) / ln;
  return clamp(round1(50 + gap * 38), 15, 92);
}

export function resolveCalibrationHitRates(prop = {}, line = null) {
  const ln = finite(line ?? prop.line);
  const last5 =
    normalizeHitRatePercent(prop.last5HitRate) ??
    estimateHitRateFromAverage(prop.last5Average ?? prop.recentForm, ln);
  const last10 =
    normalizeHitRatePercent(prop.last10HitRate) ??
    normalizeHitRatePercent(prop.recentHitRate) ??
    estimateHitRateFromAverage(prop.last10Average, ln);
  const season =
    normalizeHitRatePercent(prop.seasonHitRate) ??
    normalizeHitRatePercent(prop.historicalHitRate) ??
    estimateHitRateFromAverage(prop.seasonAverage, ln);

  return {
    last5HitRate: last5,
    last10HitRate: last10,
    seasonHitRate: season,
    last5Label: last5 != null ? `${last5}%` : "—",
    last10Label: last10 != null ? `${last10}%` : "—",
    seasonLabel: season != null ? `${season}%` : "—",
  };
}

function hitRateContribution(rate, weight) {
  if (rate == null) return 0;
  return round1((rate - 50) * weight);
}

function resolveLean(edge) {
  const e = finite(edge);
  if (e == null || Math.abs(e) < 0.01) return "pass";
  return e > 0 ? "over" : "under";
}

function alignmentBonus(lean, rate) {
  if (rate == null || lean === "pass") return 0;
  if (lean === "over" && rate >= 55) return round1(Math.min((rate - 50) * 0.07, 2.8));
  if (lean === "under" && rate <= 45) return round1(Math.min((50 - rate) * 0.07, 2.8));
  if (lean === "over" && rate <= 40) return round1(Math.max((rate - 50) * 0.05, -3));
  if (lean === "under" && rate >= 60) return round1(Math.max((50 - rate) * 0.05, -3));
  return 0;
}

export function computeEdgeContribution(edge, edgePercent, hitRates = {}, lean = "pass") {
  const edgePct = Math.abs(finite(edgePercent) ?? 0);
  let points = round1(Math.min(edgePct * 0.5, 26));
  points += alignmentBonus(lean, hitRates.last5HitRate);
  points += alignmentBonus(lean, hitRates.last10HitRate) * 0.65;
  if (Math.abs(finite(edge) ?? 0) >= 0.5 && edgePct >= 12) points += 1.5;
  return round1(points);
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
  if (/tough|suppress|elite|deGrom|skubal/i.test(note)) adj -= 2;

  return round1(clamp(adj, -14, 16));
}

function computeDataQualityAdjustment(prop = {}) {
  let adj = 0;
  if (prop.isFallbackProjection || prop.projectionUnavailable) adj -= 10;
  if (prop.fallbackProfile || prop.sparseProfile || prop.lineOnlyData) adj -= 7;
  const vol = finite(prop.volatility ?? prop.marketVolatility);
  if (vol != null && vol >= 3) adj -= round1(Math.min((vol - 2) * 2.5, 8));
  const sample = finite(prop.sampleSize ?? prop.gamesPlayed ?? prop.games);
  if (sample != null && sample < 8) adj -= round1(Math.min((8 - sample) * 1.1, 6));
  return round1(adj);
}

export function computeCalibratedProbability(prop = {}, metrics = {}, options = {}) {
  const projection = finite(metrics.projection ?? resolveProjectionValue(prop));
  const line = finite(prop.line);
  if (projection == null || line == null || line <= 0) return null;

  const edge = finite(metrics.edge ?? computeStandardEdge(projection, line));
  const edgePercent = finite(metrics.edgePercent ?? computeStandardEdgePercent(edge, line) ?? 0);
  const lean = resolveLean(edge);
  const hitRates = resolveCalibrationHitRates(prop, line);

  const last5Contribution = hitRateContribution(hitRates.last5HitRate, WEIGHTS.last5);
  const last10Contribution = hitRateContribution(hitRates.last10HitRate, WEIGHTS.last10);
  const seasonContribution = hitRateContribution(hitRates.seasonHitRate, WEIGHTS.season);
  const edgeContribution = computeEdgeContribution(edge, edgePercent, hitRates, lean);
  const matchupAdjustment = computeMatchupAdjustment(prop);
  const dataQualityAdjustment = computeDataQualityAdjustment(prop);

  let probability = BASE_PROBABILITY;
  probability += last5Contribution;
  probability += last10Contribution;
  probability += seasonContribution;
  probability += edgeContribution;
  probability += matchupAdjustment;
  probability += dataQualityAdjustment;

  const verified = Boolean(options.verified);
  const ceiling = verified ? CALIBRATION_MAX_VERIFIED : CALIBRATION_MAX_RESEARCH;
  probability = clamp(round1(probability), CALIBRATION_MIN_PROBABILITY, ceiling);

  const inputs = {
    last5HitRate: hitRates.last5Label,
    last10HitRate: hitRates.last10Label,
    seasonHitRate: hitRates.seasonLabel,
    projectionVsLine:
      edgePercent != null ? `${edgePercent > 0 ? "+" : ""}${round1(edgePercent)}%` : "—",
    matchupAdjustment: `${matchupAdjustment > 0 ? "+" : ""}${matchupAdjustment}`,
    last5Contribution,
    last10Contribution,
    seasonContribution,
    edgeContribution,
    matchupAdjustmentValue: matchupAdjustment,
    dataQualityAdjustment,
    lean,
  };

  return {
    probability,
    inputs,
    hitRates,
    breakdown: {
      base: BASE_PROBABILITY,
      last5Contribution,
      last10Contribution,
      seasonContribution,
      edgeContribution,
      matchupAdjustment,
      dataQualityAdjustment,
      rawTotal: round1(
        BASE_PROBABILITY +
          last5Contribution +
          last10Contribution +
          seasonContribution +
          edgeContribution +
          matchupAdjustment +
          dataQualityAdjustment
      ),
      ceiling,
    },
  };
}

export function assignCalibratedProbabilityBucket(probability) {
  const prob = finite(probability);
  if (prob == null) return null;
  if (prob >= 75) return "75+";
  if (prob >= 70) return "70-75";
  if (prob >= 65) return "65-70";
  if (prob >= 60) return "60-65";
  if (prob >= 55) return "55-60";
  if (prob >= 50) return "50-55";
  if (prob >= 45) return "45-50";
  if (prob >= 40) return "40-45";
  return "below-40";
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
    last5HitRate: numeric(rows.map((row) => row.last5Contribution)) ?? "—",
    last10HitRate: numeric(rows.map((row) => row.last10Contribution)) ?? "—",
    seasonHitRate: numeric(rows.map((row) => row.seasonContribution)) ?? "—",
    edgeContribution: numeric(rows.map((row) => row.edgeContribution)) ?? "—",
    matchupAdjustment:
      numeric(rows.map((row) => row.matchupAdjustmentValue ?? row.matchupAdjustment)) ?? "—",
  };
}
