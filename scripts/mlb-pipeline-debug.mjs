import { matchSportsbookPlayerToMlb, normalizeSportsbookName } from "../src/services/playerMatcher.js";
import { getPlayerLogs, getPitcherStats, buildMlbPropDataPackage, buildPitcherStrikeoutProjection } from "../src/services/mlbDataService.js";
import { buildMlbStatProfileFromLogs } from "../src/services/playerStats.js";
import { scanSingleMlbProp } from "../src/services/livePropScanner.js";

const TEST_PLAYERS = [
  { name: "Gerrit Cole", line: 6.5 },
  { name: "Spencer Strider", line: 7.5 },
  { name: "Tarik Skubal", line: 6.5 },
  { name: "Shohei Ohtani", line: 6.5 },
];

async function testPlayer({ name, line }) {
  console.log("\n==========", name, "==========");
  const prop = {
    playerName: name,
    statType: "Pitcher Strikeouts",
    line,
    sport: "MLB",
    source: "PrizePicks",
  };

  console.log("Incoming prop:", prop);
  console.log("Normalized name:", normalizeSportsbookName(name));

  const match = await matchSportsbookPlayerToMlb(name);
  console.log("Matched MLB player:", match.player?.fullName || null, "confidence:", match.confidence, "reason:", match.reason);

  if (!match.player?.id) {
    console.log("FAILURE: player not matched");
    return;
  }

  console.log("Fetching logs for:", match.player.id);
  const logs = await getPlayerLogs(match.player.id, { group: "pitching" });
  console.log("Logs count:", logs.length);
  if (logs.length) {
    const sample = logs[0]?.stat || {};
    console.log("Sample log stat keys:", Object.keys(sample).slice(0, 12));
    console.log("Sample K/IP:", sample.strikeOuts ?? sample.strikeouts, sample.inningsPitched);
  }

  const pitcherStats = await getPitcherStats(match.player.id);
  console.log("Pitcher stats:", {
    gameCount: pitcherStats.gameCount,
    last5Ks: pitcherStats.last5Ks,
    seasonKs: pitcherStats.seasonKs,
  });

  const data = await buildMlbPropDataPackage(prop, {
    buildProfile: (bundle, statType, ln) => buildMlbStatProfileFromLogs(bundle, statType, ln),
  });
  console.log("Profile built:", Boolean(data.profile), "reason:", data.reason);
  if (data.profile) {
    console.log("Profile last5:", data.profile.last5Average, "season:", data.profile.seasonAverage);
    console.log("Profile sparse/fallback:", data.profile.sparse, data.profile.fallback);
    console.log("Profile hasGameLogs:", data.profile.hasGameLogs);
  }

  const context = {
    opponentContext: data.opponentContext,
    weatherNote: data.profile?.weatherNote,
  };
  const projection = buildPitcherStrikeoutProjection(prop, data.profile || {}, context);
  console.log("Projection result:", projection.projection);
  console.log("Edge:", projection.edge);
  console.log("Confidence:", projection.confidence);
  console.log("Recommendation:", projection.modelPickLabel);
  console.log("Verified:", projection.isVerifiedProjection);
  console.log("Unavailable:", projection.projectionUnavailable);
  if (projection.projectionUnavailable) {
    console.log("Failure reason:", projection.statusMessage || projection.reasons?.join("; "));
  }

  const scanned = await scanSingleMlbProp(prop, {
    buildProfile: (bundle, statType, ln) => buildMlbStatProfileFromLogs(bundle, statType, ln),
  });
  console.log("Scanner recommendation:", scanned.modelPick, "display:", scanned.displayStatus);
}

for (const player of TEST_PLAYERS) {
  await testPlayer(player);
}
