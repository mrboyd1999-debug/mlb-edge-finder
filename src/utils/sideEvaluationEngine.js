/**
 * Dual-side evaluation — recommendation follows projection vs line; under preference affects rank only.
 */

import { canonicalMarketKey } from "./marketNormalization.js";
import {
  hasRenderableProjection,
  resolveProjectionQuality,
  resolveProjectionValue,
  PROJECTION_QUALITY,
} from "./projectionQuality.js";
import { recommendSideFromProjection } from "./propSanity.js";
import { resolvePlayerRole } from "./propPlayerRole.js";
import { computeEdgeBasedConfidence } from "./mlbEdgeConfidence.js";

export const TIER_STRONG = 80;
export const TIER_PLAYABLE = 70;
export const TIER_LEAN = 60;
export const PASS_CONFIDENCE_GAP = 5;

const UNDER_PREFERENCE_BOOST = 10;
const UNDER_MARKET_BONUS = 6;
const WEAK_HALF_LINE = 0.5;
const WEAK_HALF_EDGE = 0.7;

const UNDER_PREFERRED_MARKETS = new Set([
  "hrr",
  "hits",
  "runs",
  "rbis",
  "rbi",
  "totalbases",
  "fantasyscore",
  "fantasy",
]);

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function statBlob(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "").toLowerCase();
}

function marketKey(prop = {}) {
  return canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
}

export function isUnderPreferredMarket(prop = {}) {
  const key = marketKey(prop);
  if (key === "strikeouts" || /pitcher\s*strikeout/.test(statBlob(prop))) {
    return resolvePlayerRole(prop) === "pitcher";
  }
  if (UNDER_PREFERRED_MARKETS.has(key)) return true;
  const compact = key.replace(/[^a-z0-9]/g, "");
  return (
    compact.includes("hitsrunsrbis") ||
    compact.includes("totalbases") ||
    compact.includes("fantasy") ||
    compact === "hits" ||
    compact === "runs" ||
    compact === "rbis"
  );
}

export function confidenceTierFromScore(score = 0) {
  const conf = finiteOr(score, 0);
  if (conf >= TIER_STRONG) return "Strong Play";
  if (conf >= TIER_PLAYABLE) return "Playable";
  if (conf >= TIER_LEAN) return "Lean";
  return "Research Only";
}

export function isResearchTier(score = 0) {
  return finiteOr(score, 0) < TIER_LEAN;
}

/** Signed edge for a side: positive = that side is favored. */
export function sideEdge(projection, line, side = "OVER") {
  const proj = Number(projection);
  const ln = Number(line);
  if (!Number.isFinite(proj) || proj <= 0 || !Number.isFinite(ln)) return 0;
  return side === "UNDER" ? ln - proj : proj - ln;
}

export function varianceLevel(prop = {}) {
  const stat = statBlob(prop);
  if (/home run|\bhr\b|triple|first inning|1st inning|inning 1|walks?\s*allowed/.test(stat)) {
    return "High";
  }
  const vol = finiteOr(prop.volatility ?? prop.marketVolatility, NaN);
  if (Number.isFinite(vol) && vol >= 4) return "High";
  if (Number.isFinite(vol) && vol >= 2.5) return "Medium";
  if (/strikeout|earned run|total bases/.test(stat)) return "Medium";
  return "Low";
}

export function variancePenalty(prop = {}) {
  const level = varianceLevel(prop);
  if (level === "High") return 12;
  if (level === "Medium") return 5;
  return 0;
}

function clearsRate(rate, side = "OVER") {
  if (!Number.isFinite(rate)) return false;
  return side === "OVER" ? rate >= 0.58 : rate <= 0.42;
}

export function consistencyScore(prop = {}, side = "OVER", line = 0) {
  let score = 0;
  const l10 = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  const l5 = finiteOr(prop.last5HitRate, NaN);

  if (clearsRate(l10, side)) score += 5;
  else if (Number.isFinite(l10) && l10 <= 0.32) score -= 4;

  if (clearsRate(l5, side)) score += 3;
  else if (Number.isFinite(l5) && l5 <= 0.3) score -= 2;

  const matchup = String(prop.matchupNote || prop.matchupRating || "").toLowerCase();
  if (/favorable|weak|bottom|pitchable/.test(matchup)) score += 3;
  if (/tough|elite|top/.test(matchup)) score -= 3;

  const split = String(prop.homeAwaySplit || prop.splitNote || prop.formNote || "").toLowerCase();
  if (/favorable split|vs lhp|vs rhp|handedness|platoon/.test(split)) score += 2;

  const order = String(prop.battingOrder || prop.lineupSlot || prop.formNote || "");
  if (/top of order|^1-|^[123]-|cleanup|heart of/.test(order)) score += 2;

  const stat = statBlob(prop);
  const kNote = String(prop.opponentStrikeoutRate || prop.matchupNote || "");
  if (/strikeout|pitcher/.test(stat) && /k rate|whiff|strikeout/.test(kNote)) score += 3;

  const seasonAvg = finiteOr(prop.seasonAverage ?? prop.seasonAvg, NaN);
  const last5Avg = finiteOr(prop.last5Average ?? prop.recentAverage, NaN);
  const benchmark = Number.isFinite(last5Avg) ? last5Avg : seasonAvg;
  if (Number.isFinite(benchmark) && Number.isFinite(line) && line > 0) {
    const diff = side === "OVER" ? benchmark - line : line - benchmark;
    score += Math.max(-4, Math.min(4, diff * 2));
  }

  const dataQuality = finiteOr(prop.dataQualityScore, NaN);
  if (Number.isFinite(dataQuality)) {
    score += Math.max(-2, Math.min(3, (dataQuality - 50) * 0.06));
  }

  return score;
}

function projectionQualityScore(prop = {}) {
  const projection = Number(prop.projection ?? prop.projectedValue);
  const line = Number(prop.line);
  if (!Number.isFinite(projection) || projection <= 0 || !Number.isFinite(line) || line <= 0) return 0;
  const gapPct = Math.abs(projection - line) / line;
  if (gapPct >= 0.15) return 8;
  if (gapPct >= 0.08) return 5;
  if (gapPct >= 0.04) return 2;
  return 0;
}

function hasMeaningfulRecentStats(prop = {}) {
  return (
    Number.isFinite(Number(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate)) ||
    Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0) >= 5 ||
    Boolean(prop.sportsDataSeason || prop.sportsDataRecentGames?.length)
  );
}

function sideConfidence(prop = {}, side = "OVER", edge = 0) {
  return computeEdgeBasedConfidence(prop, edge);
}

function sideRankScore(prop = {}, side = "OVER") {
  const projection = resolveProjectionValue(prop);
  const line = Number(prop.line);
  const edge = sideEdge(projection, line, side);
  const edgePct = line > 0 ? (Math.max(0, edge) / line) * 100 : 0;
  const confidence = sideConfidence(prop, side, edge);
  if (confidence == null) {
    return {
      side,
      edge: round2(edge),
      edgePct: round2(edgePct),
      confidence: null,
      rankScore: -Infinity,
      tier: "Insufficient data",
    };
  }

  let score = confidence * 0.42 + edgePct * 0.38 + consistencyScore(prop, side, line) * 0.9;
  score += projectionQualityScore(prop);
  score -= variancePenalty(prop);

  if (side === "UNDER") {
    score += UNDER_PREFERENCE_BOOST;
    if (isUnderPreferredMarket(prop)) score += UNDER_MARKET_BONUS;
  }

  if (line === WEAK_HALF_LINE && Math.abs(edge) < WEAK_HALF_EDGE) {
    score -= 8;
  }

  const payout = finiteOr(prop.multiplier ?? prop.payout, NaN);
  if (Number.isFinite(payout) && payout > 1 && payout !== 1) {
    score += Math.min(4, (payout - 1) * 3);
  }

  return {
    side,
    edge: round2(edge),
    edgePct: round2(edgePct),
    confidence,
    rankScore: round2(score),
    tier: confidenceTierFromScore(confidence),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function evaluateBothSides(prop = {}) {
  const projection = resolveProjectionValue(prop);
  const hasProjection = projection != null;

  if (!hasProjection) {
    return {
      recommendedSide: "PASS",
      pass: true,
      over: null,
      under: null,
      edge: 0,
      confidence: null,
      tier: "Insufficient data",
      varianceLevel: varianceLevel(prop),
      reason: "Projection unavailable",
      rankScore: -Infinity,
      estimatedProjection: false,
    };
  }
  const quality = resolveProjectionQuality(prop);
  const estimated = quality === PROJECTION_QUALITY.ESTIMATED;
  const evalProp = { ...prop, projection, estimatedProjection: estimated };
  const line = finiteOr(prop.line, 0);

  const mathPick = recommendSideFromProjection(evalProp);
  if (mathPick.side === "PASS" || mathPick.edge <= 0) {
    return {
      recommendedSide: "PASS",
      pass: true,
      over: sideRankScore(evalProp, "OVER"),
      under: sideRankScore(evalProp, "UNDER"),
      edge: 0,
      confidence: null,
      tier: "Insufficient data",
      varianceLevel: varianceLevel(prop),
      reason: "Insufficient data — projection equals line",
      rankScore: -Infinity,
      estimatedProjection: estimated,
    };
  }

  const chosen = sideRankScore(evalProp, mathPick.side);
  const over = sideRankScore(evalProp, "OVER");
  const under = sideRankScore(evalProp, "UNDER");

  const sideLabel = mathPick.side === "UNDER" ? "Less/Lower" : "More/Higher";
  const reason = `${sideLabel} · projection ${projection} vs line ${line} (+${mathPick.edge.toFixed(1)} edge)`;

  return {
    recommendedSide: mathPick.side,
    pass: false,
    over,
    under,
    edge: mathPick.edge,
    confidence: chosen.confidence,
    tier: chosen.tier,
    varianceLevel: varianceLevel(prop),
    reason,
    rankScore: chosen.rankScore,
    estimatedProjection: estimated,
    consistency: consistencyScore(evalProp, mathPick.side, line),
  };
}

export function enrichPropWithSideEvaluation(prop = {}) {
  const evaluation = evaluateBothSides(prop);
  const sidePick =
    evaluation.recommendedSide === "OVER"
      ? "over"
      : evaluation.recommendedSide === "UNDER"
        ? "under"
        : "";

  const tier = evaluation.pass
    ? "Insufficient data"
    : evaluation.confidence == null
      ? "Insufficient data"
      : confidenceTierFromScore(evaluation.confidence);
  const displayResearchOnly =
    evaluation.pass ||
    evaluation.confidence == null ||
    evaluation.confidence < 55 ||
    finiteOr(evaluation.edge, 0) < 0.3 ||
    resolveProjectionQuality(prop) === PROJECTION_QUALITY.MISSING;

  return {
    ...prop,
    estimatedProjection: evaluation.estimatedProjection || prop.estimatedProjection,
    projectionLabel: evaluation.pass
      ? "Projection unavailable"
      : evaluation.estimatedProjection
        ? "Estimated projection"
        : prop.projectionLabel || "Verified Projection",
    recommendedSide: evaluation.recommendedSide,
    side: sidePick || prop.side || "",
    pick: sidePick || prop.pick || "",
    bestPick: sidePick || prop.bestPick || "",
    overUnder: sidePick || prop.overUnder || "",
    edge: evaluation.pass ? 0 : evaluation.edge ?? 0,
    projectionEdge: evaluation.edge ?? prop.projectionEdge ?? null,
    confidence: evaluation.pass ? null : evaluation.confidence ?? null,
    confidenceScore: evaluation.pass ? null : evaluation.confidence ?? null,
    confidenceTier: tier,
    bettingLabel: displayResearchOnly ? "Insufficient data" : tier,
    displayResearchOnly,
    isDisplayPlayable: !displayResearchOnly && !evaluation.pass,
    varianceLevel: evaluation.varianceLevel,
    sideEvaluation: evaluation,
    analyticsReason: evaluation.reason || prop.analyticsReason,
    reason: evaluation.reason || prop.reason,
    rankScore: evaluation.rankScore,
  };
}

export function mapEvaluationSideToPick(side = "") {
  if (side === "OVER") return "over";
  if (side === "UNDER") return "under";
  return "";
}
