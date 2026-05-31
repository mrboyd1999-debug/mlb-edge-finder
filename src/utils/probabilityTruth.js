/**
 * Single source of truth for probability fields across all screens.
 */

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function resolveProbabilityTruth(prop = {}, audit = null) {
  const probabilityAudit = audit || prop.probabilityAudit || null;
  const calibration = prop.probabilityCalibration || probabilityAudit?.calibration || null;
  const breakdown = calibration?.breakdown || {};

  const rawProbability = round1(
    finite(calibration?.prePenaltyProbability) ??
      finite(calibration?.rawProbability) ??
      finite(probabilityAudit?.prePenaltyProbability) ??
      finite(probabilityAudit?.rawProbability) ??
      finite(breakdown.prePenaltyProbability) ??
      finite(breakdown.rawProbability)
  );

  const calibratedProbability = round1(
    finite(calibration?.probability) ??
      finite(calibration?.calibratedProbability) ??
      finite(probabilityAudit?.calibratedProbability) ??
      finite(probabilityAudit?.finalProbability) ??
      finite(prop.probabilityScore ?? prop.verifiedProbability)
  );

  const confidence = round1(
    finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence) ??
      finite(probabilityAudit?.confidence)
  );

  const modelProbability =
    calibratedProbability != null ? round1(calibratedProbability / 100) : null;

  const storedScore = finite(prop.probabilityScore ?? prop.verifiedProbability);
  const probabilityMismatch =
    calibratedProbability != null &&
    storedScore != null &&
    Math.abs(storedScore - calibratedProbability) > 2;

  return {
    rawProbability,
    calibratedProbability,
    confidence,
    probabilityScore: calibratedProbability,
    modelProbability,
    probabilityMismatch,
  };
}

export function attachProbabilityTruthFields(prop = {}, audit = null) {
  const truth = resolveProbabilityTruth(prop, audit);
  return {
    ...prop,
    rawProbability: truth.rawProbability,
    calibratedProbability: truth.calibratedProbability,
    probabilityScore: truth.calibratedProbability ?? prop.probabilityScore,
    verifiedProbability: truth.calibratedProbability ?? prop.verifiedProbability,
    modelProbability: truth.modelProbability ?? prop.modelProbability,
    displayConfidenceScore: truth.confidence ?? prop.displayConfidenceScore,
    confidenceScore: truth.confidence ?? prop.confidenceScore,
    confidence: truth.confidence ?? prop.confidence,
    probabilityTruth: truth,
  };
}
