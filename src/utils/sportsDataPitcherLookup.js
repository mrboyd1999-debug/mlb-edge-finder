/**
 * SportsDataIO probable pitcher resolution and hitter matchup scoring.
 */

import { mlbTeamsMatch } from "./mlbTeamMatch.js";
import { getSportsDataApiKey } from "../config/apiConfig.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readPitcherName(game = {}, side = "Home") {
  const prefix = side === "Home" ? "Home" : "Away";
  const objectPitcher = game[`${prefix}ProbablePitcher`];
  if (objectPitcher && typeof objectPitcher === "object") {
    return objectPitcher.Name || objectPitcher.FullName || objectPitcher.FirstName
      ? `${objectPitcher.FirstName || ""} ${objectPitcher.LastName || ""}`.trim() || objectPitcher.Name
      : null;
  }
  return (
    game[`${prefix}ProbablePitcherName`] ||
    game[`${prefix}StartingPitcherName`] ||
    game[`${prefix}StartingPitcher`] ||
    game[`${prefix}TeamStartingPitcher`] ||
    game[`${prefix}ProbablePitcher`] ||
    null
  );
}

function readPitcherId(game = {}, side = "Home") {
  const prefix = side === "Home" ? "Home" : "Away";
  return (
    game[`${prefix}ProbablePitcherPlayerID`] ||
    game[`${prefix}StartingPitcherID`] ||
    game[`${prefix}TeamStartingPitcherID`] ||
    null
  );
}

/** Opposing probable starter from a SportsDataIO GamesByDate row. */
export function resolveOpposingPitcherFromSportsDataGame(game = {}, team = "") {
  const teamNeedle = String(team || "").trim();
  if (!game || !teamNeedle) return null;

  const homeTeam = String(game.HomeTeam || game.HomeTeamAbbreviation || "").trim();
  const awayTeam = String(game.AwayTeam || game.AwayTeamAbbreviation || "").trim();
  const onHome = mlbTeamsMatch(teamNeedle, homeTeam);
  const onAway = mlbTeamsMatch(teamNeedle, awayTeam);

  if (onHome) {
    return {
      name: readPitcherName(game, "Away"),
      playerId: readPitcherId(game, "Away"),
      pitcherTeam: awayTeam,
      source: "sportsdataio-game",
    };
  }
  if (onAway) {
    return {
      name: readPitcherName(game, "Home"),
      playerId: readPitcherId(game, "Home"),
      pitcherTeam: homeTeam,
      source: "sportsdataio-game",
    };
  }

  return null;
}

export function findSportsDataGameForTeam(games = [], team = "") {
  const abbr = String(team || "").trim();
  if (!abbr || !games?.length) return null;
  return (
    games.find((g) => mlbTeamsMatch(abbr, g.HomeTeam || g.HomeTeamAbbreviation)) ||
    games.find((g) => mlbTeamsMatch(abbr, g.AwayTeam || g.AwayTeamAbbreviation)) ||
    null
  );
}

/** Match a slate row by player team and opponent when both are known. */
export function findSportsDataGameForMatchup(games = [], team = "", opponent = "") {
  const teamNeedle = String(team || "").trim();
  const opponentNeedle = String(opponent || "").trim();
  if (!games?.length) return null;
  if (teamNeedle && opponentNeedle) {
    const matched = games.find(
      (g) =>
        (mlbTeamsMatch(teamNeedle, g.HomeTeam || g.HomeTeamAbbreviation) &&
          mlbTeamsMatch(opponentNeedle, g.AwayTeam || g.AwayTeamAbbreviation)) ||
        (mlbTeamsMatch(teamNeedle, g.AwayTeam || g.AwayTeamAbbreviation) &&
          mlbTeamsMatch(opponentNeedle, g.HomeTeam || g.HomeTeamAbbreviation))
    );
    if (matched) return matched;
  }
  return teamNeedle ? findSportsDataGameForTeam(games, teamNeedle) : null;
}

/** Attach opposing probable starter from SportsDataIO slate to each prop. */
export function attachSportsDataSlateToProps(props = [], { games = [], seasonRows = [] } = {}) {
  if (!Array.isArray(props) || !props.length || !Array.isArray(games) || !games.length) {
    return props;
  }
  return props.map((prop) => {
    const team = prop.team || prop.playerTeam || "";
    const opponent = prop.opponent || prop.opponentTeam || "";
    const game =
      prop.sportsDataGame ||
      findSportsDataGameForMatchup(games, team, opponent) ||
      findSportsDataGameForTeam(games, team);
    if (!game) {
      return {
        ...prop,
        sportsDataSlateGames: games,
        sportsDataSeasonRows: seasonRows,
        pitcherStatus: prop.pitcherStatus || (team && opponent ? "unavailable" : "pending"),
      };
    }
    return attachSportsDataPitcherFields(
      {
        ...prop,
        sportsDataSlateGames: games,
        sportsDataSeasonRows: seasonRows,
        sportsDataGame: game,
        opponent:
          prop.opponent ||
          (mlbTeamsMatch(team, game.HomeTeam || game.HomeTeamAbbreviation)
            ? game.AwayTeam || game.AwayTeamAbbreviation
            : game.HomeTeam || game.HomeTeamAbbreviation),
      },
      { game, seasonRows }
    );
  });
}

/** Score 35–88 from opposing pitcher season rates (WHIP, K/9, BB/9). */
export function computeOpposingPitcherMatchupScore(prop = {}, pitcherStats = {}) {
  const line = finite(prop.line);
  const projection = finite(prop.projection ?? prop.projectedValue);
  if (!line || !projection) return null;

  const whip = finite(pitcherStats.WHIP ?? pitcherStats.PitchingWHIP);
  const k9 = finite(pitcherStats.PitchingStrikeoutsPerNineInnings ?? pitcherStats.StrikeoutsPerNineInnings);
  const bb9 = finite(pitcherStats.PitchingWalksPerNineInnings ?? pitcherStats.WalksPerNineInnings);
  const era = finite(pitcherStats.ERA ?? pitcherStats.EarnedRunAverage);

  let score = 55;
  const leanOver = projection >= line;

  if (whip != null) {
    const contactFactor = whip <= 1.1 ? 8 : whip <= 1.25 ? 4 : whip >= 1.45 ? -8 : -3;
    score += leanOver ? contactFactor : -contactFactor;
  }
  if (k9 != null) {
    const kFactor = k9 >= 9.5 ? -6 : k9 >= 8 ? -3 : k9 <= 6 ? 6 : 2;
    score += leanOver ? kFactor : -kFactor;
  }
  if (bb9 != null) {
    const walkFactor = bb9 >= 3.8 ? 5 : bb9 <= 2.2 ? -4 : 0;
    score += leanOver ? walkFactor : -walkFactor;
  }
  if (era != null) {
    const eraFactor = era >= 5 ? 4 : era <= 3.2 ? -3 : 0;
    score += leanOver ? eraFactor : -eraFactor;
  }

  if (prop.opposingPitcher || prop.sportsDataProbablePitcher) score += 2;
  return Math.max(35, Math.min(88, Math.round(score)));
}

export function findPitcherSeasonRow(seasonRows = [], playerId = null, name = "") {
  if (playerId != null) {
    const byId = seasonRows.find((row) => String(row.PlayerID) === String(playerId));
    if (byId) return byId;
  }
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    seasonRows.find((row) => String(row.Name || "").trim().toLowerCase() === needle) ||
    seasonRows.find((row) => String(row.ShortName || "").trim().toLowerCase() === needle) ||
    null
  );
}

export function attachSportsDataPitcherFields(prop = {}, { game = null, seasonRows = [] } = {}) {
  const team = prop.team || prop.playerTeam || "";
  const resolvedGame = game || prop.sportsDataGame || null;
  if (!resolvedGame || !team) return prop;

  const lookup = resolveOpposingPitcherFromSportsDataGame(resolvedGame, team);
  if (!lookup?.name) {
    return {
      ...prop,
      sportsDataGame: resolvedGame,
      pitcherStatus: prop.pitcherStatus || "pending",
    };
  }

  const pitcherRow = findPitcherSeasonRow(seasonRows, lookup.playerId, lookup.name);
  const matchupScore = computeOpposingPitcherMatchupScore(prop, pitcherRow || {});

  return {
    ...prop,
    sportsDataGame: resolvedGame,
    sportsDataProbablePitcher: lookup.name,
    opponentStarterFromSportsData: lookup.name,
    opposingPitcherName: lookup.name,
    probablePitcherName: lookup.name,
    opposingPitcher: lookup.name,
    opposingPitcherDisplay: lookup.name,
    opponentStarterNote: lookup.name,
    opposingPitcherId: lookup.playerId,
    opposingPitcherTeam: lookup.pitcherTeam || prop.opponent,
    sportsDataPitcherPlayerId: lookup.playerId,
    sportsDataPitcherSource: lookup.source,
    pitcherStatus: "confirmed",
    probablePitchers: {
      ...(prop.probablePitchers || {}),
      sportsDataStarter: lookup.name,
      opponentStarter: lookup.name,
      sportsDataGame: resolvedGame,
    },
    ...(matchupScore != null
      ? {
          matchupScore,
          formConfidenceScore: prop.formConfidenceScore ?? matchupScore,
          pitcherMatchupScore: matchupScore,
        }
      : {}),
    ...(pitcherRow
      ? {
          opposingPitcherStats: {
            whip: pitcherRow.WHIP,
            era: pitcherRow.ERA,
            strikeoutsPerNine: pitcherRow.PitchingStrikeoutsPerNineInnings,
            walksPerNine: pitcherRow.PitchingWalksPerNineInnings,
          },
        }
      : {}),
  };
}

export function isSportsDataPitcherConnected() {
  return Boolean(getSportsDataApiKey());
}
