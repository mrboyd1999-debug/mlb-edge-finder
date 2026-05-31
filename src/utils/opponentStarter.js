/**
 * Opponent starter resolution — today's scheduled matchup only.
 */

import { mlbTeamsMatch, normalizeMlbTeamKey } from "./mlbTeamMatch.js";
import { isSportsDataPitcherConnected } from "./sportsDataPitcherLookup.js";

export const STARTER_PENDING_LABEL = "Pitcher Pending";
export const OPPONENT_PITCHER_UNAVAILABLE_LABEL = "Opponent pitcher unavailable";
export const PROBABLE_STARTER_PENDING_LABEL = "Pitcher: Pending";
export const PITCHER_STATUS_UNKNOWN = "UNKNOWN";

function isUnavailablePitcherLabel(value = "") {
  const text = String(value || "").trim();
  if (!text || text === "—") return true;
  if (text === STARTER_PENDING_LABEL) return true;
  return /pitcher pending|starter pending|opponent pitcher unavailable/i.test(text);
}

/** User-facing opposing pitcher — never returns "Pitcher Pending" or unavailable when SportsData is connected. */
export function resolveOpposingPitcherDisplayLabel(prop = {}) {
  const partial = resolvePartialPitcherName(prop);
  const resolved =
    partial ||
    prop.pitcherMatchupAudit?.starterLookup?.resolvedStarter ||
    prop.pitcherMatchupAudit?.homePitcher ||
    prop.pitcherMatchupAudit?.awayPitcher ||
    resolveOpponentStarterFromGame(
      prop.probablePitchers?.game || prop.game || {},
      prop.team,
      prop.opponent
    ) ||
    prop.opposingPitcher ||
    prop.opponentStarterNote ||
    "";
  const text = String(resolved || "").trim();
  if (text && !isUnavailablePitcherLabel(text) && !/ vs /i.test(text)) {
    return text;
  }
  if (isSportsDataPitcherConnected() || prop.sportsDataEnriched) {
    return PROBABLE_STARTER_PENDING_LABEL;
  }
  if (String(prop.team || "").trim() && String(prop.opponent || "").trim()) {
    return PROBABLE_STARTER_PENDING_LABEL;
  }
  return PROBABLE_STARTER_PENDING_LABEL;
}

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

  if (!team && opponent && mlbTeamsMatch(opponent, homeName)) return homePitcher;
  if (!team && opponent && mlbTeamsMatch(opponent, awayName)) return awayPitcher;
  return null;
}

export function buildPitcherMatchupAudit(prop = {}, probablePitchers = null) {
  const team = String(prop.team || "").trim();
  const opponent = String(prop.opponent || "").trim();
  const game = probablePitchers?.game || prop.probablePitchers?.game || prop.game || null;
  const resolved = resolveOpponentStarterDisplay({ team, opponent, probablePitchers: probablePitchers || prop.probablePitchers });
  const validation = validatePitcherForMatchup({
    ...prop,
    probablePitchers: probablePitchers || prop.probablePitchers,
    opposingPitcher: resolved,
    opponentStarterNote: resolved,
  });

  const audit = {
    gameId: game?.gamePk ?? probablePitchers?.gameId ?? prop.gameId ?? null,
    team,
    opponent,
    teamId: game?.teams?.home?.team?.id && mlbTeamsMatch(team, game?.teams?.home?.team?.abbreviation || game?.teams?.home?.team?.name)
      ? game.teams.home.team.id
      : game?.teams?.away?.team?.id && mlbTeamsMatch(team, game?.teams?.away?.team?.abbreviation || game?.teams?.away?.team?.name)
        ? game.teams.away.team.id
        : prop.teamId ?? null,
    opponentTeamId: game?.teams?.home?.team?.id && mlbTeamsMatch(opponent, game?.teams?.home?.team?.abbreviation || game?.teams?.home?.team?.name)
      ? game.teams.home.team.id
      : game?.teams?.away?.team?.id && mlbTeamsMatch(opponent, game?.teams?.away?.team?.abbreviation || game?.teams?.away?.team?.name)
        ? game.teams.away.team.id
        : prop.opponentTeamId ?? null,
    homeTeam: game?.teams?.home?.team?.abbreviation || probablePitchers?.homeTeam || null,
    awayTeam: game?.teams?.away?.team?.abbreviation || probablePitchers?.awayTeam || null,
    homePitcher: game?.teams?.home?.probablePitcher?.fullName || probablePitchers?.homePitcher || null,
    awayPitcher: game?.teams?.away?.probablePitcher?.fullName || probablePitchers?.awayPitcher || null,
    starterLookup: {
      team,
      opponent,
      matchedGame: Boolean(game || probablePitchers?.matchedGame),
      resolvedStarter: resolved,
    },
    pitcherLookup: validation,
  };

  if (validation.pitcherInvalid || !audit.gameId) {
    console.info("[Pitcher Matchup Audit]", {
      player: prop.playerName || prop.player,
      team,
      opponent,
      ...audit,
    });
  }

  return audit;
}

export const PITCHER_VERIFICATION = {
  VERIFIED: "VERIFIED",
  PARTIAL: "PARTIAL",
  PENDING: "PENDING",
  FAIL: "FAIL",
};

function resolvePartialPitcherName(prop = {}) {
  const probable = prop.probablePitchers || {};
  const fromSchedule =
    probable.opponentStarter ||
    resolveOpponentStarterFromGame(probable.game || prop.game || {}, prop.team, prop.opponent) ||
    probable.homePitcher ||
    probable.awayPitcher ||
    null;
  const fromSportsData =
    prop.sportsDataProbablePitcher ||
    prop.opponentStarterFromSportsData ||
    prop.probablePitchers?.sportsDataStarter ||
    null;
  const candidate = fromSchedule || fromSportsData;
  if (!candidate || candidate === STARTER_PENDING_LABEL) return null;
  return String(candidate).trim();
}

/** Full, partial (schedule/SportsData probable), pending, or fail. */
export function resolvePitcherVerification(prop = {}) {
  const validation = validatePitcherForMatchup(prop);
  if (validation.pitcherValidated) {
    return {
      ...validation,
      pitcherVerification: PITCHER_VERIFICATION.VERIFIED,
      pitcherVerificationLevel: PITCHER_VERIFICATION.VERIFIED,
    };
  }

  const partialPitcher = resolvePartialPitcherName(prop);
  if (partialPitcher) {
    return {
      pitcher: partialPitcher,
      opposingPitcher: partialPitcher,
      pitcherStatus: "PARTIAL",
      pitcherValidated: false,
      pitcherInvalid: false,
      pitcherVerification: PITCHER_VERIFICATION.PARTIAL,
      pitcherVerificationLevel: PITCHER_VERIFICATION.PARTIAL,
      matchupPenalty: Math.max(0, Number(validation.matchupPenalty || 0) - 2),
    };
  }

  if (validation.pitcherInvalid) {
    return {
      ...validation,
      pitcherVerification: PITCHER_VERIFICATION.FAIL,
      pitcherVerificationLevel: PITCHER_VERIFICATION.FAIL,
    };
  }

  return {
    ...validation,
    pitcherVerification: PITCHER_VERIFICATION.PENDING,
    pitcherVerificationLevel: PITCHER_VERIFICATION.PENDING,
  };
}

export function normalizePropPitcherFields(prop = {}, probablePitchers = null) {
  const audit = buildPitcherMatchupAudit(prop, probablePitchers);
  const verification = resolvePitcherVerification({ ...prop, probablePitchers: probablePitchers || prop.probablePitchers, pitcherMatchupAudit: audit });
  const displayPitcher = resolveOpposingPitcherDisplayLabel({
    ...prop,
    probablePitchers: probablePitchers || prop.probablePitchers,
    pitcherMatchupAudit: audit,
    opposingPitcher: verification.pitcher,
    opponentStarterNote: verification.pitcher,
  });
  return {
    ...prop,
    probablePitchers: probablePitchers || prop.probablePitchers || null,
    opposingPitcher: displayPitcher,
    opposingPitcherDisplay: displayPitcher,
    opponentStarterNote: displayPitcher,
    pitcherVerification: verification.pitcherVerification,
    pitcherVerificationLevel: verification.pitcherVerificationLevel,
    pitcherMatchupAudit: {
      ...audit,
      pitcherLookup: {
        ...(audit.pitcherLookup || {}),
        ...verification,
        pitcherVerification: verification.pitcherVerification,
      },
    },
    gameId: audit.gameId ?? prop.gameId ?? null,
    teamId: audit.teamId ?? prop.teamId ?? null,
    opponentTeamId: audit.opponentTeamId ?? prop.opponentTeamId ?? null,
  };
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
  if (!text || /pitcher pending|starter pending/i.test(text)) {
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
      pitcherInvalid: false,
      matchupPenalty: 2,
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
      matchupPenalty: 2,
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
