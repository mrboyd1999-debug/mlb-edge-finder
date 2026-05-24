/**
 * Apply SportsDataIO slate/projections directly to live props (fallback enrichment).
 */

import { getSportsDataApiKey } from "../config/apiConfig.js";
import { normalizePlayerName } from "../utils/playerNames.js";
import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { fetchSlateSnapshot } from "./sportsDataService.js";
import { ENRICHMENT_TIMEOUT_MESSAGE, getApiTimeoutMs, withFetchTimeout } from "../utils/apiTimeout.js";

function projectionFieldForMarket(marketKey = "") {
  if (marketKey === "strikeouts") return "PitchingStrikeouts";
  if (marketKey === "hits") return "Hits";
  if (marketKey === "totalbases") return "TotalBases";
  if (marketKey === "hrr" || marketKey === "hitsrunsrbis") return "HitsRunsRBIs";
  if (marketKey === "homeRuns") return "HomeRuns";
  if (marketKey === "rbis") return "RunsBattedIn";
  if (marketKey === "runs") return "Runs";
  if (marketKey === "fantasyScore") return "FantasyPointsDraftKings";
  return "";
}

function findProjectionRow(rows = [], playerName = "") {
  const key = normalizePlayerName(playerName);
  if (!key) return null;
  return (
    rows.find((row) => normalizePlayerName(row?.Name) === key) ||
    rows.find((row) => normalizePlayerName(row?.ShortName) === key) ||
    null
  );
}

function findGameForTeam(games = [], team = "") {
  const abbr = String(team || "").toUpperCase();
  if (!abbr) return null;
  return (
    games.find((g) => String(g.HomeTeam || g.HomeTeamID || "").toUpperCase().includes(abbr)) ||
    games.find((g) => String(g.AwayTeam || g.AwayTeamID || "").toUpperCase().includes(abbr)) ||
    null
  );
}

export async function enrichPropsWithSportsData(props = []) {
  if (!getSportsDataApiKey() || !props.length) {
    return { props, warnings: [], enrichedCount: 0 };
  }

  const snapshot = await withFetchTimeout(() => fetchSlateSnapshot(), getApiTimeoutMs({ enrichment: true }), {
    label: "SportsDataIO prop enrichment",
    fallback: () => null,
  });

  if (!snapshot) {
    return { props, warnings: [ENRICHMENT_TIMEOUT_MESSAGE], enrichedCount: 0 };
  }

  const projections = snapshot.projections?.data || [];
  const games = snapshot.games?.data || [];
  const warnings = [...(snapshot.warnings || [])].filter(Boolean);
  let enrichedCount = 0;

  const enriched = props.map((prop) => {
    const marketKey = canonicalMarketKey(prop.statType || prop.market || "");
    const field = projectionFieldForMarket(marketKey);
    const row = findProjectionRow(projections, prop.playerName || prop.player);
    const projectionVal = field && row ? Number(row[field]) : NaN;
    const team = prop.team || row?.Team || "";
    const game = findGameForTeam(games, team);
    const opponent =
      prop.opponent ||
      (game && team
        ? String(game.HomeTeam || "").toUpperCase() === String(team).toUpperCase()
          ? game.AwayTeam
          : game.HomeTeam
        : "") ||
      "";

    const hasProjection = Number.isFinite(projectionVal) && projectionVal > 0;
    if (!hasProjection && !team && !opponent) return prop;

    enrichedCount += 1;
    return {
      ...prop,
      team: team || prop.team,
      opponent: opponent || prop.opponent,
      matchup: prop.matchup || (team && opponent ? `${team} vs ${opponent}` : prop.matchup),
      projection: hasProjection ? projectionVal : prop.projection,
      projectedValue: hasProjection ? projectionVal : prop.projectedValue,
      projectionSource: hasProjection ? "sportsdataio" : prop.projectionSource,
      sportsDataEnriched: true,
      gameTime: prop.gameTime || prop.startTime || game?.DateTime || game?.Day || "",
    };
  });

  return { props: enriched, warnings, enrichedCount };
}
