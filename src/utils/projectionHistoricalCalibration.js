/**
 * Keep projections anchored to Last5 / Last10 / Season when historical stats exist.
 */

export const PROJECTION_MISMATCH_FLAG = "ProjectionMismatch";

export const HISTORICAL_PROJECTION_MULTIPLIERS = {
  last5: 1.35,
  last10: 1.3,
  season: 1.4,
};

export const CALIBRATION_DEVIATION_THRESHOLDS = {
  noneMax: 0.15,
  smallMax: 0.3,
};

export const CALIBRATION_CONFIDENCE_PENALTIES = {
  none: 0,
  small: 8,
  large: 18,
};

export const CALIBRATION_PLAYABILITY_PENALTIES = {
  none: 0,
  small: 6,
  large: 14,
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round1Pct(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return Math.round(ratio * 1000) / 10;
}

/** max(Last5×1.35, Last10×1.30, Season×1.40) for available averages. */
export function resolveHistoricalProjectionCap({ last5 = null, last10 = null, season = null } = {}) {
  const caps = [];
  const l5 = finite(last5);
  const l10 = finite(last10);
  const s = finite(season);
  if (l5 != null && l5 > 0) caps.push(l5 * HISTORICAL_PROJECTION_MULTIPLIERS.last5);
  if (l10 != null && l10 > 0) caps.push(l10 * HISTORICAL_PROJECTION_MULTIPLIERS.last10);
  if (s != null && s > 0) caps.push(s * HISTORICAL_PROJECTION_MULTIPLIERS.season);
  return caps.length ? Math.max(...caps) : null;
}

function resolveHistoricalBaseline({ last5 = null, last10 = null, season = null } = {}) {
  const values = [finite(last5), finite(last10), finite(season)].filter((value) => value != null && value > 0);
  if (!values.length) return null;
  return Math.max(...values);
}

function resolveCalibrationTier(overDeviationRatio) {
  if (overDeviationRatio == null || overDeviationRatio < CALIBRATION_DEVIATION_THRESHOLDS.noneMax) {
    return "none";
  }
  if (overDeviationRatio < CALIBRATION_DEVIATION_THRESHOLDS.smallMax) {
    return "small";
  }
  return "large";
}

/**
 * @returns calibration result when at least one historical average exists.
 */
export function resolveProjectionHistoricalCalibration(projection, { last5 = null, last10 = null, season = null } = {}) {
  const proj = finite(projection);
  const baseline = resolveHistoricalBaseline({ last5, last10, season });
  const historicalCap = resolveHistoricalProjectionCap({ last5, last10, season });

  if (proj == null || baseline == null) {
    return {
      historicalCap,
      historicalBaseline: baseline,
      deviationPct: null,
      calibrationTier: "none",
      projectionMismatch: false,
      confidencePenalty: 0,
      playabilityPenalty: 0,
      mismatchFlags: [],
    };
  }

  const overDeviationRatio = proj > baseline ? (proj - baseline) / baseline : 0;
  const calibrationTier = resolveCalibrationTier(overDeviationRatio);
  const projectionMismatch = historicalCap != null && proj > historicalCap + 1e-9;

  const tierForPenalty = projectionMismatch ? "large" : calibrationTier;

  return {
    historicalCap,
    historicalBaseline: baseline,
    deviationPct: round1Pct(overDeviationRatio),
    calibrationTier,
    projectionMismatch,
    confidencePenalty: CALIBRATION_CONFIDENCE_PENALTIES[tierForPenalty] ?? 0,
    playabilityPenalty: CALIBRATION_PLAYABILITY_PENALTIES[tierForPenalty] ?? 0,
    mismatchFlags: projectionMismatch ? [PROJECTION_MISMATCH_FLAG] : [],
  };
}
