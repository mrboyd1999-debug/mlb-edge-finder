/** Demo MLB props — only used when live feeds produce zero renderable picks. */

import { enrichPropWithSideEvaluation } from "./sideEvaluationEngine.js";
import { annotateProjectionFields } from "./projectionQuality.js";

const DEMO_PLAYERS = [
  { name: "Gerrit Cole", position: "SP", team: "NYY", opponent: "BOS" },
  { name: "Shohei Ohtani", position: "DH", team: "LAD", opponent: "SF" },
  { name: "Aaron Judge", position: "RF", team: "NYY", opponent: "BOS" },
  { name: "Corbin Burnes", position: "SP", team: "BAL", opponent: "TB" },
  { name: "Juan Soto", position: "RF", team: "NYY", opponent: "BOS" },
  { name: "Tarik Skubal", position: "SP", team: "DET", opponent: "CLE" },
  { name: "Mookie Betts", position: "SS", team: "LAD", opponent: "SF" },
  { name: "Brandon Lowe", position: "2B", team: "TB", opponent: "BAL" },
  { name: "Freddie Freeman", position: "1B", team: "LAD", opponent: "SF" },
  { name: "Spencer Strider", position: "SP", team: "ATL", opponent: "NYM" },
];

const DEMO_MARKETS = [
  { statType: "Pitcher Strikeouts", line: 6.5, projection: 5.8, side: "under", role: "pitcher" },
  { statType: "Hits", line: 1.5, projection: 0.9, side: "under", role: "hitter" },
  { statType: "Total Bases", line: 2.5, projection: 1.6, side: "under", role: "hitter" },
  { statType: "Hits+Runs+RBIs", line: 2.5, projection: 1.4, side: "under", role: "hitter" },
  { statType: "Fantasy Score", line: 8.5, projection: 6.2, side: "under", role: "hitter" },
  { statType: "Pitcher Strikeouts", line: 5.5, projection: 7.2, side: "over", role: "pitcher" },
  { statType: "Earned Runs Allowed", line: 2.5, projection: 1.8, side: "under", role: "pitcher" },
  { statType: "Walks Allowed", line: 2.5, projection: 1.5, side: "under", role: "pitcher" },
  { statType: "Singles", line: 0.5, projection: 0.3, side: "under", role: "hitter" },
  { statType: "Outs Recorded", line: 16.5, projection: 18.2, side: "over", role: "pitcher" },
];

function playerRole(position = "") {
  return position === "SP" ? "pitcher" : "hitter";
}

function demoProp(index = 0) {
  const player = DEMO_PLAYERS[index % DEMO_PLAYERS.length];
  const role = playerRole(player.position);
  const roleMarkets = DEMO_MARKETS.filter((m) => m.role === role);
  const market = roleMarkets[index % roleMarkets.length] || DEMO_MARKETS[0];
  const platform = index % 2 === 0 ? "PrizePicks" : "Underdog";
  const id = `demo-mlb-${index}-${player.name.replace(/\s/g, "-").toLowerCase()}`;

  return {
    id,
    playerName: player.name,
    player: player.name,
    position: player.position,
    isPitcher: player.role === "pitcher",
    isHitter: player.role === "hitter",
    statType: market.statType,
    market: market.statType,
    propType: market.statType,
    line: market.line,
    projection: market.projection,
    projectedValue: market.projection,
    projectionSource: "demo",
    side: market.side,
    pick: market.side,
    sport: "MLB",
    league: "MLB",
    team: player.team,
    opponent: player.opponent,
    matchup: `${player.team} vs ${player.opponent}`,
    platform,
    source: platform.toLowerCase(),
    lineSourceBadge: "DEMO",
    isDemoData: true,
    displayDemoData: true,
    demoDataLabel: "DEMO DATA",
    startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    last10HitRate: 0.42,
    sampleSize: 10,
  };
}

export function buildDemoMlbProps(count = 12) {
  return Array.from({ length: count }, (_, index) => {
    const raw = demoProp(index);
    return enrichPropWithSideEvaluation(annotateProjectionFields(raw));
  });
}

export const DEMO_FALLBACK_LABEL = "Fallback projections loaded (DEMO DATA)";
