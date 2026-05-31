/**
 * Opponent starter resolution — today's scheduled matchup only.
 */

import { mlbTeamsMatch, normalizeMlbTeamKey } from "./mlbTeamMatch.js";

export const STARTER_PENDING_LABEL = "Starter Pending";
export const PITCHER_STATUS_UNKNOWN = "UNKNOWN";

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
  if (/ vs /i.test(text)) {
    return resolveOpponentStarterDisplay({ team, opponent, probablePitchers });
  }
  return text;
}

/** Pitcher must belong to one of the two teams in the current game. */
export function validatePitcherForMatchup(prop = {}) {
  const team = String(prop.team || "").trim();
  const opponent = String(prop.opponent || "").trim();
  const pitcherTeam = String(
    prop.opposingPitcherTeam || prop.pitcherTeam || prop.matchupAudit?.pitcherTeam || ""
  ).trim();
  const rawPitcher = String(
    prop.opposingPitcher || prop.opponentStarterNote || prop.matchupAudit?.pitcher || ""
  ).trim();
  const game = prop.probablePitchers?.game || prop.game || null;

  if (!team || !opponent) {
    return {
      pitcher: STARTER_PENDING_LABEL,
      pitcherStatus: PITCHER_STATUS_UNKNOWN,
      pitcherValidated: false,
      pitcherInvalid: true,
      matchupPenalty: 8,
    };
  }

  if (/ vs /i.test(rawPitcher)) {
    return {
      pitcher: STARTER_PENDING_LABEL,
      pitcherStatus: PITCHER_STATUS_UNKNOWN,
      pitcherValidated: false,
      pitcherInvalid: true,
      matchupPenalty: 10,
    };
  }

  const resolved = normalizeLegacyStarterNote(rawPitcher, team, opponent, prop.probablePitchers);
  if (!resolved || resolved === STARTER_PENDING_LABEL) {
    return {
      pitcher: STARTER_PENDING_LABEL,
      pitcherStatus: PITCHER_STATUS_UNKNOWN,
      pitcherValidated: false,
      pitcherInvalid: false,
      matchupPenalty: 6,
    };
  }

  if (pitcherTeam) {
    const onTeam = mlbTeamsMatch(pitcherTeam, team) || mlbTeamsMatch(pitcherTeam, opponent);
    if (!onTeam) {
      return {
        pitcher: STARTER_PENDING_LABEL,
        pitcherStatus: PITCHER_STATUS_UNKNOWN,
        pitcherValidated: false,
        pitcherInvalid: true,
        matchupPenalty: 12,
      };
    }
  }

  if (game && !gameIncludesBothTeams(game, team, opponent)) {
    return {
      pitcher: STARTER_PENDING_LABEL,
      pitcherStatus: PITCHER_STATUS_UNKNOWN,
      pitcherValidated: false,
      pitcherInvalid: true,
      matchupPenalty: 10,
    };
  }

  return {
    pitcher: resolved,
    pitcherStatus: "VERIFIED",
    pitcherValidated: true,
    pitcherInvalid: false,
    pitcherTeam: pitcherTeam || null,
    matchupPenalty: 0,
  };
}
