import { runEmergencyProjectionDiagnostic } from "../src/services/mlbEmergencyProjectionDiagnostic.js";
import { buildMlbStatProfileFromLogs } from "../src/services/playerStats.js";

const result = await runEmergencyProjectionDiagnostic({
  buildProfile: buildMlbStatProfileFromLogs,
});

console.log("\n=== Emergency Canary Result ===");
console.log("Success:", result.success);
console.log("Stages:", result.stages?.map((s) => `${s.stage}:${s.ok ? "ok" : "FAIL"}`).join(" → "));
if (result.errors?.length) {
  console.log("Errors:");
  result.errors.forEach((e) => console.log(`  [${e.stage}] ${e.reason}`));
}
if (result.forcedVerifiedProp) {
  console.log("Forced verified prop:", {
    player: result.forcedVerifiedProp.playerName,
    projection: result.forcedVerifiedProp.projection,
    confidence: result.forcedVerifiedProp.confidenceScore,
    edge: result.forcedVerifiedProp.edge,
  });
}

process.exit(result.success ? 0 : 1);
