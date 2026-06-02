/**
 * True MLB confidence from model probability, edge, matchup, and data quality.
 */

import { simulatePropOutcome } from "./simulationEngine.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function computeTrueMlbConfidence({
  projection,
  line,
  edge = null,
  hitRate = null,
  dataQuality = 0.5,
  volatility = 0.25,
  matchupScore = 0.5,
  side = "over",
} = {}) {
  const proj = Number(projection);
  const ln = Number(line);
  if (!Number.isFinite(proj) || !Number.isFinite(ln) || ln <= 0) {
    return {
      confidence: null,
      simulatedOverProbability: null,
      simulatedUnderProbability: null,
      reason: "missing projection or line",
    };
  }

  const simulation = simulatePropOutcome({ projection: proj, line: ln, volatility });
  const overProb = simulation.overProbability;
  const underProb = simulation.underProbability;
  const leanProb = String(side).toLowerCase().includes("under") ? underProb : overProb;

  const edgeMag = Number.isFinite(Number(edge))
    ? Math.abs(Number(edge))
    : Math.abs(proj - ln) / ln;

  const hitRateWeight = Number.isFinite(Number(hitRate)) ? Number(hitRate) : leanProb;
  const qualityWeight = clamp(Number(dataQuality) || 0.5, 0, 1);
  const matchupWeight = clamp(Number(matchupScore) || 0.5, 0, 1);

  const blended =
    (leanProb ?? 0.5) * 0.45 +
    clamp(edgeMag * 2, 0, 1) * 0.25 +
    hitRateWeight * 0.15 +
    qualityWeight * 0.1 +
    matchupWeight * 0.05;

  const confidence = Math.round(clamp(blended * 100, 35, 95));

  return {
    confidence,
    simulatedOverProbability: overProb != null ? Math.round(overProb * 100) : null,
    simulatedUnderProbability: underProb != null ? Math.round(underProb * 100) : null,
    edgeMagnitude: Number(edgeMag.toFixed(4)),
    reason: leanProb == null ? "simulation unavailable" : "computed",
  };
}
