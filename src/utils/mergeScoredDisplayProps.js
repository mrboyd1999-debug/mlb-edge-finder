/** Merge scoreDFSProp outputs back onto display props so projections reach Best Plays. */

function lookupKey(prop = {}) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.line, prop.startTime]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("-");
}

export function mergeScoredIntoDisplayProps(displayProps = [], scoredProps = []) {
  if (!Array.isArray(scoredProps) || !scoredProps.length) return displayProps || [];
  const lookup = new Map();
  scoredProps.forEach((scored) => {
    if (!scored) return;
    [scored.id, lookupKey(scored)].filter(Boolean).forEach((key) => lookup.set(key, scored));
  });

  return (displayProps || []).map((prop) => {
    const scored = lookup.get(prop.id) || lookup.get(lookupKey(prop));
    if (!scored) return prop;
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
    };
  });
}
