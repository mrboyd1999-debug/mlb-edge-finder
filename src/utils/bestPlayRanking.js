import { canonicalMarketKey } from "./marketNormalization.js";
import { normalizeSource } from "./normalizeSource.js";
import {
  computeCuratedPropEdge,
  isCuratedDisplayProp,
} from "./propValidation.js";
import {
  enrichPropWithSideEvaluation,
  evaluateBothSides,
  isUnderPreferredMarket,
  variancePenalty,
  TIER_LEAN,
} from "./sideEvaluationEngine.js";

export { readPropMultiplier, readPropProbability } from "./bestPlayRankingDisplay.js";

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function isRankableBestPlay(prop = {}) {
  if (!isCuratedDisplayProp(prop)) return false;
  const evaluation = prop.sideEvaluation || evaluateBothSides(prop);
  if (evaluation.pass) return false;
  if (evaluation.recommendedSide === "PASS") return false;
  return finiteOr(evaluation.confidence ?? prop.confidenceScore ?? prop.confidence, 0) >= TIER_LEAN;
}

/** Rank score — uses dual-side evaluation output when present. */
export function computeBestPlayRankScore(prop = {}) {
  if (!isRankableBestPlay(prop)) return -Infinity;

  const evaluation = prop.sideEvaluation || evaluateBothSides(prop);
  if (evaluation.rankScore != null && Number.isFinite(evaluation.rankScore)) {
    return evaluation.rankScore;
  }

  const confidence = finiteOr(evaluation.confidence ?? prop.confidenceScore ?? prop.confidence, 50);
  const line = finiteOr(prop.line, 1);
  const edge = Math.abs(evaluation.edge ?? computeCuratedPropEdge(prop) ?? 0);
  const edgePct = line > 0 ? (edge / line) * 100 : 0;

  let score = confidence * 0.42 + edgePct * 0.38;
  score -= variancePenalty(prop);
  if (normalizeSource(prop) === "underdog") score += 1.5;
  if (normalizeSource(prop) === "prizepicks") score += 1;
  if (evaluation.recommendedSide === "UNDER") {
    score += 8;
    if (isUnderPreferredMarket(prop)) score += 5;
  }

  return score;
}

export function prepareBestPlayProps(props = []) {
  return (props || []).map((prop) =>
    prop.sideEvaluation ? prop : enrichPropWithSideEvaluation(prop)
  );
}

export function sortBestPlayProps(props = []) {
  return prepareBestPlayProps(props)
    .filter(isRankableBestPlay)
    .sort(
      (a, b) =>
        computeBestPlayRankScore(b) - computeBestPlayRankScore(a) ||
        finiteOr(b.confidenceScore ?? b.confidence) - finiteOr(a.confidenceScore ?? a.confidence) ||
        Math.abs(b.sideEvaluation?.edge ?? computeCuratedPropEdge(b) ?? 0) -
          Math.abs(a.sideEvaluation?.edge ?? computeCuratedPropEdge(a) ?? 0)
    );
}
