import { confidenceTierLabel, computeOutcomeAnalytics, pickStatus, MIN_NO_ADJUSTMENT_SAMPLE, MIN_STRONG_ADJUSTMENT_SAMPLE } from "./outcomeTracking.js";

/** Baseline expected hit rates by confidence tier (not guaranteed probability). */
export const TIER_BASELINE_HIT_RATES = {
  "80+": 0.62,
  "72-79": 0.58,
  "65-71": 0.54,
  "58-64": 0.52,
  "50-57": 0.5,
  "Under 50": 0.48,
  Unknown: 0.5,
};

const MIN_CALIBRATION_SAMPLE = MIN_NO_ADJUSTMENT_SAMPLE;
const MAX_CALIBRATION_ADJUST = 12;

function calibrationWeight(sample = 0) {
  if (sample < MIN_NO_ADJUSTMENT_SAMPLE) return 0;
  if (sample < MIN_STRONG_ADJUSTMENT_SAMPLE) return 0.55;
  return 1;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

export function buildCalibrationMap(history = []) {
  const analytics = computeOutcomeAnalytics(history);
  const map = {};

  Object.entries(TIER_BASELINE_HIT_RATES).forEach(([tier, baseline]) => {
    const bucket = analytics.byConfidenceTier?.[tier];
    if (!bucket || bucket.sample < MIN_CALIBRATION_SAMPLE) {
      map[tier] = {
        tier,
        baseline,
        actual: null,
        sample: bucket?.sample || 0,
        adjustment: 0,
        note: bucket?.sample ? "Calibration sample still building." : "No settled picks in tier yet.",
      };
      return;
    }
    const actual = bucket.hitRate;
    const delta = actual - baseline;
    const weight = calibrationWeight(bucket.sample);
    const adjustment = clamp(delta * -40 * weight, -MAX_CALIBRATION_ADJUST, MAX_CALIBRATION_ADJUST);
    map[tier] = {
      tier,
      baseline,
      actual: round(actual, 3),
      sample: bucket.sample,
      adjustment: round(adjustment),
      note:
        Math.abs(delta) >= 0.04
          ? `${tier} tier hits ${Math.round(actual * 100)}% vs ${Math.round(baseline * 100)}% baseline — ${adjustment > 0 ? "boosting" : "reducing"} future scores.`
          : `${tier} tier calibrated (${Math.round(actual * 100)}% over ${bucket.sample}).`,
    };
  });

  return map;
}

/**
 * Adjust raw confidence using tier calibration from settled history.
 * Confidence is not guaranteed probability — calibration nudges over/under-performing tiers.
 */
export function calibrateConfidence(prop = {}, rawConfidence = 0, history = [], calibrationMap = null) {
  const raw = Number(rawConfidence) || 0;
  if (raw <= 0) {
    return {
      calibratedConfidence: 0,
      calibrationAdjustment: 0,
      calibrationNote: "No confidence to calibrate.",
      tierActualHitRate: null,
      tierBaselineHitRate: null,
      calibrationSample: 0,
    };
  }

  const tier = confidenceTierLabel(raw);
  const map = calibrationMap || buildCalibrationMap(history);
  const entry = map[tier] || map.Unknown || { adjustment: 0, actual: null, baseline: TIER_BASELINE_HIT_RATES[tier] || 0.5, sample: 0, note: "" };
  const adjustment = Number(entry.adjustment || 0);
  const calibrated = Math.round(clamp(raw + adjustment, 0, 100));

  return {
    calibratedConfidence: calibrated,
    calibrationAdjustment: adjustment,
    calibrationNote: entry.note || "",
    tierActualHitRate: entry.actual,
    tierBaselineHitRate: entry.baseline,
    calibrationSample: entry.sample || 0,
    confidenceTier: tier,
  };
}

export function calibrationSummary(history = []) {
  const map = buildCalibrationMap(history);
  const settled = history.filter((row) => ["Win", "Loss"].includes(pickStatus(row)));
  return {
    settledCount: settled.length,
    tiers: Object.values(map).filter((row) => row.sample >= MIN_CALIBRATION_SAMPLE),
    map,
  };
}
