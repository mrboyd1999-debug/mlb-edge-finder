import { filterAllDisplayPropsBySport } from "./allDisplayProps.js";
import { filterActiveSportProps } from "./mlbOnlyMode.js";
import { isLooseDisplayProp, dedupeLooseProps } from "./safeModePipeline.js";
import { buildPropSoftDedupeKey } from "./displayPropScoring.js";
import { filterByDisplayConfidenceFloor } from "./mlbConfidenceEngine.js";
import { formatRiskLevel } from "./pickRecommendation.js";
import { withPlayerImageUrl } from "./playerImageFields.js";

function buildMlbPool(displayProps = [], rawProps = []) {
  const mlbDisplay = filterAllDisplayPropsBySport(displayProps, "MLB", "all");
  const mlbRaw = filterActiveSportProps(rawProps || []);
  return dedupeLooseProps([...mlbDisplay, ...mlbRaw].filter(isLooseDisplayProp));
}

function overallScore(prop = {}) {
  const conf = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const edge = Math.max(0, Number(prop.edge ?? 0));
  const line = Math.max(1, Number(prop.line) || 1);
  const edgePct = (edge / line) * 100;
  return conf * 0.45 + edgePct * 0.55 + (prop.isDisplayPlayable ? 4 : 0);
}

function annotateFeatured(prop, featuredLabel, featuredKey) {
  if (!prop) return null;
  return withPlayerImageUrl({
    ...prop,
    featuredLabel,
    featuredKey,
    isFeaturedMlbPick: true,
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

export function resolveFeaturedMlbPicks(displayProps = [], rawProps = []) {
  const pool = filterByDisplayConfidenceFloor(buildMlbPool(displayProps, rawProps));
  const usedKeys = new Set();

  if (!pool.length) {
    return { bestOverall: null, sharpestEdge: null, safestPlay: null };
  }

  const byOverall = [...pool].sort((a, b) => overallScore(b) - overallScore(a));
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

  const bestOverall = pickUnique(byOverall, usedKeys);
  const sharpestEdge = pickUnique(byEdge, usedKeys);
  const safestPlay = pickUnique(bySafety, usedKeys);

  return {
    bestOverall: annotateFeatured(bestOverall, "Best Overall Play", "bestOverall"),
    sharpestEdge: annotateFeatured(sharpestEdge, "Sharpest Edge", "sharpestEdge"),
    safestPlay: annotateFeatured(safestPlay, "Safest Play", "safestPlay"),
  };
}
