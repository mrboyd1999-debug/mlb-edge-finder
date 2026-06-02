/**
 * Persistent MLB player → team lookup with alias normalization.
 */

import playerMapSeed from "../../data/mlbPlayerMap.json" with { type: "json" };
import { normalizePlayerName, playerNamesMatch, playerNameTokens } from "../../utils/playerNames.js";
import { resolveMlbTeamAbbr } from "../../utils/mlbTeamLogos.js";
import { findSeasonStatRow } from "../../../api/lib/sportsDataMlbStatProjection.js";

const memoryIndex = new Map();
let hydratedFromSeason = false;

function canonicalTeam(team = "") {
  return resolveMlbTeamAbbr(team)?.toUpperCase() || String(team || "").trim().toUpperCase();
}

function buildAliases(fullName = "") {
  const normalized = normalizePlayerName(fullName);
  const tokens = playerNameTokens(fullName);
  const aliases = new Set([normalized]);
  if (tokens.length >= 2) {
    aliases.add(`${tokens[0][0]} ${tokens[tokens.length - 1]}`.trim());
    aliases.add(`${tokens[0][0]}.${tokens[tokens.length - 1]}`.trim());
    aliases.add(tokens[tokens.length - 1]);
  }
  return [...aliases].filter(Boolean);
}

function recordToEntry(row = {}) {
  const fullName = String(row.fullName || row.Name || row.name || "").trim();
  if (!fullName) return null;
  const playerId = row.playerId ?? row.PlayerID ?? row.id ?? null;
  const team = canonicalTeam(row.team || row.Team || "");
  const normalizedName = normalizePlayerName(fullName);
  const aliases = [...new Set([...(row.aliases || []), ...buildAliases(fullName)])];
  return {
    playerId,
    fullName,
    normalizedName,
    team,
    position: row.position || row.Position || "",
    aliases,
  };
}

function indexEntry(entry) {
  if (!entry?.normalizedName) return;
  memoryIndex.set(entry.normalizedName, entry);
  (entry.aliases || []).forEach((alias) => {
    const key = normalizePlayerName(alias);
    if (key && !memoryIndex.has(key)) memoryIndex.set(key, entry);
  });
}

function hydrateSeed() {
  (playerMapSeed?.players || []).forEach((row) => {
    const entry = recordToEntry(row);
    if (entry) indexEntry(entry);
  });
}

hydrateSeed();

export function buildPlayerMapFromSeasonStats(seasonStats = []) {
  let added = 0;
  (seasonStats || []).forEach((row) => {
    const entry = recordToEntry({
      fullName: row.Name,
      playerId: row.PlayerID,
      team: row.Team,
      position: row.Position,
    });
    if (!entry?.team) return;
    const existing = memoryIndex.get(entry.normalizedName);
    if (!existing) {
      indexEntry(entry);
      added += 1;
    } else if (!existing.team && entry.team) {
      indexEntry({ ...existing, team: entry.team });
      added += 1;
    }
  });
  hydratedFromSeason = true;
  return { total: memoryIndex.size, added };
}

export function lookupMlbPlayer(playerName = "") {
  const query = normalizePlayerName(playerName);
  if (!query) return null;
  if (memoryIndex.has(query)) return memoryIndex.get(query);

  let match = null;
  memoryIndex.forEach((entry) => {
    if (playerNamesMatch(query, entry.normalizedName) || playerNamesMatch(query, entry.fullName)) {
      match = entry;
    }
  });
  return match;
}

/**
 * Resolve canonical MLB team for a player.
 * Order: prop.team → player map → SDIO season row → stats profile → description matchup.
 */
export function resolveMLBTeam(playerName = "", context = {}) {
  const prop = context.prop || {};
  const fromProp = canonicalTeam(prop.team || "");
  if (fromProp) return { team: fromProp, source: "prop" };

  if (!hydratedFromSeason && context.seasonStats?.length) {
    buildPlayerMapFromSeasonStats(context.seasonStats);
  }

  const mapped = lookupMlbPlayer(playerName);
  if (mapped?.team) return { team: mapped.team, source: "player-map", playerId: mapped.playerId };

  const seasonRow = findSeasonStatRow(context.seasonStats || [], {
    playerName,
    playerId: prop.playerId ?? prop.sportsDataPlayerId ?? mapped?.playerId,
  });
  if (seasonRow?.Team) {
    const team = canonicalTeam(seasonRow.Team);
    if (team) return { team, source: "sportsdataio-season", playerId: seasonRow.PlayerID };
  }

  const statsMap = context.statsMap;
  if (statsMap instanceof Map && playerName) {
    for (const profile of statsMap.values()) {
      if (!profile || profile.sparse || profile.fallback) continue;
      if (!playerNamesMatch(playerName, profile.playerName)) continue;
      const team = canonicalTeam(profile.team || profile.currentTeam || "");
      if (team) return { team, source: "stats-profile", playerId: profile.playerId };
    }
  }

  const blob = [prop.description, prop.gameDescription, prop.matchupNote].filter(Boolean).join(" ");
  const matchup = blob.match(/\b([A-Z]{2,4})\s*(?:@|vs\.?)\s*([A-Z]{2,4})\b/i);
  if (matchup) {
    return { team: matchup[1].toUpperCase(), source: "matchup-text" };
  }

  return { team: "", source: "unresolved" };
}

export function getMlbPlayerMapSize() {
  return memoryIndex.size;
}

export function exportMlbPlayerMapEntries() {
  const seen = new Set();
  const players = [];
  memoryIndex.forEach((entry) => {
    if (seen.has(entry.normalizedName)) return;
    seen.add(entry.normalizedName);
    players.push(entry);
  });
  return { players: players.sort((a, b) => a.fullName.localeCompare(b.fullName)) };
}
