/** Group ranked props by player for compact verified-plays UI. */

import { normalizeMatchName } from "./bestPlaysPipelineDebug.js";

export function groupPicksByPlayer(picks = []) {
  const groups = new Map();
  for (const prop of picks || []) {
    const name = String(prop.playerName || prop.player || "Unknown").trim() || "Unknown";
    const key = normalizeMatchName(name) || name.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { playerName: name, props: [] });
    }
    groups.get(key).props.push(prop);
  }
  return Array.from(groups.values());
}
