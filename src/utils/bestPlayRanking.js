/**
 * Best Plays qualification helpers — lean direction, edge magnitude, weighted rank score.
 */

import { resolveProjectionValue, computeAbsoluteProjectionEdge } from "./projectionQuality.js";
import { isPitcherStrikeoutMarket } from "./topMlbPlaysRanking.js";
import { isMlbPitcherMarket } from "../modules/mlbPitcherData.js";

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isHitterMarket(prop = {}) {
  return !isMlbPitcherMarket(prop.statType || prop.market || prop.propType || "");
}

/** OVER when projection > line; UNDER when projection < line. */
export function resolveLeanDirection(prop = {}) {
  const projection = resolveProjectionValue(prop);
  const line = Number(prop.line);
  if (projection == null || !Number.isFinite(line) || line <= 0) return null;
  if (Math.abs(projection - line) < 0.04) return "PASS";
  return projection > line ? "OVER" : "UNDER";
}

/** Magnitude of projection vs line — always positive for playable leans. */
export function resolveEdgeMagnitude(prop = {}) {
  const absFromLine = computeAbsoluteProjectionEdge(prop);
  if (absFromLine > 0) return absFromLine;
  const edge = finiteOr(prop.edge ?? prop.rawEdge, NaN);
  return Number.isFinite(edge) ? Math.abs(edge) : 0;
}

export function computeRecentFormScore(prop = {}) {
  const line = Number(prop.line);
  const lean = resolveLeanDirection(prop);
  const last5 = finiteOr(prop.last5Average ?? prop.recentForm, NaN);
  const last10 = finiteOr(prop.last10Average, NaN);
  const hitRate = finiteOr(prop.last10HitRate ?? prop.last5HitRate ?? prop.recentHitRate, NaN);

  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0 && lean && lean !== "PASS") {
    const favor = lean === "UNDER" ? line - last5 : last5 - line;
    return Math.max(0, Math.min(100, 50 + favor * 10));
  }
  if (Number.isFinite(last10) && Number.isFinite(line) && line > 0 && lean && lean !== "PASS") {
    const favor = lean === "UNDER" ? line - last10 : last10 - line;
    return Math.max(0, Math.min(100, 50 + favor * 8));
  }
  if (Number.isFinite(hitRate)) return Math.max(0, Math.min(100, hitRate * 100));
  const sample = Number(prop.sampleSize || 0);
  if (sample >= 8) return 62;
  if (sample >= 5) return 55;
  if (sample >= 3) return 48;
  return 40;
}

/** rankScore = (confidence * 0.45) + (abs(edge) * 35) + (recentFormScore * 0.20) */
export function computeBestPlayRankScore(prop = {}) {
  const confidence = finiteOr(prop.confidenceScore ?? prop.confidence, 0);
  const edgeMag = resolveEdgeMagnitude(prop);
  const recentFormScore = computeRecentFormScore(prop);
  return confidence * 0.45 + edgeMag * 35 + recentFormScore * 0.2;
}

export function buildMarketContextNote(prop = {}) {
  const parts = [];
  if (isPitcherStrikeoutMarket(prop) || isMlbPitcherMarket(prop.statType || "")) {
    const oppK =
      prop.opponentContext?.strikeoutsPerGame ??
      prop.opponentStrikeoutRate ??
      prop.opponentContext?.note;
    if (oppK != null && oppK !== "") parts.push(typeof oppK === "number" ? `Opp K/G ${oppK}` : String(oppK));
    if (prop.last5Average != null) parts.push(`L5 K ${prop.last5Average}`);
    if (prop.seasonAverage != null) parts.push(`Season ${prop.seasonAverage}`);
    const trend = prop.pitchCountTrend?.label || prop.pitchCountTrend;
    if (trend) parts.push(String(trend));
    if (prop.projectedInnings != null) parts.push(`Proj IP ${prop.projectedInnings}`);
  } else if (isHitterMarket(prop)) {
    if (prop.last10Average != null) parts.push(`L10 avg ${prop.last10Average}`);
    else if (prop.last5Average != null) parts.push(`L5 avg ${prop.last5Average}`);
    if (prop.matchupNote) parts.push(prop.matchupNote);
    if (prop.battingOrder || prop.lineupSlot) parts.push(`Order ${prop.battingOrder || prop.lineupSlot}`);
    if (prop.handednessMatchup) parts.push(prop.handednessMatchup);
  }
  return parts.filter(Boolean).join(" · ");
}

export function enrichBestPlayRankingFields(prop = {}) {
  const leanDirection = resolveLeanDirection(prop);
  const edgeMagnitude = resolveEdgeMagnitude(prop);
  const rankScore = computeBestPlayRankScore(prop);
  const marketContext = buildMarketContextNote(prop);
  return {
    ...prop,
    leanDirection,
    edgeMagnitude,
    rankScore,
    marketContext,
    recommendedSide: prop.recommendedSide || (leanDirection === "PASS" ? null : leanDirection),
  };
}
