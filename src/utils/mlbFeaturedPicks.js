import { filterAllDisplayPropsBySport } from "./allDisplayProps.js";
import { isLooseDisplayProp, dedupeLooseProps } from "./safeModePipeline.js";
import { buildPropSoftDedupeKey } from "./displayPropScoring.js";
import { filterByDisplayConfidenceFloor } from "./mlbConfidenceEngine.js";
import { formatRiskLevel } from "./pickRecommendation.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { filterUnderdogPropsBySport } from "./underdogSportDetection.js";
import { sortBestPlayProps, prepareBestPlayProps, isRankableBestPlay } from "./bestPlayRanking.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";
import { isCuratedDisplayProp, computeCuratedPropEdge, isVerifiedSportsbookProp } from "./propValidation.js";
import { enrichPropWithSideEvaluation } from "./sideEvaluationEngine.js";
import { normalizeSource } from "./normalizeSource.js";

function isPrizePicksOrUnderdog(prop = {}) {
  const src = normalizeSource(prop);
  return src === "prizepicks" || src === "underdog";
}

function buildBestPlayPool(displayProps = [], _rawProps = [], parsedUnderdogProps = []) {
  const mlbDisplay = filterAllDisplayPropsBySport(displayProps, "MLB", "all")
    .filter(isVerifiedSportsbookProp)
    .filter(isPrizePicksOrUnderdog);
  const udMlb = filterUnderdogPropsBySport(parsedUnderdogProps || [], "MLB").filter(isVerifiedSportsbookProp);
  return dedupeLooseProps(
    [...mlbDisplay, ...udMlb].filter(isLooseDisplayProp).filter(isCuratedDisplayProp)
  );
}

function annotateFeatured(prop, featuredLabel, featuredKey) {
  if (!prop) return null;
  return withPlayerImageUrl({
    ...prop,
    featuredLabel,
    featuredKey,
    isFeaturedMlbPick: true,
    reason:
      prop.analyticsReason ||
      prop.premiumWhySummary ||
      prop.whyThisPick?.compact ||
      buildAnalyticsReason(prop) ||
      "",
  });
}

function pickUnique(candidates = [], usedKeys = new Set()) {
  for (const prop of candidates) {
    if (!prop) continue;
    const key = buildPropSoftDedupeKey(prop);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    return prop;
  }
  return null;
}

export function resolveFeaturedMlbPicks(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const rawPool = filterByDisplayConfidenceFloor(buildBestPlayPool(displayProps, rawProps, parsedUnderdogProps));
  const pool = prepareBestPlayProps(rawPool).filter(isRankableBestPlay);
  const usedKeys = new Set();

  if (!pool.length) {
    return { bestOverall: null, sharpestEdge: null, safestPlay: null, bestPlays: [] };
  }

  const ranked = sortBestPlayProps(pool);
  const byEdge = [...pool]
    .filter((prop) => {
      const edge = Number(computeCuratedPropEdge(prop));
      return Number.isFinite(edge) && edge > 0;
    })
    .sort((a, b) => Math.abs(computeCuratedPropEdge(b) ?? 0) - Math.abs(computeCuratedPropEdge(a) ?? 0));
  const bySafety = [...pool]
    .filter((prop) => formatRiskLevel(prop) !== "High")
    .sort(
      (a, b) =>
        Number(b.confidenceScore ?? b.confidence) - Number(a.confidenceScore ?? a.confidence) ||
        Number(b.edge) - Number(a.edge)
    );

  const bestOverall = pickUnique(ranked, usedKeys);
  const sharpestEdge = pickUnique(byEdge, usedKeys);
  const safestPlay = pickUnique(bySafety, usedKeys);

  const bestPlays = ranked.slice(0, 6).map((prop, idx) =>
    annotateFeatured(
      enrichPropWithSideEvaluation(prop),
      idx === 0 ? "Best Overall Play" : `Best Play #${idx + 1}`,
      `best-${idx}`
    )
  );

  return {
    bestOverall: annotateFeatured(bestOverall, "Best Overall Play", "bestOverall"),
    sharpestEdge: annotateFeatured(sharpestEdge, "Sharpest Edge", "sharpestEdge"),
    safestPlay: annotateFeatured(safestPlay, "Safest Play", "safestPlay"),
    bestPlays,
  };
}
