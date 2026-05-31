/**
 * Opponent starter resolution — today's scheduled matchup only.
 */

import { mlbTeamsMatch, normalizeMlbTeamKey } from "./mlbTeamMatch.js";

export const STARTER_PENDING_LABEL = "Starter Pending";

function teamSideKey(game = {}, side = "home") {
  const team = game.teams?.[side]?.team || {};
  return normalizeMlbTeamKey(team.abbreviation || team.teamCode || team.name);
}

export function gameIncludesBothTeams(game = {}, team = "", opponent = "") {
  const teamNeedle = String(team || "").trim();
  const oppNeedle = String(opponent || "").trim();
  if (!teamNeedle || !oppNeedle) return false;

  const homeKey = teamSideKey(game, "home");
  const awayKey = teamSideKey(game, "away");
  const homeName = game.teams?.home?.team?.abbreviation || game.teams?.home?.team?.name || "";
  const awayName = game.teams?.away?.team?.abbreviation || game.teams?.away?.team?.name || "";

  const hasTeam =
    mlbTeamsMatch(teamNeedle, homeName) ||
    mlbTeamsMatch(teamNeedle, awayName) ||
    normalizeMlbTeamKey(teamNeedle) === homeKey ||
    normalizeMlbTeamKey(teamNeedle) === awayKey;
  const hasOpp =
    mlbTeamsMatch(oppNeedle, homeName) ||
    mlbTeamsMatch(oppNeedle, awayName) ||
    normalizeMlbTeamKey(oppNeedle) === homeKey ||
    normalizeMlbTeamKey(oppNeedle) === awayKey;

  return hasTeam && hasOpp;
}

export function resolveOpponentStarterFromGame(game = {}, team = "", opponent = "") {
  const home = game.teams?.home;
  const away = game.teams?.away;
  const homePitcher = home?.probablePitcher?.fullName || null;
  const awayPitcher = away?.probablePitcher?.fullName || null;
  const homeName = home?.team?.abbreviation || home?.team?.name || "";
  const awayName = away?.team?.abbreviation || away?.team?.name || "";

  if (team && mlbTeamsMatch(team, homeName)) return awayPitcher;
  if (team && mlbTeamsMatch(team, awayName)) return homePitcher;
  if (opponent && mlbTeamsMatch(opponent, homeName)) return homePitcher;
  if (opponent && mlbTeamsMatch(opponent, awayName)) return awayPitcher;
  return null;
}

export function resolveOpponentStarterDisplay({ team = "", opponent = "", probablePitchers = null } = {}) {
  const starter =
    probablePitchers?.opponentStarter ||
    resolveOpponentStarterFromGame(probablePitchers?.game || {}, team, opponent) ||
    null;
  return starter || STARTER_PENDING_LABEL;
}

export function normalizeLegacyStarterNote(note = "", team = "", opponent = "", probablePitchers = null) {
  const text = String(note || "").trim();
  if (!text || /starter pending/i.test(text)) {
    return resolveOpponentStarterDisplay({ team, opponent, probablePitchers });
  }
  if (!text.includes(" vs ")) return text;
  return resolveOpponentStarterDisplay({ team, opponent, probablePitchers });
}
