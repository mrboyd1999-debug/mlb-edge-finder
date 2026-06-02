/** Merge scoreDFSProp outputs back onto display props so projections reach Best Plays. */

import { buildPropLookupKeys, buildPlayerStatKey, extractPlayerId, normalizeMergeId } from "./propMergeKeys.js";

export function mergeScoredIntoDisplayProps(displayProps = [], scoredProps = []) {
  if (!Array.isArray(scoredProps) || !scoredProps.length) return displayProps || [];

  const lookup = new Map();
  scoredProps.forEach((scored) => {
    if (!scored) return;
    const keys = [
      ...buildPropLookupKeys(scored),
      buildPlayerStatKey(scored.playerName, scored.statType, extractPlayerId(scored)),
      normalizeMergeId(scored.sourceId),
    ].filter(Boolean);
    keys.forEach((key) => lookup.set(String(key).toLowerCase(), scored));
  });

  let matchCount = 0;
  const unmatched = [];
  const matchedSamples = [];

  const merged = (displayProps || []).map((prop) => {
    const keys = [
      ...buildPropLookupKeys(prop),
      buildPlayerStatKey(prop.playerName, prop.statType, extractPlayerId(prop)),
      normalizeMergeId(prop.sourceId),
    ].filter(Boolean);

    let scored = null;
    for (const key of keys) {
      scored = lookup.get(String(key).toLowerCase());
      if (scored) break;
    }

    if (!scored) {
      unmatched.push(buildPlayerStatKey(prop.playerName, prop.statType, extractPlayerId(prop)));
      return prop;
    }

    matchCount += 1;
    const next = {
      ...prop,
      ...scored,
      id: prop.id || scored.id,
      playerName: prop.playerName || scored.playerName,
      statType: prop.statType || scored.statType,
      line: prop.line ?? scored.line,
      platform: prop.platform || scored.platform,
      source: prop.source || scored.source,
      lineSourceBadge: prop.lineSourceBadge || scored.lineSourceBadge,
      projection: scored.projection ?? prop.projection,
      projectedValue: scored.projectedValue ?? prop.projectedValue,
    };
    if (matchedSamples.length < 5) {
      matchedSamples.push({
        playerName: next.playerName,
        statType: next.statType,
        projection: next.projection,
      });
    }
    return next;
  });

  console.info("[MLB Scored Merge]", {
    displayCount: displayProps.length,
    scoredCount: scoredProps.length,
    matchCount,
    unmatchedSample: unmatched.slice(0, 5),
    matchedSample: matchedSamples,
  });

  return merged;
}
