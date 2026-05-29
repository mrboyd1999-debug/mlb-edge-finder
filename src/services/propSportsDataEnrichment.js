/**
 * Apply SportsDataIO slate/projections directly to live props (fallback enrichment).
 */

import { getSportsDataApiKey } from "../config/apiConfig.js";
import { normalizePlayerName } from "../utils/playerNames.js";
import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { computePerGameProjectionFromSeasonRow, resolveSportsDataPropLabel } from "../../api/lib/sportsDataMlbStatProjection.js";
import { fetchSlateSnapshot } from "./sportsDataService.js";
import { recordProviderResponse } from "../utils/rawResponseDebug.js";
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

const SDIO_FALLBACK_MARKETS = [
  { statType: "Pitcher Strikeouts", field: "PitchingStrikeouts", lineFactor: 0.92, role: "pitcher" },
  { statType: "Hits Allowed", field: "HitsAllowed", altField: "PitchingHits", lineFactor: 0.92, role: "pitcher" },
  { statType: "Hits+Runs+RBIs", field: "HitsRunsRBIs", lineFactor: 0.9, role: "hitter" },
  { statType: "Total Bases", field: "TotalBases", lineFactor: 0.9, role: "hitter" },
];

function roundHalf(value) {
  return Math.round(Number(value) * 2) / 2;
}

function perGameProjection(row = {}, statType = "") {
  const propLabel = resolveSportsDataPropLabel({ statType, prop: statType });
  if (!propLabel) return NaN;
  const { projection } = computePerGameProjectionFromSeasonRow(row, propLabel);
  return Number.isFinite(projection) ? projection : NaN;
}

function buildProjectionRows(snapshot = {}) {
  const projections = snapshot.projections?.data || [];
  if (projections.length) {
    return { rows: projections, source: "projections", warnings: [] };
  }

  const seasonRows = (snapshot.seasonStats?.data || []).filter(
    (row) =>
      row?.Name &&
      (Number(row.AtBats) > 0 || Number(row.InningsPitched) > 0 || Number(row.Games) > 0 || Number(row.GamesPlayed) > 0)
  );
  if (seasonRows.length) {
    return {
      rows: seasonRows,
      source: "season-stats",
      warnings: ["SportsDataIO daily projections unavailable — using season-rate fallback."],
    };
  }

  return { rows: [], source: "none", warnings: ["SportsDataIO returned no projection rows."] };
}

function projectionValueForMarket(row = {}, field = "", source = "projections", statType = "", altField = "") {
  if (source === "season-stats") return perGameProjection(row, statType || field);
  const primary = Number(row?.[field]);
  if (Number.isFinite(primary) && primary > 0) return primary;
  if (altField) {
    const alt = Number(row?.[altField]);
    if (Number.isFinite(alt) && alt > 0) return alt;
  }
  return NaN;
}

function inferOpponent(row = {}, games = []) {
  const team = String(row?.Team || "").toUpperCase();
  if (!team) return "";
  const game = games.find(
    (g) => String(g?.HomeTeam || "").toUpperCase() === team || String(g?.AwayTeam || "").toUpperCase() === team
  );
  if (!game) return "";
  return String(game.HomeTeam || "").toUpperCase() === team ? game.AwayTeam : game.HomeTeam;
}

/** Generate board-ready MLB props when live sportsbooks are unavailable. */
export async function generateMlbPropsFromSportsData({ limit = 48 } = {}) {
  if (!getSportsDataApiKey()) {
    return { props: [], warnings: ["SportsDataIO key missing"], generatedCount: 0 };
  }

  const snapshot = await withFetchTimeout(() => fetchSlateSnapshot(), getApiTimeoutMs({ enrichment: true }), {
    label: "SportsDataIO generate props",
    fallback: () => null,
  });

  if (!snapshot) {
    return { props: [], warnings: [ENRICHMENT_TIMEOUT_MESSAGE], generatedCount: 0 };
  }

  recordProviderResponse("sportsdataio", {
    url: "/api/sportsdataio/slate-snapshot",
    status: 200,
    payload: {
      projections: (snapshot.projections?.data || []).slice(0, 3),
      games: (snapshot.games?.data || []).slice(0, 3),
      seasonStats: (snapshot.seasonStats?.data || []).slice(0, 3),
    },
    parsedCount: (snapshot.projections?.data || []).length,
    normalizedCount: 0,
    message: "Slate snapshot loaded",
  });

  const { rows: projectionRows, source: rowSource, warnings: rowWarnings } = buildProjectionRows(snapshot);
  const games = snapshot.games?.data || [];
  const warnings = [...(snapshot.warnings || []), ...rowWarnings].filter(Boolean);
  const props = [];

  projectionRows.slice(0, Math.max(12, Math.ceil(limit / 3))).forEach((row) => {
    if (!row?.Name) return;
    const team = row.Team || "";
    const opponent = inferOpponent(row, games);
    SDIO_FALLBACK_MARKETS.forEach((market) => {
      const projection = projectionValueForMarket(row, market.field, rowSource, market.statType, market.altField);
      if (!Number.isFinite(projection) || projection <= 0) return;
      const line = Math.max(0.5, roundHalf(projection * market.lineFactor));
      props.push({
        id: `sdio|${row.Name}|${market.statType}|${line}`.toLowerCase().replace(/\s+/g, "-"),
        playerName: row.Name,
        player: row.Name,
        team,
        opponent,
        sport: "MLB",
        league: "MLB",
        statType: market.statType,
        market: market.statType,
        propType: market.statType,
        line,
        projection,
        projectedValue: projection,
        projectionSource: rowSource === "projections" ? "sportsdataio-generated" : `sportsdataio-${rowSource}`,
        side: projection >= line ? "over" : "under",
        pick: projection >= line ? "over" : "under",
        confidence: 58,
        confidenceScore: 58,
        edge: Math.abs(projection - line),
        projectionEdge: Math.abs(projection - line),
        platform: "SportsDataIO",
        source: "SportsDataIO",
        normalizedSource: "sportsdataio",
        sportsbookVerified: false,
        isSportsDataFallback: true,
        lineSourceBadge: "LIVE",
        matchup: team && opponent ? `${team} vs ${opponent}` : "",
        gameTime: row?.Day || row?.DateTime || "",
        startTime: row?.Day || row?.DateTime || "",
      });
    });
  });

  const result = {
    props: props.slice(0, limit),
    warnings,
    generatedCount: props.length,
  };
  recordProviderResponse("sportsdataio", {
    url: "/api/sportsdataio/generated-props",
    status: result.generatedCount ? 200 : 204,
    payload: { sample: result.props.slice(0, 3), total: result.generatedCount },
    parsedCount: result.generatedCount,
    normalizedCount: result.generatedCount,
    errors: result.warnings,
  });
  return result;
}
