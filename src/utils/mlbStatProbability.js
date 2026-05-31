/**
 * Stat-specific MLB probability from rolling averages and projection-line gap.
 */

import { canonicalMarketKey } from "./marketNormalization.js";
import { computeStandardEdge, computeStandardEdgePercent } from "./standardPropMetrics.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveRollingBaseline(prop = {}, preferPitcher = false) {
  const last5 = finite(prop.last5Average ?? prop.recentForm);
  const last10 = finite(prop.last10Average);
  const season = finite(prop.seasonAverage);
  if (preferPitcher) {
    return last5 ?? last10 ?? season;
  }
  return last5 ?? last10 ?? season;
}

function resolveVariancePenalty(prop = {}) {
  const vol = finite(prop.volatility ?? prop.marketVolatility);
  const sample = finite(prop.sampleSize ?? prop.gamesPlayed ?? prop.games);
  let penalty = 0;
  if (vol != null && vol >= 3) penalty += Math.min((vol - 2) * 3, 12);
  if (sample != null && sample < 8) penalty += Math.min((8 - sample) * 1.2, 8);
  return penalty;
}

function probabilityFromBaseline(baseline, line, projection, prop = {}) {
  const base = finite(baseline);
  const ln = finite(line);
  const proj = finite(projection);
  if (ln == null || ln <= 0) return null;

  const anchor = proj ?? base;
  if (anchor == null) return null;

  const edge = computeStandardEdge(anchor, ln) ?? anchor - ln;
  const edgePct = Math.abs(edge) / ln;
  const projectionStrength = Math.min(edgePct / 0.35, 1);
  let probability = 50 + projectionStrength * 38;

  if (base != null) {
    const baselineGap = Math.abs(base - ln) / ln;
    const rollingStrength = Math.min(baselineGap / 0.18, 1);
    probability += rollingStrength * 10;
    if (Math.sign(edge) === Math.sign(base - ln)) probability += 4;
  }

  const hitRate = finite(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate);
  if (hitRate != null) {
    const leanOver = edge > 0;
    const supports = leanOver ? hitRate : 1 - hitRate;
    probability += (supports - 0.5) * 18;
  }

  probability -= resolveVariancePenalty(prop);
  return clamp(Math.round(probability * 10) / 10, 50, 92);
}

export function computeStatSpecificProbability(prop = {}, projection = null, line = null) {
  const ln = finite(line ?? prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  if (ln == null || ln <= 0) return null;

  const marketKey = canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
  let baseline = null;

  switch (marketKey) {
    case "hitsAllowed":
    case "strikeouts":
      baseline = resolveRollingBaseline(prop, true);
      break;
    case "hrr":
    case "totalBases":
    default:
      baseline = resolveRollingBaseline(prop, false);
      break;
  }

  const probability = probabilityFromBaseline(baseline, ln, proj, prop);
  if (probability != null) return probability;

  if (proj == null) return null;
  const edge = computeStandardEdge(proj, ln);
  const edgePct = Math.abs(computeStandardEdgePercent(edge, ln) ?? 0);
  const projectionStrength = Math.min(edgePct / 35, 1);
  let fallback = 50 + projectionStrength * 38;
  fallback -= resolveVariancePenalty(prop);
  return clamp(Math.round(fallback), 50, 92);
}
