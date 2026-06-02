/**
 * Single MLB player normalization + ID resolution layer.
 */

import { normalizePlayerName, playerNamesMatch, playerNameTokens } from "../../utils/playerNames.js";

export { normalizePlayerName, playerNamesMatch, playerNameTokens };

export function normalizeMlbPlayerKey(name = "") {
  return normalizePlayerName(name);
}

export function buildMlbPlayerLookup(seasonStats = [], { idField = "PlayerID", nameField = "Name" } = {}) {
  const byKey = new Map();
  const byId = new Map();

  (seasonStats || []).forEach((row) => {
    if (!row) return;
    const id = row[idField];
    const name = String(row[nameField] || "").trim();
    if (!name) return;
    const key = normalizeMlbPlayerKey(name);
    if (key) byKey.set(key, row);
    if (id != null) byId.set(String(id), row);
  });

  return { byKey, byId };
}

export function resolveMlbPlayerRow(name = "", lookup = {}, { playerId = null } = {}) {
  if (playerId != null && lookup.byId?.has(String(playerId))) {
    return lookup.byId.get(String(playerId));
  }

  const query = normalizeMlbPlayerKey(name);
  if (!query) return null;

  if (lookup.byKey?.has(query)) return lookup.byKey.get(query);

  let best = null;
  lookup.byKey?.forEach((row, key) => {
    if (playerNamesMatch(query, key)) best = row;
  });
  if (best) return best;

  lookup.byKey?.forEach((row, key) => {
    const tokens = playerNameTokens(key);
    const queryTokens = playerNameTokens(query);
    if (!tokens.length || !queryTokens.length) return;
    if (tokens[tokens.length - 1] === queryTokens[queryTokens.length - 1]) {
      if (!best) best = row;
    }
  });

  return best;
}
