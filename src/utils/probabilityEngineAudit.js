/**
 * Probability engine audit logging — per-prop traces and refresh summaries.
 */

import { resolvePropConfidence, resolvePropProbability } from "./tierClassification.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveProjection(prop = {}) {
  return finite(prop.projection ?? prop.projectedValue);
}

function resolveLine(prop = {}) {
  return finite(prop.line);
}

export function buildProjectedPropProbabilityRow(prop = {}) {
  const calibration = prop.probabilityCalibration || {};
  const debug = prop.probabilityDebug || {};
  const projection = resolveProjection(prop);
  const line = resolveLine(prop);

  return {
    player: prop.playerName || prop.player || "Unknown",
    market: prop.statType || prop.market || prop.propType || "—",
    projection,
    line,
    edge: debug.edge ?? prop.edgePercent ?? prop.relativeEdgePercent ?? null,
    rawProbability:
      debug.rawProbability ??
      calibration.rawProbability ??
      calibration.prePenaltyProbability ??
      null,
    adjustedProbability:
      debug.adjustedProbability ??
      calibration.penalizedProbability ??
      null,
    finalProbability:
      debug.finalProbability ??
      resolvePropProbability(prop) ??
      calibration.probability ??
      null,
    rawConfidence: debug.rawConfidence ?? prop.confidenceBreakdown?.afterPenalties ?? null,
    finalConfidence: debug.finalConfidence ?? resolvePropConfidence(prop) ?? null,
    probabilityFloorApplied: debug.probabilityFloorApplied ?? null,
    historicalPenalty: debug.historicalPenalty ?? 0,
    pitcherPenalty: debug.pitcherPenalty ?? 0,
    historicalStatus: prop.historicalStatus || debug.historicalStatus || "neutral",
  };
}

export function logProjectedPropProbabilityAudit(props = []) {
  const rows = (props || [])
    .filter((prop) => resolveProjection(prop) != null && resolveProjection(prop) > 0)
    .map((prop) => buildProjectedPropProbabilityRow(prop));

  for (const row of rows) {
    console.info("[MLB Probability] projected prop", row);
  }

  return rows;
}

export function summarizeProbabilityEngine(props = [], { verifiedCount = 0, failedProbability = 0 } = {}) {
  const projected = (props || []).filter(
    (prop) => resolveProjection(prop) != null && resolveProjection(prop) > 0
  );
  const probabilities = projected
    .map((prop) => resolvePropProbability(prop))
    .filter((value) => Number.isFinite(value));

  const averageProbability = probabilities.length
    ? Math.round((probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length) * 10) / 10
    : null;
  const highestProbability = probabilities.length ? Math.max(...probabilities) : null;

  return {
    projectedProps: projected.length,
    verifiedProps: verifiedCount,
    failedProbability,
    averageProbability,
    highestProbability,
  };
}

export function logProbabilityEngineSummary(props = [], options = {}) {
  const summary = summarizeProbabilityEngine(props, options);
  console.info("[MLB Probability] refresh summary", summary);
  return summary;
}
