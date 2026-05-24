import { canonicalMarketKey } from "./marketNormalization.js";
import { normalizeSource } from "./normalizeSource.js";
import {
  computeAbsoluteProjectionEdge,
  PROJECTION_QUALITY,
  resolveProjectionQuality,
} from "./projectionQuality.js";
import {
  enrichPropWithSideEvaluation,
  evaluateBothSides,
  isUnderPreferredMarket,
} from "./sideEvaluationEngine.js";

const UNDER_SIDE_BOOST = 15;
const UNDER_MARKET_BOOST = 10;
const STRIKEOUT_UNDER_BOOST = 8;
const MISSING_PROJECTION_PENALTY = 18;
const LOW_CONFIDENCE_PENALTY = 8;
const LOW_CONFIDENCE_FLOOR = 55;

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isPitcherStrikeoutMarket(prop = {}) {
  const key = canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
  return key === "strikeouts" || /pitcher\s*strikeout|strikeouts?\s*thrown/i.test(String(prop.statType || prop.market || ""));
}

export function computeTopMlbPlayRankScore(prop = {}) {
  const evaluation = prop.sideEvaluation || evaluateBothSides(prop);
  let score = Number.isFinite(evaluation.rankScore) && evaluation.rankScore > -Infinity
    ? evaluation.rankScore
    : 45;

  const confidence = finiteOr(evaluation.confidence ?? prop.confidenceScore ?? prop.confidence, 50);
  const edge = computeAbsoluteProjectionEdge(prop) || finiteOr(evaluation.edge, 0);

  score += confidence * 0.35;
  score += edge * 4;

  if (evaluation.recommendedSide === "UNDER") score += UNDER_SIDE_BOOST;
  if (isUnderPreferredMarket(prop)) score += UNDER_MARKET_BOOST;
  if (isPitcherStrikeoutMarket(prop) && evaluation.recommendedSide === "UNDER") {
    score += STRIKEOUT_UNDER_BOOST;
  }

  if (resolveProjectionQuality(prop) === PROJECTION_QUALITY.MISSING) {
    score -= MISSING_PROJECTION_PENALTY;
  }
  if (confidence < LOW_CONFIDENCE_FLOOR) {
    score -= LOW_CONFIDENCE_PENALTY;
  }

  if (normalizeSource(prop) === "underdog") score += 1;
  if (normalizeSource(prop) === "prizepicks") score += 0.5;

  return score;
}

export function prepareTopMlbPlayProps(props = []) {
  return (props || []).map((prop) => (prop.sideEvaluation ? prop : enrichPropWithSideEvaluation(prop)));
}

export function sortTopMlbPlays(props = []) {
  return prepareTopMlbPlayProps(props).sort(
    (a, b) =>
      computeTopMlbPlayRankScore(b) - computeTopMlbPlayRankScore(a) ||
      finiteOr(b.confidenceScore ?? b.confidence) - finiteOr(a.confidenceScore ?? a.confidence) ||
      computeAbsoluteProjectionEdge(b) - computeAbsoluteProjectionEdge(a)
  );
}
