import { filterAllDisplayPropsBySport } from "./allDisplayProps.js";
import { filterActiveSportProps } from "./mlbOnlyMode.js";
import { isLooseDisplayProp, dedupeLooseProps } from "./safeModePipeline.js";
import { buildPropSoftDedupeKey } from "./displayPropScoring.js";
import { filterByDisplayConfidenceFloor } from "./mlbConfidenceEngine.js";
import { formatRiskLevel } from "./pickRecommendation.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { filterUnderdogStreakPool } from "./underdogStreakPool.js";
import { filterUnderdogPropsBySport } from "./underdogSportDetection.js";
import { sortBestPlayProps } from "./bestPlayRanking.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";

function buildBestPlayPool(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const mlbDisplay = filterAllDisplayPropsBySport(displayProps, "MLB", "all");
  const mlbRaw = filterActiveSportProps(rawProps || []);
  const udMlb = filterUnderdogPropsBySport(parsedUnderdogProps || [], "MLB");
  return dedupeLooseProps([...mlbDisplay, ...mlbRaw, ...filterUnderdogStreakPool(udMlb)].filter(isLooseDisplayProp));
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
  const pool = filterByDisplayConfidenceFloor(buildBestPlayPool(displayProps, rawProps, parsedUnderdogProps));
  const usedKeys = new Set();

  if (!pool.length) {
    return { bestOverall: null, sharpestEdge: null, safestPlay: null, bestPlays: [] };
  }

  const ranked = sortBestPlayProps(pool);
  const byEdge = [...pool]
    .filter((prop) => Number(prop.edge) > 0)
    .sort((a, b) => Number(b.edge) - Number(a.edge) || Number(b.confidenceScore) - Number(a.confidenceScore));
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
    annotateFeatured(prop, idx === 0 ? "Best Overall Play" : `Best Play #${idx + 1}`, `best-${idx}`)
  );

  return {
    bestOverall: annotateFeatured(bestOverall, "Best Overall Play", "bestOverall"),
    sharpestEdge: annotateFeatured(sharpestEdge, "Sharpest Edge", "sharpestEdge"),
    safestPlay: annotateFeatured(safestPlay, "Safest Play", "safestPlay"),
    bestPlays,
  };
}
