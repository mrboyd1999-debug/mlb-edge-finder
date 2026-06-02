/**
 * Sync projection/scoring fields from engine output back onto display props.
 */

import { buildPropLookupKeys, buildPlayerStatKey, extractPlayerId, normalizeMergeId } from "./propMergeKeys.js";
import { countMergedProjections } from "./projectionCoverageAudit.js";

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
