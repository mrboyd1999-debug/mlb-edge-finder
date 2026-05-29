/**
 * Stat-specific MLB probability from rolling averages (not generic edge-only math).
 */

import { canonicalMarketKey } from "./marketNormalization.js";
import { computeStandardEdge } from "./standardPropMetrics.js";

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

function probabilityFromBaseline(baseline, line, projection) {
  const base = finite(baseline);
  const ln = finite(line);
  const proj = finite(projection);
  if (base == null || ln == null || ln <= 0) return null;

  const anchor = proj ?? base;
  const edge = computeStandardEdge(anchor, ln) ?? anchor - ln;
  const edgePct = Math.abs(edge) / ln;
  const directionStrength = Math.min(edgePct / 0.25, 1);
  const baselineGap = Math.abs(base - ln) / ln;
  const rollingStrength = Math.min(baselineGap / 0.2, 1);

  let probability = 50 + directionStrength * 18 + rollingStrength * 10;
  if (Math.sign(edge) === Math.sign(base - ln)) probability += 3;
  return clamp(Math.round(probability), 50, 82);
}

export function computeStatSpecificProbability(prop = {}, projection = null, line = null) {
  const ln = finite(line ?? prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  if (ln == null || ln <= 0) return null;

  const marketKey = canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
  let baseline = null;

  switch (marketKey) {
    case "hitsAllowed":
      baseline = resolveRollingBaseline(prop, true);
      break;
    case "strikeouts":
      baseline = resolveRollingBaseline(prop, true);
      break;
    case "hrr":
      baseline = resolveRollingBaseline(prop, false);
      break;
    case "totalBases":
      baseline = resolveRollingBaseline(prop, false);
      break;
    default:
      baseline = resolveRollingBaseline(prop, false);
      break;
  }

  return probabilityFromBaseline(baseline, ln, proj);
}
