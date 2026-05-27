/** Merge scoreDFSProp outputs back onto display props so projections reach Best Plays. */

import { buildPropMergeKey, normalizeMergeId } from "./propMergeKeys.js";

function lookupKey(prop = {}) {
  return buildPropMergeKey(prop, { includeLine: true });
}

function playerStatKey(prop = {}) {
  return buildPropMergeKey(prop, { includeLine: false });
}

export function mergeScoredIntoDisplayProps(displayProps = [], scoredProps = []) {
  if (!Array.isArray(scoredProps) || !scoredProps.length) return displayProps || [];
  const lookup = new Map();
  scoredProps.forEach((scored) => {
    if (!scored) return;
    const keys = [
      scored.id,
      lookupKey(scored),
      playerStatKey(scored),
      normalizeMergeId(scored.playerId ?? scored.PlayerID),
    ].filter(Boolean);
    keys.forEach((key) => lookup.set(String(key).toLowerCase(), scored));
  });

  let matchCount = 0;
  const unmatched = [];

  const merged = (displayProps || []).map((prop) => {
    const keys = [
      prop.id,
      lookupKey(prop),
      playerStatKey(prop),
      normalizeMergeId(prop.playerId ?? prop.PlayerID),
    ].filter(Boolean);

    let scored = null;
    for (const key of keys) {
      scored = lookup.get(String(key).toLowerCase());
      if (scored) break;
    }

    if (!scored) {
      unmatched.push(playerStatKey(prop));
      return prop;
    }

    matchCount += 1;
    return {
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
  });

  console.info("[MLB Scored Merge]", {
    displayCount: displayProps.length,
    scoredCount: scoredProps.length,
    matchCount,
    unmatchedSample: unmatched.slice(0, 5),
  });

  return merged;
}
