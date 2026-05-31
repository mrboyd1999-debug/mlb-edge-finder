/**
 * Live confidence from real signals — not synthetic defaults.
 */

import { computeEdgeBasedConfidence } from "./mlbEdgeConfidence.js";
import { resolveProjectionValue } from "./projectionQuality.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function computeLiveConfidence(prop = {}, edge = null) {
  const edgeVal = finiteOr(edge ?? prop.edge, 0);
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);

  if (!projection || !Number.isFinite(line)) return null;

  let score = computeEdgeBasedConfidence(prop, edgeVal) ?? 52;

  const hit10 = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  if (Number.isFinite(hit10)) {
    score += (hit10 - 0.5) * 8;
  }

  const seasonAvg = finiteOr(prop.seasonAverage ?? prop.seasonAvg, NaN);
  const last5 = finiteOr(prop.last5Average ?? prop.recentAverage, NaN);
  const benchmark = Number.isFinite(last5) ? last5 : seasonAvg;
  if (Number.isFinite(benchmark)) {
    const side = String(prop.recommendedSide || prop.side || "").toLowerCase();
    const diff = side.includes("under") ? line - benchmark : benchmark - line;
    score += Math.max(-4, Math.min(4, diff * 2));
  }

  const books = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);
  if (books >= 2) score += 2;

  const marketLine = finiteOr(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine, NaN);
  if (Number.isFinite(marketLine) && Math.abs(line - marketLine) >= 0.25) {
    score += line < marketLine ? 1 : -1;
  }

  const matchup = String(prop.matchupNote || prop.matchupRating || "").toLowerCase();
  if (/favorable|weak|pitchable/.test(matchup)) score += 2;
  if (/tough|elite/.test(matchup)) score -= 2;

  if (!isVerifiedSportsbookProp(prop)) score = Math.min(score, 58);

  return Math.max(50, Math.min(85, Math.round(score)));
}
