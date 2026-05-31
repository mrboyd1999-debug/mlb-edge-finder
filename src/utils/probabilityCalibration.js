/**
 * Probability calibration — edge-driven blend capped at realistic MLB hit rates.
 */

import { resolveSeasonHitRateBundle } from "./seasonHitRate.js";
import { resolveVerifiedHitRateSnapshot } from "./verifiedHitRates.js";

export const CALIBRATION_MIN_PROBABILITY = 50;
export const CALIBRATION_MAX_PROBABILITY = 88;
export const CALIBRATION_MAX_VERIFIED = CALIBRATION_MAX_PROBABILITY;
export const CALIBRATION_MAX_RESEARCH = CALIBRATION_MAX_PROBABILITY;

export const CALIBRATION_HISTOGRAM_BUCKETS = [
  { id: "50-55", label: "50-55%", min: 50, max: 55 },
  { id: "55-60", label: "55-60% playable", min: 55, max: 60 },
  { id: "60-65", label: "60-65% solid", min: 60, max: 65 },
  { id: "65-72", label: "65-72% strong", min: 65, max: 72 },
  { id: "72-80", label: "72-80% elite", min: 72, max: 80 },
  { id: "80-88", label: "80-88% exceptional", min: 80, max: 88 },
];

const PROBABILITY_WEIGHTS = {
  recent: 0.35,
  season: 0.25,
  edge: 0.2,
  confidence: 0.1,
  playability: 0.1,
};

const PROBABILITY_WEIGHTS_NO_SEASON = {
  recent: 0.45,
  edge: 0.25,
  confidence: 0.15,
  playability: 0.15,
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

function estimateHitRateFromAverage(avg, line) {
  const baseline = finite(avg);
  const ln = finite(line);
  if (baseline == null || ln == null || ln <= 0) return null;
  const gap = (baseline - ln) / ln;
  return clamp(round1(50 + gap * 38), 15, 92);
}

export function resolveCalibrationHitRates(prop = {}, line = null) {
  const ln = finite(line ?? prop.line);
  const snapshot = resolveVerifiedHitRateSnapshot(prop);
  const last5 = snapshot.last5 ?? estimateHitRateFromAverage(prop.last5Average ?? prop.recentForm, ln);
  const last10 = snapshot.last10 ?? estimateHitRateFromAverage(prop.last10Average, ln);
  const seasonBundle = resolveSeasonHitRateBundle(prop);
  const season =
    seasonBundle.seasonRateValid && seasonBundle.seasonHitRate != null
      ? seasonBundle.seasonHitRate
      : snapshot.season ?? normalizeHitRatePercent(prop.seasonHitRate) ??
        normalizeHitRatePercent(prop.historicalHitRate) ??
        estimateHitRateFromAverage(prop.seasonAverage, ln);

  return {
    last5HitRate: last5,
    last10HitRate: last10,
    seasonHitRate: season,
    seasonRateValid: Boolean(seasonBundle.seasonRateValid && seasonBundle.seasonHitRate > 0),
    seasonHitRateSource: seasonBundle.seasonHitRateSource,
    last5Label: snapshot.last5Label !== "—" ? snapshot.last5Label : last5 != null ? `${last5}%` : "—",
    last10Label: snapshot.last10Label !== "—" ? snapshot.last10Label : last10 != null ? `${last10}%` : "—",
    seasonLabel:
      snapshot.seasonLabel !== "—" && snapshot.seasonLabel !== "0%"
        ? snapshot.seasonLabel
        : seasonBundle.displayLabel !== "—"
          ? seasonBundle.displayLabel
          : season != null
            ? `${season}%`
            : "—",
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
  if (/tough|suppress|elite|deGrom|skubal/i.test(note)) adj -= 2;

  return round1(clamp(adj, -14, 16));
}

function resolveProbabilityConfidence(prop = {}, options = {}) {
  return (
    finite(options.confidence) ??
    finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence) ??
    50
  );
}

function resolveProbabilityPlayability(prop = {}, options = {}) {
  return (
    finite(options.playability) ??
    finite(prop.playabilityScore ?? prop.playabilityBreakdown?.finalPlayability) ??
    resolveProbabilityConfidence(prop, options)
  );
}

function resolveProjectionEdgeScore(projection, line, edgePercent = null) {
  const pct = finite(edgePercent);
  if (pct != null) {
    return clamp(round1(50 + Math.abs(pct) * 0.85), 50, 95);
  }
  const proj = finite(projection);
  const ln = finite(line);
  if (proj == null || ln == null || ln <= 0) return 50;
  const relativeGap = (Math.abs(proj - ln) / ln) * 100;
  return clamp(round1(50 + relativeGap * 0.75), 50, 95);
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
  const playability = resolveProbabilityPlayability(prop, options);
  const hitRates = resolveCalibrationHitRates(prop, line);
  const recentHitRate = hitRates.last10HitRate ?? hitRates.last5HitRate ?? confidence;
  const seasonValid = Boolean(hitRates.seasonRateValid && hitRates.seasonHitRate > 0);
  const seasonHitRate = seasonValid ? hitRates.seasonHitRate : null;
  const weights = seasonValid ? PROBABILITY_WEIGHTS : PROBABILITY_WEIGHTS_NO_SEASON;
  const edgeScore = resolveProjectionEdgeScore(projection, line, metrics.edgePercent);
  const edgePercent = finite(metrics.edgePercent);

  const recentContribution = round2(recentHitRate * weights.recent);
  const seasonContribution = seasonValid ? round2(seasonHitRate * weights.season) : 0;
  const edgeContribution = round2(edgeScore * weights.edge);
  const confidenceContribution = round2(confidence * weights.confidence);
  const playabilityContribution = round2(playability * weights.playability);
  const rawProbability = round2(
    recentContribution +
      seasonContribution +
      edgeContribution +
      confidenceContribution +
      playabilityContribution
  );

  const ceiling = CALIBRATION_MAX_PROBABILITY;
  const probability = clamp(rawProbability, CALIBRATION_MIN_PROBABILITY, ceiling);
  const probabilityTier = resolveProbabilityTier(probability);

  const inputs = {
    recentHitRate: `${round1(recentHitRate)}%`,
    seasonHitRate: seasonValid ? `${round1(seasonHitRate)}%` : "—",
    seasonRateValid: seasonValid,
    seasonHitRateSource: hitRates.seasonHitRateSource || "—",
    confidence: `${round1(confidence)}%`,
    playability: `${round1(playability)}%`,
    projectionEdge: `${round1(edgeScore)}%`,
    edgeScore: `${round1(edgeScore)}%`,
    edgeContribution: round2(edgeContribution),
    rawProbability: `${round1(rawProbability)}%`,
    calibratedProbability: `${round1(probability)}%`,
    probabilityTier,
    finalProbability: `${round1(probability)}%`,
    last5HitRate: hitRates.last5Label,
    last10HitRate: hitRates.last10Label,
    seasonHitRateLabel: hitRates.seasonLabel,
    recentContribution,
    last10Contribution: recentContribution,
    seasonContribution,
    confidenceContribution,
    playabilityContribution,
    edgeContributionValue: edgeContribution,
    projectionVsLine:
      projection != null && line != null
        ? `${round1(projection - line) > 0 ? "+" : ""}${round1(projection - line)}`
        : "—",
  };

  return {
    probability,
    rawProbability,
    calibratedProbability: probability,
    probabilityTier,
    inputs,
    hitRates,
    breakdown: {
      rawProbability,
      calibratedProbability: probability,
      probabilityTier,
      recentHitRate,
      seasonHitRate: seasonValid ? seasonHitRate : null,
      seasonRateValid: seasonValid,
      seasonHitRateSource: hitRates.seasonHitRateSource,
      edgeScore,
      edgePercent,
      confidence,
      playability,
      recentContribution,
      last10Contribution: recentContribution,
      seasonContribution,
      confidenceContribution,
      playabilityContribution,
      edgeContribution,
      ceiling,
      blendWeights: weights,
      capped: rawProbability > ceiling,
    },
  };
}

export function assignCalibratedProbabilityBucket(probability) {
  const prob = finite(probability);
  if (prob == null) return null;
  if (prob >= 80) return "80-88";
  if (prob >= 72) return "72-80";
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
    last10HitRate: numeric(rows.map((row) => row.last10Contribution)) ?? "—",
    seasonHitRate: numeric(rows.map((row) => row.seasonContribution)) ?? "—",
    edgeContribution: numeric(rows.map((row) => row.edgeContribution)) ?? "—",
    matchupAdjustment:
      numeric(rows.map((row) => row.matchupAdjustmentValue ?? row.matchupAdjustment)) ?? "—",
  };
}

// Legacy exports used by older edge contribution audit paths.
export function computeEdgeContribution(edge, edgePercent, hitRates = {}, lean = "pass") {
  void edge;
  void hitRates;
  void lean;
  const pct = finite(edgePercent);
  if (pct == null) return 0;
  const edgeScore = clamp(50 + Math.abs(pct) * 0.85, 50, 95);
  return round1(edgeScore * PROBABILITY_WEIGHTS.edge);
}
