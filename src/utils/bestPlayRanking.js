import { resolvePickSide } from "./pickRecommendation.js";
import { canonicalMarketKey } from "./marketNormalization.js";
import { normalizeSource } from "./normalizeSource.js";

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

const UNDER_PREFERENCE_BOOST = 8;
const STRONG_OVER_EDGE = 1.25;

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function marketKey(prop = {}) {
  return canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
}

function isUnderPreferredMarket(prop = {}) {
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

function isUnderSide(prop = {}) {
  const side = resolvePickSide(prop);
  return side === "UNDER";
}

function isOverSide(prop = {}) {
  const side = resolvePickSide(prop);
  return side === "OVER";
}

/** Rank score for Best Plays — PP + Underdog combined, with Under preference on MLB markets. */
export function computeBestPlayRankScore(prop = {}) {
  const confidence = finiteOr(prop.confidenceScore ?? prop.confidence, 50);
  const edge = finiteOr(prop.edge ?? prop.projectionEdge, 0);
  const line = finiteOr(prop.line, 1);
  const projection = finiteOr(prop.projection ?? prop.projectedValue, line);
  const edgePct = line > 0 ? (Math.abs(edge) / line) * 100 : 0;

  let score = confidence * 0.4 + edgePct * 0.45 + (prop.isDisplayPlayable ? 5 : 0);

  if (normalizeSource(prop) === "underdog") score += 1.5;
  if (normalizeSource(prop) === "prizepicks") score += 1;

  if (isUnderSide(prop)) {
    if (projection < line) score += 4;
    if (isUnderPreferredMarket(prop)) score += UNDER_PREFERENCE_BOOST;
  } else if (isOverSide(prop)) {
    if (edge < STRONG_OVER_EDGE) score -= 5;
    else if (edge >= STRONG_OVER_EDGE * 2) score += 2;
  }

  return score;
}

export function sortBestPlayProps(props = []) {
  return [...(props || [])].sort(
    (a, b) =>
      computeBestPlayRankScore(b) - computeBestPlayRankScore(a) ||
      finiteOr(b.confidenceScore ?? b.confidence) - finiteOr(a.confidenceScore ?? a.confidence) ||
      finiteOr(b.edge) - finiteOr(a.edge)
  );
}

export function readPropMultiplier(prop = {}) {
  const side = resolvePickSide(prop);
  const options = prop.streakOptions || [];
  const match = options.find((opt) => {
    const label = String(opt.side || opt.label || "").toLowerCase();
    if (side === "OVER") return label.includes("higher") || label.includes("over") || label.includes("more");
    if (side === "UNDER") return label.includes("lower") || label.includes("under") || label.includes("less");
    return false;
  });
  const mult = Number(match?.multiplier ?? prop.multiplier ?? prop.payout ?? prop.payoutMultiplier);
  return Number.isFinite(mult) && mult > 0 && mult !== 1 ? mult : null;
}

export function readPropProbability(prop = {}) {
  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, null);
  if (Number.isFinite(conf)) return Math.round(conf);
  const options = prop.streakOptions || [];
  const side = resolvePickSide(prop);
  const match = options.find((opt) => {
    const label = String(opt.side || opt.label || "").toLowerCase();
    if (side === "OVER") return label.includes("higher") || label.includes("over") || label.includes("more");
    return label.includes("lower") || label.includes("under") || label.includes("less");
  });
  const rawProb = Number(match?.rawProbability);
  if (Number.isFinite(rawProb) && rawProb > 0 && rawProb <= 1) return Math.round(rawProb * 100);
  return null;
}
