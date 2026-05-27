/** Stable merge keys for joining raw props to projections and stat rows. */

import { normalizePlayerName } from "./playerNames.js";
import { canonicalMarketKey } from "./marketNormalization.js";

export function normalizeMergeId(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function normalizeMergePlayerName(name = "") {
  return normalizePlayerName(name);
}

export function normalizeMergeStatType(statType = "") {
  const key = canonicalMarketKey(statType);
  return key || String(statType || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function buildPropMergeKey(prop = {}, { includeLine = false } = {}) {
  const playerId = normalizeMergeId(
    prop.playerId ?? prop.player_id ?? prop.sportsDataPlayerId ?? prop.PlayerID ?? prop.id ?? ""
  );
  const playerName = normalizeMergePlayerName(prop.playerName || prop.player || "");
  const statType = normalizeMergeStatType(prop.statType || prop.market || prop.propType || "");
  const platform = normalizeMergeId(prop.platform || prop.source || "");
  const line = includeLine ? String(Number(prop.line) || "") : "";
  const playerPart = playerId || playerName;
  return [playerPart, statType, platform, line].filter(Boolean).join("|");
}

export function buildPlayerStatKey(playerName = "", statType = "", playerId = null) {
  const id = normalizeMergeId(playerId);
  const name = normalizeMergePlayerName(playerName);
  const stat = normalizeMergeStatType(statType);
  return `${id || name}|${stat}`;
}
