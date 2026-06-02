import { resolvePropMarketKey } from "./marketNormalization.js";
import { normalizeSource } from "./normalizeSource.js";
import { resolvePlayerRole } from "./propPlayerRole.js";
import { computeBestPlayRankScore, resolveEdgeMagnitude } from "./bestPlayRanking.js";
import { PROJECTION_QUALITY, resolveProjectionQuality } from "./projectionQuality.js";
import {
  enrichPropWithSideEvaluation,
  evaluateBothSides,
  isUnderPreferredMarket,
} from "./sideEvaluationEngine.js";
import { isTopMlbPlayRankable, isRelaxedRankable } from "./mlbRankableProp.js";

const UNDER_SIDE_BOOST = 18;

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function statBlob(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "").toLowerCase();
}

function isPitcherStrikeoutMarket(prop = {}) {
  const key = resolvePropMarketKey(prop);
  return key === "strikeouts" || /pitcher\s*strikeout|strikeouts?\s*thrown/i.test(statBlob(prop));
}

function isFantasyMarket(prop = {}) {
  return /fantasy/.test(statBlob(prop));
}

function isTotalBasesMarket(prop = {}) {
  const key = resolvePropMarketKey(prop);
  return key === "totalbases" || /total\s*bases?/.test(statBlob(prop));
}

function isHrrMarket(prop = {}) {
  const key = resolvePropMarketKey(prop);
  return key === "hrr" || /hits?\s*(\+|and|&)\s*runs?\s*(\+|and|&)\s*rbis?/.test(statBlob(prop));
}

function isEarnedRunMarket(prop = {}) {
  return /earned\s*run/.test(statBlob(prop));
}

function isWalkMarket(prop = {}) {
  return /walks?\s*allowed/.test(statBlob(prop)) || (resolvePlayerRole(prop) === "pitcher" && /\bwalk/.test(statBlob(prop)));
}

/** Unders priority tier — higher = sort first. */
export function underPriorityTier(prop = {}) {
  if (prop.recommendedSide !== "UNDER") return 0;
  if (isPitcherStrikeoutMarket(prop)) return 6;
  if (isFantasyMarket(prop)) return 5;
  if (isTotalBasesMarket(prop)) return 4;
  if (isHrrMarket(prop)) return 3;
  if (isEarnedRunMarket(prop)) return 2;
  if (isWalkMarket(prop)) return 1;
  return isUnderPreferredMarket(prop) ? 1 : 0;
}

export function computeTopMlbPlayRankScore(prop = {}, { relaxed = false } = {}) {
  const rankable = relaxed ? isRelaxedRankable : isTopMlbPlayRankable;
  const evaluation = prop.sideEvaluation || evaluateBothSides(prop);
  if (!rankable(prop)) return -Infinity;

  const confidence = finiteOr(evaluation.confidence ?? prop.confidenceScore ?? prop.confidence, NaN);
  const edgeMag = resolveEdgeMagnitude({ ...prop, edge: evaluation.edge });
  const minEdge = relaxed ? 0.15 : 0.3;

  if (!Number.isFinite(confidence) || edgeMag < minEdge) return -Infinity;

  let score = computeBestPlayRankScore({
    ...prop,
    confidenceScore: confidence,
    edge: edgeMag,
  });

  if (Number.isFinite(evaluation.rankScore) && evaluation.rankScore > -Infinity) {
    score = (score + evaluation.rankScore) / 2;
  }
  score += underPriorityTier(prop) * 8;

  if (evaluation.recommendedSide === "UNDER") {
    score += UNDER_SIDE_BOOST;
  }

  if (resolveProjectionQuality(prop) === PROJECTION_QUALITY.MISSING && !prop.isDemoData && !relaxed) {
    return -Infinity;
  }

  if (normalizeSource(prop) === "underdog") score += 1;
  if (normalizeSource(prop) === "prizepicks") score += 0.5;

  return score;
}

export function prepareTopMlbPlayProps(props = []) {
  return (props || []).map((prop) => (prop.sideEvaluation ? prop : enrichPropWithSideEvaluation(prop)));
}

export function sortTopMlbPlays(props = [], { relaxed = false } = {}) {
  const isRankable = relaxed ? isRelaxedRankable : isTopMlbPlayRankable;
  return prepareTopMlbPlayProps(props)
    .filter(isRankable)
    .sort(
      (a, b) =>
        underPriorityTier(b) - underPriorityTier(a) ||
        computeTopMlbPlayRankScore(b, { relaxed }) - computeTopMlbPlayRankScore(a, { relaxed }) ||
        finiteOr(b.confidenceScore ?? b.confidence) - finiteOr(a.confidenceScore ?? a.confidence) ||
        resolveEdgeMagnitude(b) - resolveEdgeMagnitude(a)
    );
}

export { isPitcherStrikeoutMarket };
