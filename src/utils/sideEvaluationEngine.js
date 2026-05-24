/**
 * Dual-side evaluation engine — picks stronger MORE/LESS edge, favors unders, PASS on coin flips.
 */

import { canonicalMarketKey } from "./marketNormalization.js";
import { hasValidProjection } from "./propValidation.js";

export const TIER_STRONG = 80;
export const TIER_PLAYABLE = 70;
export const TIER_LEAN = 60;
export const PASS_CONFIDENCE_GAP = 5;

const UNDER_PREFERENCE_BOOST = 10;
const UNDER_MARKET_BONUS = 6;
const WEAK_HALF_LINE = 0.5;
const WEAK_HALF_EDGE = 0.7;
const WEAK_HALF_PENALTY = 14;

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

function resolveProjectionForEvaluation(prop = {}) {
  const raw = Number(prop.projection ?? prop.projectedValue);
  if (Number.isFinite(raw) && raw > 0) {
    return { projection: raw, estimated: Boolean(prop.estimatedProjection) };
  }
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) {
    return { projection: null, estimated: false };
  }
  if (isUnderPreferredMarket(prop)) {
    return { projection: line * 0.88, estimated: true };
  }
  return { projection: line * 0.96, estimated: true };
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

/** Consistency signals: L5/L10, matchup, splits, order, K tendency, handedness. */
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

function sideConfidence(prop = {}, side = "OVER", edge = 0) {
  const base = finiteOr(prop.confidenceScore ?? prop.confidence, 50);
  const line = finiteOr(prop.line, 1);
  const edgePct = line > 0 ? (Math.max(0, edge) / line) * 100 : 0;

  let conf = base * 0.55 + edgePct * 0.35 + consistencyScore(prop, side, line) * 1.2;
  conf -= variancePenalty(prop) * 0.35;
  conf += projectionQualityScore(prop);

  if (side === "UNDER") conf += 4;

  if (prop.estimatedProjection) conf = Math.min(conf, 65);
  if (!hasMeaningfulRecentStats(prop)) conf = Math.min(conf, 60);

  if (edge >= 0.5 && base >= 68) conf = Math.max(conf, 62);
  if (edge >= 0.75 && base >= 72) conf = Math.max(conf, 68);

  return Math.max(35, Math.min(88, Math.round(conf)));
}

function hasMeaningfulRecentStats(prop = {}) {
  return (
    Number.isFinite(Number(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate)) ||
    Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0) >= 5 ||
    Boolean(prop.sportsDataSeason || prop.sportsDataRecentGames?.length)
  );
}

function isLineProjectionOnly(prop = {}) {
  return !hasMeaningfulRecentStats(prop) && Number.isFinite(Number(prop.projection ?? prop.projectedValue));
}

function sideRankScore(prop = {}, side = "OVER") {
  const { projection } = resolveProjectionForEvaluation(prop);
  const line = Number(prop.line);
  const edge = sideEdge(projection, line, side);
  const edgePct = line > 0 ? (Math.max(0, edge) / line) * 100 : 0;
  const confidence = sideConfidence(prop, side, edge);

  let score = confidence * 0.42 + edgePct * 0.38 + consistencyScore(prop, side, line) * 0.9;
  score += projectionQualityScore({ ...prop, projection });
  score -= variancePenalty(prop);

  if (side === "UNDER") {
    score += UNDER_PREFERENCE_BOOST;
    if (isUnderPreferredMarket(prop)) score += UNDER_MARKET_BONUS;
  } else {
    score -= 6;
    if (edge < 1.0) score -= 4;
  }

  if (line === WEAK_HALF_LINE && Math.abs(edge) < WEAK_HALF_EDGE) {
    score -= WEAK_HALF_PENALTY * 0.5;
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
  const { projection, estimated } = resolveProjectionForEvaluation(prop);
  const evalProp = {
    ...prop,
    projection,
    estimatedProjection: estimated || prop.estimatedProjection,
  };

  if (projection == null) {
    const conf = 50;
    return {
      recommendedSide: isUnderPreferredMarket(prop) ? "UNDER" : "OVER",
      pass: false,
      over: null,
      under: null,
      edge: 0,
      confidence: conf,
      tier: "Research Only",
      varianceLevel: varianceLevel(prop),
      reason: "Limited data — default lean",
      rankScore: 40,
      estimatedProjection: true,
    };
  }

  const over = sideRankScore(evalProp, "OVER");
  const under = sideRankScore(evalProp, "UNDER");
  const line = finiteOr(prop.line, 0);
  const confGap = Math.abs(over.confidence - under.confidence);
  const scoreGap = Math.abs(over.rankScore - under.rankScore);

  const overValid = over.edge > 0;
  const underValid = under.edge > 0;

  if (!overValid && !underValid) {
    const fallback = isUnderPreferredMarket(prop) ? under : over;
    const conf = Math.min(Math.max(over.confidence, under.confidence), estimated ? 60 : 58);
    return {
      recommendedSide: fallback.side,
      pass: false,
      over,
      under,
      edge: fallback.edge,
      confidence: conf,
      tier: "Research Only",
      varianceLevel: varianceLevel(prop),
      reason: estimated ? "Estimated projection" : "Thin edge — research only",
      rankScore: Math.max(35, fallback.rankScore),
      estimatedProjection: estimated,
    };
  }

  if (confGap < PASS_CONFIDENCE_GAP && scoreGap < 3 && overValid && underValid) {
    const tiePick = under.rankScore >= over.rankScore ? under : over;
    return {
      recommendedSide: tiePick.side,
      pass: false,
      over,
      under,
      edge: tiePick.edge,
      confidence: Math.min(tiePick.confidence, 62),
      tier: confidenceTierFromScore(tiePick.confidence),
      varianceLevel: varianceLevel(prop),
      reason: tiePick.side === "UNDER" ? "Under preferred on close call" : "More/Higher on close call",
      rankScore: tiePick.rankScore,
      estimatedProjection: estimated,
    };
  }

  let chosen = null;
  if (overValid && underValid) {
    chosen = under.rankScore >= over.rankScore ? under : over;
  } else if (underValid) {
    chosen = under;
  } else {
    chosen = over;
  }

  if (line === WEAK_HALF_LINE && Math.abs(chosen.edge) < WEAK_HALF_EDGE) {
    return {
      recommendedSide: chosen.side,
      pass: false,
      over,
      under,
      edge: chosen.edge,
      confidence: Math.min(chosen.confidence, 58),
      tier: "Research Only",
      varianceLevel: varianceLevel(prop),
      reason: "Weak 0.5 line — research only",
      rankScore: Math.max(30, chosen.rankScore * 0.65),
      estimatedProjection: estimated,
    };
  }

  const reason = buildSideReason(evalProp, chosen, over, under);

  return {
    recommendedSide: chosen.side,
    pass: false,
    over,
    under,
    edge: chosen.edge,
    confidence: estimated ? Math.min(chosen.confidence, 65) : chosen.confidence,
    tier: chosen.tier,
    varianceLevel: varianceLevel(prop),
    reason: estimated ? `${reason} · Estimated projection`.replace(/^ · /, "") : reason,
    rankScore: chosen.rankScore,
    estimatedProjection: estimated,
    consistency: consistencyScore(evalProp, chosen.side, finiteOr(prop.line, 0)),
  };
}

function buildSideReason(prop, chosen, over, under) {
  const parts = [];
  const sideLabel = chosen.side === "UNDER" ? "Less/Lower" : "More/Higher";
  parts.push(`${sideLabel} +${Math.abs(chosen.edge).toFixed(1)} edge vs line`);

  const l10 = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  if (Number.isFinite(l10)) parts.push(`L10 ${Math.round(l10 * 100)}%`);

  const l5 = finiteOr(prop.last5HitRate, NaN);
  if (Number.isFinite(l5)) parts.push(`L5 ${Math.round(l5 * 100)}%`);

  if (prop.matchupNote) parts.push(String(prop.matchupNote).replace(/\.$/, ""));

  const vol = varianceLevel(prop);
  if (vol !== "Low") parts.push(`${vol} variance`);

  if (chosen.side === "UNDER" && isUnderPreferredMarket(prop)) {
    parts.push("Under-favored market");
  }

  if (over.rankScore > under.rankScore + 4 && chosen.side === "UNDER") {
    parts.push("Under preferred despite tighter More edge");
  }

  return parts.filter(Boolean).slice(0, 4).join(" · ") || `Model favors ${sideLabel}`;
}

export function enrichPropWithSideEvaluation(prop = {}) {
  const evaluation = evaluateBothSides(prop);
  const sidePick =
    evaluation.recommendedSide === "OVER"
      ? "over"
      : evaluation.recommendedSide === "UNDER"
        ? "under"
        : "";

  const tier = evaluation.pass ? "Pass" : confidenceTierFromScore(evaluation.confidence);
  const displayResearchOnly = evaluation.pass || isResearchTier(evaluation.confidence);

  return {
    ...prop,
    estimatedProjection: evaluation.estimatedProjection || prop.estimatedProjection,
    projectionLabel: evaluation.estimatedProjection ? "Estimated projection" : prop.projectionLabel || "",
    recommendedSide: evaluation.recommendedSide,
    side: sidePick || prop.side || "",
    pick: sidePick || prop.pick || "",
    bestPick: sidePick || prop.bestPick || "",
    overUnder: sidePick || prop.overUnder || "",
    edge: evaluation.edge ?? prop.edge ?? null,
    projectionEdge: evaluation.edge ?? prop.projectionEdge ?? null,
    confidence: evaluation.confidence ?? prop.confidence ?? null,
    confidenceScore: evaluation.confidence ?? prop.confidenceScore ?? null,
    confidenceTier: tier,
    bettingLabel: evaluation.pass ? "Pass" : tier,
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
