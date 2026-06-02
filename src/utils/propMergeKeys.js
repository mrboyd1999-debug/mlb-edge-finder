/** Stable merge keys for joining raw props to projections and stat rows. */

import { normalizePlayerName } from "./playerNames.js";
import { canonicalMarketKey } from "./marketNormalization.js";

/** True only when two stat labels resolve to the same canonical market (no cross-market reuse). */
export function statTypesAlign(statA = "", statB = "") {
  const left = canonicalMarketKey(statA);
  const right = canonicalMarketKey(statB);
  return Boolean(left && right && left === right);
}

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

/**
 * Resolve a platform player id from normalized prop fields or nested raw API shape.
 * Never uses prop.id / sourceId — those are projection-line ids, not player ids.
 */
export function extractPlayerId(prop = {}) {
  const directCandidates = [
    prop.playerId,
    prop.player_id,
    prop.sportsDataPlayerId,
    prop.PlayerID,
    prop.platformPlayerId,
    prop.athleteId,
    prop.athlete_id,
  ];

  for (const value of directCandidates) {
    const normalized = normalizeMergeId(value);
    if (normalized) return normalized;
  }

  const raw = prop.raw && typeof prop.raw === "object" ? prop.raw : {};
  const relationships = raw.relationships || {};
  const ppPlayerId =
    relationships.new_player?.data?.id ??
    relationships.player?.data?.id ??
    (Array.isArray(relationships.new_player?.data) ? relationships.new_player.data[0]?.id : null);
  if (ppPlayerId != null && String(ppPlayerId).trim()) {
    return normalizeMergeId(ppPlayerId);
  }

  const overUnder = raw.over_under || raw.overUnder || {};
  const udPlayerId =
    raw.player_id ||
    overUnder.player_id ||
    raw.appearance?.player_id ||
    raw.appearance_id?.player_id;
  if (udPlayerId != null && String(udPlayerId).trim()) {
    return normalizeMergeId(udPlayerId);
  }

  return "";
}

export function buildPropMergeKey(prop = {}, { includeLine = false, includePlatform = true } = {}) {
  const playerId = extractPlayerId(prop);
  const playerName = normalizeMergePlayerName(prop.playerName || prop.player || "");
  const statType = normalizeMergeStatType(prop.statType || prop.market || prop.propType || "");
  const platform = includePlatform ? normalizeMergeId(prop.platform || prop.source || "") : "";
  const line = includeLine ? String(Number(prop.line) || "") : "";
  const playerPart = playerId || playerName;
  return [playerPart, statType, platform, line].filter(Boolean).join("|");
}

export function buildPlayerStatKey(playerName = "", statType = "", playerId = null) {
  const id = normalizeMergeId(playerId ?? extractPlayerId({ playerId, playerName }));
  const name = normalizeMergePlayerName(playerName);
  const stat = normalizeMergeStatType(statType);
  return `${id || name}|${stat}`;
}

/** All keys to attempt when joining a prop to projection rows (line id, player+stat, etc.). */
export function buildPropLookupKeys(prop = {}) {
  const keys = new Set();
  const playerId = extractPlayerId(prop);
  const playerName = normalizeMergePlayerName(prop.playerName || prop.player || "");
  const statType = normalizeMergeStatType(prop.statType || prop.market || prop.propType || "");
  const platform = normalizeMergeId(prop.platform || prop.source || "");
  const line = String(Number(prop.line) || "");

  if (prop.sourceId) keys.add(normalizeMergeId(prop.sourceId));
  if (prop.id) keys.add(normalizeMergeId(prop.id));

  if (playerId && statType) {
    keys.add(`${playerId}|${statType}`);
    if (platform) keys.add(`${playerId}|${statType}|${platform}`);
    if (line) keys.add(`${playerId}|${statType}|${platform}|${line}`);
  }

  if (playerName && statType) {
    keys.add(buildPlayerStatKey(playerName, statType, playerId));
    keys.add(`${playerName}|${statType}`);
    if (platform) keys.add(`${playerName}|${statType}|${platform}`);
    keys.add(buildPropMergeKey(prop, { includeLine: false, includePlatform: true }));
    if (line) keys.add(buildPropMergeKey(prop, { includeLine: true, includePlatform: true }));
    keys.add(buildPropMergeKey(prop, { includeLine: false, includePlatform: false }));
  }

  return [...keys].filter(Boolean);
}
