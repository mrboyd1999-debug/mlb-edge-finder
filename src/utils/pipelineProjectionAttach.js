/**
 * Sync projection/scoring fields from engine output back onto display props.
 */

import { buildPropLookupKeys, buildPlayerStatKey, extractPlayerId, normalizeMergeId } from "./propMergeKeys.js";
import { countMergedProjections } from "./projectionCoverageAudit.js";
import { applyProjectionProviderChain } from "./projectionProviderChain.js";

/** Stable stats/season context for projection passes (browser-safe, no block-scope refs). */
export function resolveProjectionPipelineContext(background = {}, debugInfo = {}) {
  const statsMap =
    background?.stats instanceof Map && background.stats.size
      ? background.stats
      : debugInfo?.statsMap instanceof Map
        ? debugInfo.statsMap
        : new Map();
  const seasonStats = Array.isArray(background?.sportsDataSeasonStats)
    ? background.sportsDataSeasonStats
    : Array.isArray(debugInfo?.sportsDataSeasonStats)
      ? debugInfo.sportsDataSeasonStats
      : [];
  return { seasonStats, statsMap };
}

function buildAttachLookup(sourceProps = []) {
  const lookup = new Map();
  for (const prop of sourceProps || []) {
    if (!prop) continue;
    const keys = [
      ...buildPropLookupKeys(prop),
      buildPlayerStatKey(prop.playerName, prop.statType, extractPlayerId(prop)),
      normalizeMergeId(prop.id),
      normalizeMergeId(prop.sourceId),
    ].filter(Boolean);
    keys.forEach((key) => lookup.set(String(key).toLowerCase(), prop));
  }
  return lookup;
}

function resolveAttachSource(prop = {}, lookup = new Map()) {
  const keys = [
    ...buildPropLookupKeys(prop),
    buildPlayerStatKey(prop.playerName, prop.statType, extractPlayerId(prop)),
    normalizeMergeId(prop.id),
    normalizeMergeId(prop.sourceId),
  ].filter(Boolean);
  for (const key of keys) {
    const hit = lookup.get(String(key).toLowerCase());
    if (hit) return hit;
  }
  return null;
}

const MARKET_PROJECTION_EDGE = {
  strikeouts: 0.35,
  hits: 0.12,
  "home runs": 0.08,
  rbis: 0.1,
  runs: 0.1,
  "total bases": 0.15,
  walks: 0.08,
  "fantasy score": 0.4,
  "hits+runs+rbis": 0.18,
  "pitcher outs": 0.25,
  "earned runs": 0.12,
  "stolen bases": 0.06,
  doubles: 0.06,
  singles: 0.08,
  "hits allowed": 0.2,
};

function resolveMarketProjectionEdge(market = "") {
  const key = String(market || "").trim().toLowerCase();
  if (MARKET_PROJECTION_EDGE[key] != null) return MARKET_PROJECTION_EDGE[key];
  if (/strikeout|k\b/i.test(key)) return 0.35;
  if (/hit/i.test(key)) return 0.12;
  if (/run/i.test(key)) return 0.1;
  if (/base/i.test(key)) return 0.15;
  return 0.2;
}

/** Conservative line-based projection when engine attach misses. */
export function buildNormalizedProjectionFallback(prop = {}) {
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return prop;

  const market = String(prop.statType || prop.market || prop.propType || "").trim();
  const edgeSize = resolveMarketProjectionEdge(market);
  const sideRaw = String(prop.recommendedSide || prop.side || prop.pick || prop.bestPick || "over").toLowerCase();
  const over = sideRaw.includes("over");
  const edge = over ? edgeSize : -edgeSize;
  const projection = Number((line + edge).toFixed(2));
  if (!Number.isFinite(projection) || projection <= 0) return prop;

  return {
    ...prop,
    projection,
    projectedValue: projection,
    edge: Number(edge.toFixed(3)),
    tier: "projected",
    finalTier: "C",
    projectionSource: "fallback",
    isNormalizedFallbackProjection: true,
    isFallbackProjection: true,
    isLiveRenderProp: prop.isLiveRenderProp ?? true,
    lineSourceBadge: prop.lineSourceBadge || "LIVE",
    projectionMerged: false,
    projectionStatus: "normalized-fallback",
  };
}

export function applyFallbackProjectionsToProps(props = []) {
  let applied = 0;
  const merged = (props || []).map((prop) => {
    const projection = Number(prop?.projection ?? prop?.projectedValue);
    if (Number.isFinite(projection) && projection > 0) return prop;
    const fallback = buildNormalizedProjectionFallback(prop);
    if (Number(fallback?.projection ?? fallback?.projectedValue) > 0) applied += 1;
    return fallback;
  });
  return { props: merged, applied, projectedCount: countMergedProjections(merged) };
}

/** Sync engine projections onto the full normalized board, then run provider chain. */
export function applyLiveProjectionPipeline(normalizedProps = [], engineProps = [], context = {}) {
  const synced = syncProjectionFieldsOntoProps(normalizedProps, engineProps);
  const engineAttached = countMergedProjections(synced);
  const providerResult = applyProjectionProviderChain(synced, context);
  return {
    props: providerResult.props,
    engineAttached,
    fallbackApplied: providerResult.fallbackProjections,
    generatedApplied: providerResult.generatedProjections,
    projectedCount: countMergedProjections(providerResult.props),
    projectionSourceCounts: providerResult.counts,
  };
}

/** Copy projection, edge, probability, confidence onto board props by stable keys. */
export function syncProjectionFieldsOntoProps(targetProps = [], sourceProps = []) {
  if (!Array.isArray(sourceProps) || !sourceProps.length) return targetProps || [];
  const lookup = buildAttachLookup(sourceProps);
  let attached = 0;

  const merged = (targetProps || []).map((prop) => {
    const source = resolveAttachSource(prop, lookup);
    if (!source) return prop;

    const projection = Number(source.projection ?? source.projectedValue);
    if (!Number.isFinite(projection) || projection <= 0) return prop;

    attached += 1;
    const edge = source.edge ?? (Number.isFinite(Number(prop.line)) ? Number((projection - prop.line).toFixed(3)) : prop.edge);
    const probability = source.probability ?? source.probabilityScore ?? prop.probability ?? prop.probabilityScore;
    const confidence =
      source.finalConfidence ??
      source.confidenceScore ??
      source.confidence ??
      prop.finalConfidence ??
      prop.confidenceScore ??
      prop.confidence;

    return {
      ...prop,
      projection,
      projectedValue: projection,
      edge,
      probability,
      probabilityScore: source.probabilityScore ?? probability,
      confidence,
      confidenceScore: source.confidenceScore ?? confidence,
      finalConfidence: source.finalConfidence ?? confidence,
      tier: source.tier ?? source.finalTier ?? prop.tier ?? prop.finalTier,
      finalTier: source.finalTier ?? source.tier ?? prop.finalTier ?? prop.tier,
      projectionMerged: true,
      projectionStatus: source.projectionStatus || "matched",
      projectionSource: source.projectionSource || prop.projectionSource || "sportsdataio",
      isFallbackProjection: source.isFallbackProjection ?? prop.isFallbackProjection,
      isGeneratedProjection: source.isGeneratedProjection ?? prop.isGeneratedProjection,
      isLiveRenderProp: prop.isLiveRenderProp ?? true,
      lineSourceBadge: prop.lineSourceBadge || source.lineSourceBadge || "LIVE",
    };
  });

  if (import.meta.env?.DEV) {
    console.info("[Pipeline Projection Attach]", {
      targets: targetProps.length,
      sources: sourceProps.length,
      attached,
      projectedSources: countMergedProjections(sourceProps),
      projectedTargets: countMergedProjections(merged),
    });
  }

  return merged;
}

export function auditProjectionAttachment(targetProps = [], sourceProps = []) {
  const lookup = buildAttachLookup(sourceProps);
  let missingProjection = 0;
  let missingPlayerId = 0;
  let missingMarket = 0;
  let missingSportsbookLine = 0;
  let missingOpponent = 0;
  let missingTeam = 0;
  let attached = 0;

  for (const prop of targetProps || []) {
    const player = String(prop.playerName || prop.player || "").trim();
    if (!player) continue;
    const market = String(prop.statType || prop.market || prop.propType || "").trim();
    if (!market) {
      missingMarket += 1;
      continue;
    }
    const line = Number(prop.line);
    if (!Number.isFinite(line) || line <= 0) {
      missingSportsbookLine += 1;
      continue;
    }
    if (!String(prop.playerId || prop.sportsDataPlayerId || "").trim()) missingPlayerId += 1;
    if (!String(prop.opponent || "").trim()) missingOpponent += 1;
    if (!String(prop.team || "").trim()) missingTeam += 1;

    const source = resolveAttachSource(prop, lookup);
    const projection = Number(
      (source || prop).projection ?? (source || prop).projectedValue
    );
    if (Number.isFinite(projection) && projection > 0) attached += 1;
    else missingProjection += 1;
  }

  const topRejectionReasons = [
    { reason: "missingProjection", count: missingProjection },
    { reason: "missingPlayerId", count: missingPlayerId },
    { reason: "missingMarket", count: missingMarket },
    { reason: "missingSportsbookLine", count: missingSportsbookLine },
    { reason: "missingOpponent", count: missingOpponent },
    { reason: "missingTeam", count: missingTeam },
  ]
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    attached,
    missingProjection,
    missingPlayerId,
    missingMarket,
    missingSportsbookLine,
    missingOpponent,
    missingTeam,
    topRejectionReasons,
  };
}
