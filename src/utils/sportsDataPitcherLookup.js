/**
 * SportsDataIO probable pitcher resolution and hitter matchup scoring.
 */

import { mlbTeamsMatch } from "./mlbTeamMatch.js";
import { getSportsDataApiKey } from "../config/apiConfig.js";
import { enrichPropWithTeamLookup } from "./teamEnrichment.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Parse team/opponent from matchup text like "vs Marlins @ Mets". */
export function parseTeamsFromProp(prop = {}) {
  let team = String(prop.team || prop.playerTeam || "").trim();
  let opponent = String(prop.opponent || prop.opponentTeam || "").trim();
  const matchup = String(prop.matchup || "").trim();

  if (team && opponent) return { team, opponent };

  const cleaned = matchup.replace(/^vs\.?\s*/i, "").trim();
  const atSplit = cleaned.match(/^(.+?)\s*@\s*(.+)$/);
  if (atSplit) {
    opponent = opponent || atSplit[1].trim();
    team = team || atSplit[2].trim();
  }

  const vsSplit = cleaned.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vsSplit && !team) {
    team = vsSplit[1].trim();
    opponent = opponent || vsSplit[2].trim();
  }

  return { team, opponent };
}

function resolvePitcherIdentity(game = {}, side = "Home", seasonRows = []) {
  const prefix = side === "Home" ? "Home" : "Away";
  const teamPrefix = side === "Home" ? "HomeTeam" : "AwayTeam";
  const objectPitcher = game[`${prefix}ProbablePitcher`] || game[`${teamPrefix}ProbablePitcher`];
  if (objectPitcher && typeof objectPitcher === "object") {
    const name =
      objectPitcher.Name ||
      objectPitcher.FullName ||
      `${objectPitcher.FirstName || ""} ${objectPitcher.LastName || ""}`.trim() ||
      null;
    const playerId =
      objectPitcher.PlayerID ||
      objectPitcher.ID ||
      readPitcherId(game, side) ||
      game[`${teamPrefix}ProbablePitcherID`] ||
      null;
    if (name) return { name: String(name).trim(), playerId };
  }

  const name =
    game[`${teamPrefix}ProbablePitcherName`] ||
    game[`${prefix}ProbablePitcherName`] ||
    game[`${teamPrefix}StartingPitcherName`] ||
    game[`${prefix}StartingPitcherName`] ||
    game[`${teamPrefix}StartingPitcher`] ||
    game[`${prefix}StartingPitcher`] ||
    game[`${teamPrefix}ProbablePitcher`] ||
    game[`${prefix}ProbablePitcher`] ||
    null;

  let playerId =
    game[`${teamPrefix}ProbablePitcherID`] ||
    readPitcherId(game, side) ||
    game[`${teamPrefix}StartingPitcherID`] ||
    null;

  if ((!name || String(name).trim().length === 0) && playerId != null && seasonRows.length) {
    const row = seasonRows.find((entry) => String(entry.PlayerID) === String(playerId));
    if (row?.Name) return { name: String(row.Name).trim(), playerId };
  }

  if (name && String(name).trim()) {
    return { name: String(name).trim(), playerId };
  }

  return { name: null, playerId };
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
export function resolveOpposingPitcherFromSportsDataGame(game = {}, team = "", seasonRows = []) {
  const teamNeedle = String(team || "").trim();
  if (!game || !teamNeedle) return null;

  const homeTeam = String(game.HomeTeam || game.HomeTeamAbbreviation || game.HomeTeamName || "").trim();
  const awayTeam = String(game.AwayTeam || game.AwayTeamAbbreviation || game.AwayTeamName || "").trim();
  const onHome = mlbTeamsMatch(teamNeedle, homeTeam);
  const onAway = mlbTeamsMatch(teamNeedle, awayTeam);

  if (onHome) {
    const identity = resolvePitcherIdentity(game, "Away", seasonRows);
    return identity.name
      ? {
          name: identity.name,
          playerId: identity.playerId,
          pitcherTeam: awayTeam,
          source: "sportsdataio-game",
        }
      : null;
  }
  if (onAway) {
    const identity = resolvePitcherIdentity(game, "Home", seasonRows);
    return identity.name
      ? {
          name: identity.name,
          playerId: identity.playerId,
          pitcherTeam: homeTeam,
          source: "sportsdataio-game",
        }
      : null;
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
    const withTeam = enrichPropWithTeamLookup(prop, { seasonStats: seasonRows });
    const parsedTeams = parseTeamsFromProp(withTeam);
    const team = parsedTeams.team || withTeam.team || withTeam.playerTeam || "";
    const opponent = parsedTeams.opponent || withTeam.opponent || withTeam.opponentTeam || "";
    const game =
      withTeam.sportsDataGame ||
      findSportsDataGameForMatchup(games, team, opponent) ||
      findSportsDataGameForTeam(games, team);
    if (!game) {
      return {
        ...withTeam,
        team,
        opponent,
        sportsDataSlateGames: games,
        sportsDataSeasonRows: seasonRows,
        pitcherStatus: withTeam.pitcherStatus || (team && opponent ? "unavailable" : "pending"),
      };
    }
    return attachSportsDataPitcherFields(
      {
        ...withTeam,
        team,
        opponent,
        sportsDataSlateGames: games,
        sportsDataSeasonRows: seasonRows,
        sportsDataGame: game,
        opponent:
          opponent ||
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
  const parsed = parseTeamsFromProp(prop);
  const team = parsed.team || prop.team || prop.playerTeam || "";
  const resolvedGame = game || prop.sportsDataGame || null;
  if (!resolvedGame || !team) return prop;

  const rows = seasonRows.length ? seasonRows : prop.sportsDataSeasonRows || [];
  const lookup = resolveOpposingPitcherFromSportsDataGame(resolvedGame, team, rows);
  if (!lookup?.name) {
    return {
      ...prop,
      team,
      opponent: parsed.opponent || prop.opponent,
      sportsDataGame: resolvedGame,
      pitcherStatus: prop.pitcherStatus || "pending",
    };
  }

  const pitcherRow = findPitcherSeasonRow(rows, lookup.playerId, lookup.name);
  const matchupScore = computeOpposingPitcherMatchupScore(prop, pitcherRow || {});
  const era = finite(pitcherRow?.ERA ?? pitcherRow?.EarnedRunAverage);
  const whip = finite(pitcherRow?.WHIP ?? pitcherRow?.PitchingWHIP);
  const hand =
    pitcherRow?.Throws ||
    pitcherRow?.PitchingHand ||
    pitcherRow?.Hand ||
    null;

  return {
    ...prop,
    sportsDataGame: resolvedGame,
    sportsDataProbablePitcher: lookup.name,
    opponentStarterFromSportsData: lookup.name,
    opposingPitcherName: lookup.name,
    probablePitcherName: lookup.name,
    pitcherName: lookup.name,
    opposingPitcher: lookup.name,
    opposingPitcherDisplay: lookup.name,
    opponentStarterNote: lookup.name,
    opposingPitcherId: lookup.playerId,
    opposingPitcherTeam: lookup.pitcherTeam || prop.opponent,
    sportsDataPitcherPlayerId: lookup.playerId,
    sportsDataPitcherSource: lookup.source,
    pitcherStatus: "confirmed",
    pitcherHand: hand ? String(hand).trim().toUpperCase().charAt(0) : "",
    pitcherERA: era,
    pitcherWHIP: whip,
    opposingPitcherSeasonRow: pitcherRow || null,
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
