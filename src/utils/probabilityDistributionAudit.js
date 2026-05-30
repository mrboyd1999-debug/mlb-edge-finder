/**
 * Probability distribution audit — histogram, spread, and compression diagnostics.
 */

import {
  computeConservativeProbability,
  resolveProjectionValue,
} from "./conservativeProjection.js";
import { computeStatSpecificProbability } from "./mlbStatProbability.js";
import {
  computeStandardEdge,
  computeStandardEdgePercent,
} from "./standardPropMetrics.js";
import {
  buildCalibratedProbabilityHistogram,
  CALIBRATION_HISTOGRAM_BUCKETS,
  computeCalibratedProbability,
  summarizeCalibrationInputs,
} from "./probabilityCalibration.js";

export { CALIBRATION_HISTOGRAM_BUCKETS as PROBABILITY_HISTOGRAM_BUCKETS } from "./probabilityCalibration.js";

const LEGACY_RESEARCH_CAP = 70;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function resolveDisplayedProbability(prop = {}) {
  return finite(prop.probabilityScore ?? prop.verifiedProbability);
}

export function assignProbabilityBucket(probability) {
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

export function buildProbabilityHistogram(probabilities = []) {
  return buildCalibratedProbabilityHistogram(probabilities);
}

function summarizeProbabilities(probabilities = []) {
  const values = probabilities.filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { min: null, max: null, average: null, spread: null, count: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    min: round1(min),
    max: round1(max),
    average: round1(average),
    spread: round1(max - min),
    count: values.length,
  };
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function resolveProbabilityPipelineValues(prop = {}, metrics = {}) {
  const projection = finite(metrics.projection ?? resolveProjectionValue(prop));
  const line = finite(prop.line);
  const edge = finite(metrics.edge ?? computeStandardEdge(projection, line));
  const edgePercent = finite(metrics.edgePercent ?? computeStandardEdgePercent(edge, line));
  const metricInput = { edge, edgePercent, projection };

  const calibrated = computeCalibratedProbability(prop, metricInput, { verified: true });
  const statSpecific = computeStatSpecificProbability(prop, projection, line);
  const displayed = resolveDisplayedProbability(prop);
  const researchCapped = computeConservativeProbability(prop, metricInput, { verified: false });
  const verifiedCapped = computeConservativeProbability(prop, metricInput, { verified: true });

  const compressionFlags = [];
  if (displayed === LEGACY_RESEARCH_CAP) compressionFlags.push("legacy_cap_70");
  if (displayed != null && calibrated?.probability != null && calibrated.probability > displayed + 2) {
    compressionFlags.push("calibrated_higher_than_display");
  }
  if (displayed != null && statSpecific != null && statSpecific > displayed + 1) {
    compressionFlags.push("stat_specific_higher_than_display");
  }
  if (displayed != null && displayed >= 68 && displayed <= 70) compressionFlags.push("cluster_band_68_70");

  return {
    displayed,
    calibrated: calibrated?.probability ?? null,
    calibrationInputs: calibrated?.inputs ?? null,
    statSpecific,
    researchCapped,
    verifiedCapped,
    compressionFlags,
    likelyLegacyCap: displayed === LEGACY_RESEARCH_CAP,
  };
}

function buildCompressionAudit(pool = [], probabilities = []) {
  const pipeline = pool.map((prop) => resolveProbabilityPipelineValues(prop));
  const exact70 = probabilities.filter((value) => value === LEGACY_RESEARCH_CAP).length;
  const band68to70 = probabilities.filter((value) => value >= 68 && value <= 70).length;
  const uniqueDisplayed = new Set(probabilities.map((value) => round1(value))).size;
  const legacyCapHits = pipeline.filter((row) => row.likelyLegacyCap).length;
  const calibratedHigher = pipeline.filter((row) =>
    row.compressionFlags.includes("calibrated_higher_than_display")
  ).length;

  const notes = [];
  if (legacyCapHits > 0) {
    notes.push(`${legacyCapHits} props still at legacy 70% display cap`);
  }
  if (calibratedHigher > 0) {
    notes.push(`${calibratedHigher} props have calibrated probability above displayed value`);
  }
  if (uniqueDisplayed <= 3 && probabilities.length >= 10) {
    notes.push(`Only ${uniqueDisplayed} unique displayed probability values across pool`);
  }
  if (band68to70 / Math.max(probabilities.length, 1) >= 0.5) {
    notes.push(`${band68to70} props (${Math.round((band68to70 / probabilities.length) * 100)}%) cluster in 68-70% band`);
  }
  const spread = summarizeProbabilities(probabilities).spread;
  if (spread != null && spread < 8 && probabilities.length >= 10) {
    notes.push(`Displayed spread is only ${spread} points — review calibration inputs`);
  }

  return {
    exact70Count: exact70,
    band68to70Count: band68to70,
    uniqueDisplayedValues: uniqueDisplayed,
    researchCapHits: legacyCapHits,
    statSpecificHigherCount: calibratedHigher,
    verifiedWouldScoreHigherCount: 0,
    roundingApplied: true,
    notes,
  };
}

export function buildProbabilityDistributionAudit(pool = [], topPool = pool) {
  const projectedProbabilities = pool
    .map(resolveDisplayedProbability)
    .filter((value) => Number.isFinite(value));
  const topProbabilities = topPool
    .map(resolveDisplayedProbability)
    .filter((value) => Number.isFinite(value));

  const projected = summarizeProbabilities(projectedProbabilities);
  const top20 = summarizeProbabilities(topProbabilities);

  return {
    projected: {
      ...projected,
      histogram: buildProbabilityHistogram(projectedProbabilities),
    },
    top20: {
      ...top20,
      histogram: buildProbabilityHistogram(topProbabilities),
    },
    calibrationInputs: summarizeCalibrationInputs(pool),
    top20CalibrationInputs: summarizeCalibrationInputs(topPool),
    compressionAudit: buildCompressionAudit(pool, projectedProbabilities),
  };
}
