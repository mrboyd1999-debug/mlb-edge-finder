/** Cap player appearances across board sections. */

function playerKey(prop = {}) {
  return String(prop.playerName || prop.player || prop.unifiedProp?.player || "")
    .trim()
    .toLowerCase();
}

export function applyCrossSectionPlayerCap(sections = [], maxPerPlayer = 2) {
  const counts = new Map();
  return (sections || []).map((section) => ({
    ...section,
    picks: (section.picks || []).filter((prop) => {
      const key = playerKey(prop);
      if (!key) return true;
      const used = counts.get(key) || 0;
      if (used >= maxPerPlayer) return false;
      counts.set(key, used + 1);
      return true;
    }),
  }));
}
