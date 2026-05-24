import { canonicalMarketKey } from "./marketNormalization.js";
import { normalizeSource } from "./normalizeSource.js";
import { resolvePlayerRole } from "./propPlayerRole.js";
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
import { isTopMlbPlayRankable } from "./mlbRankableProp.js";

const UNDER_SIDE_BOOST = 18;
const UNDER_MARKET_BOOST = 12;
const PITCHER_K_UNDER_BOOST = 10;
const FANTASY_UNDER_BOOST = 8;
const OUTS_UNDER_BOOST = 8;
const ER_UNDER_BOOST = 8;
const WALKS_UNDER_BOOST = 6;
const HITTER_K_UNDER_BOOST = 6;

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function statBlob(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "").toLowerCase();
}

function isPitcherStrikeoutMarket(prop = {}) {
  const key = canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
  return key === "strikeouts" || /pitcher\s*strikeout|strikeouts?\s*thrown/i.test(statBlob(prop));
}

function isHitterStrikeoutMarket(prop = {}) {
  return resolvePlayerRole(prop) === "hitter" && /strikeout|\bk\b/.test(statBlob(prop));
}

function isHrMarket(prop = {}) {
  const key = canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
  return key === "homeruns" || /home\s*run|\bhr\b/.test(statBlob(prop));
}

export function computeTopMlbPlayRankScore(prop = {}) {
  const evaluation = prop.sideEvaluation || evaluateBothSides(prop);
  if (!isTopMlbPlayRankable(prop)) return -Infinity;

  let score = Number.isFinite(evaluation.rankScore) && evaluation.rankScore > -Infinity
    ? evaluation.rankScore
    : 0;

  const confidence = finiteOr(evaluation.confidence ?? prop.confidenceScore ?? prop.confidence, NaN);
  const edge = finiteOr(evaluation.edge, 0);

  if (!Number.isFinite(confidence) || edge <= 0) return -Infinity;

  score += confidence * 0.35;
  score += edge * 4;

  if (evaluation.recommendedSide === "UNDER") {
    score += UNDER_SIDE_BOOST;
    if (isUnderPreferredMarket(prop)) score += UNDER_MARKET_BOOST;
    if (isPitcherStrikeoutMarket(prop)) score += PITCHER_K_UNDER_BOOST;
    if (isHitterStrikeoutMarket(prop)) score += HITTER_K_UNDER_BOOST;
    if (/fantasy/.test(statBlob(prop))) score += FANTASY_UNDER_BOOST;
    if (/outs?\s*recorded|pitching\s*outs/.test(statBlob(prop))) score += OUTS_UNDER_BOOST;
    if (/earned\s*run/.test(statBlob(prop))) score += ER_UNDER_BOOST;
    if (/walks?\s*allowed/.test(statBlob(prop))) score += WALKS_UNDER_BOOST;
  }

  if (resolveProjectionQuality(prop) === PROJECTION_QUALITY.MISSING) {
    return -Infinity;
  }

  if (normalizeSource(prop) === "underdog") score += 1;
  if (normalizeSource(prop) === "prizepicks") score += 0.5;

  return score;
}

export function prepareTopMlbPlayProps(props = []) {
  return (props || []).map((prop) => (prop.sideEvaluation ? prop : enrichPropWithSideEvaluation(prop)));
}

export function sortTopMlbPlays(props = []) {
  return prepareTopMlbPlayProps(props)
    .filter(isTopMlbPlayRankable)
    .sort(
      (a, b) =>
        computeTopMlbPlayRankScore(b) - computeTopMlbPlayRankScore(a) ||
        finiteOr(b.confidenceScore ?? b.confidence) - finiteOr(a.confidenceScore ?? a.confidence) ||
        computeAbsoluteProjectionEdge(b) - computeAbsoluteProjectionEdge(a)
    );
}

export { isHrMarket, isPitcherStrikeoutMarket };
