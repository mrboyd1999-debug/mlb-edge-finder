import { analyzeMlbPropWithData } from "../src/services/mlbDataService.js";
import { buildMlbStatProfileFromLogs } from "../src/services/playerStats.js";
import { MLB_FAILURE } from "../src/services/mlbPropPipelineTrace.js";

const TEST_PLAYERS = [
  { name: "Spencer Strider", line: 6.5 },
  { name: "Gerrit Cole", line: 6.5 },
  { name: "Tarik Skubal", line: 6.5 },
  { name: "Zack Wheeler", line: 7.5 },
  { name: "Corbin Burnes", line: 6.5 },
  { name: "Shohei Ohtani", line: 6.5 },
  { name: "Nolan McLean", line: 7.5 },
];

let passed = 0;
let failed = 0;

for (const player of TEST_PLAYERS) {
  const prop = {
    playerName: player.name,
    statType: "Pitcher Strikeouts",
    line: player.line,
    sport: "MLB",
    source: "PrizePicks",
  };

  const result = await analyzeMlbPropWithData(prop, {
    buildProfile: (bundle, statType, line) => buildMlbStatProfileFromLogs(bundle, statType, line),
  });

  const trace = result.mlbPipelineTrace || {};
  const ok =
    trace.failureCode === MLB_FAILURE.SUCCESS &&
    result.isVerifiedProjection &&
    Number.isFinite(result.projection) &&
    result.projection > 0;

  console.log("\n---", player.name, ok ? "PASS" : "FAIL", "---");
  console.log("Failure code:", trace.failureCode || "—");
  console.log("Last stage:", trace.lastSuccessfulStage || "—");
  console.log("Matched:", trace.matchedPlayer, "ID:", trace.playerId);
  console.log("Logs:", trace.logsCount);
  console.log("Projection:", result.projection, "Edge:", result.edge, "Pick:", result.modelPick);

  if (ok) passed += 1;
  else failed += 1;
}

console.log(`\nVerified pipeline test: ${passed}/${TEST_PLAYERS.length} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
