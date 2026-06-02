/**
 * Player → team lookup before verification. Never hard-reject for missing team alone.
 */

import { resolveMLBTeam, buildPlayerMapFromSeasonStats } from "../services/mlb/mlbPlayerDatabase.js";
import { readPropSourceCache } from "./allDisplayProps.js";
import { normalizeMatchName } from "./bestPlaysPipelineDebug.js";

const runtimeTeamCache = new Map();

function lookupCachedPropTeam(prop = {}, fetchSport = "MLB") {
  const key = normalizeMatchName(prop.playerName || prop.player);
  if (!key) return null;
  if (runtimeTeamCache.has(key)) return runtimeTeamCache.get(key);

  for (const source of ["PrizePicks", "Underdog", "SportsDataIO"]) {
    const cached = readPropSourceCache(fetchSport, source) || [];
    const match = cached.find(
      (row) =>
        normalizeMatchName(row.playerName || row.player) === key && String(row.team || "").trim()
    );
    if (match?.team) {
      const result = { team: String(match.team).trim().toUpperCase(), source: `cached-${source.toLowerCase()}` };
      runtimeTeamCache.set(key, result);
      return result;
    }
  }
  return null;
}

export function enrichPropWithTeamLookup(prop = {}, context = {}) {
  const player = String(prop.playerName || prop.player || "").trim();
  if (!player) {
    return { ...prop, teamConfidence: "MISSING" };
  }

  const existingTeam = String(prop.team || "").trim();
  if (existingTeam) {
    return {
      ...prop,
      team: existingTeam.toUpperCase(),
      teamConfidence: prop.teamConfidence || "HIGH",
    };
  }

  if (context.seasonStats?.length) {
    buildPlayerMapFromSeasonStats(context.seasonStats);
  }

  const resolved = resolveMLBTeam(player, {
    prop,
    seasonStats: context.seasonStats,
    statsMap: context.statsMap,
  });
  if (resolved.team) {
    const confidence = resolved.source === "prop" ? "HIGH" : "MEDIUM";
    return {
      ...prop,
      team: resolved.team,
      teamSource: resolved.source,
      playerId: prop.playerId ?? resolved.playerId ?? prop.sportsDataPlayerId,
      teamConfidence: confidence,
    };
  }

  const cached = lookupCachedPropTeam(prop, context.fetchSport || "MLB");
  if (cached?.team) {
    return {
      ...prop,
      team: cached.team,
      teamSource: cached.source,
      teamConfidence: "MEDIUM",
    };
  }

  return {
    ...prop,
    teamConfidence: "LOW",
    teamSource: prop.teamSource || "unresolved",
  };
}

export function enrichPropsWithTeamLookup(props = [], context = {}) {
  return (props || []).map((prop) => enrichPropWithTeamLookup(prop, context));
}
