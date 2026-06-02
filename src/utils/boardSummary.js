/**
 * Compact board summary for the main UI (non-debug).
 */

import { resolveLastRefreshTimestamp } from "./cache.js";
import { attachLineSourceFields } from "./normalizeProp.js";

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

export function buildBoardSummary({
  boardDisplayProps = [],
  topMlbPlayBoard = null,
  providerCoverageAudit = null,
  lastUpdated = "",
  debugInfo = null,
} = {}) {
  const filterDiagnostics = topMlbPlayBoard?.filterDiagnostics || {};
  const verificationCounts = filterDiagnostics.verificationCounts || {};

  let tierA = finiteCount(verificationCounts.tierA ?? filterDiagnostics.tierA);
  let tierB = finiteCount(verificationCounts.tierB ?? filterDiagnostics.tierB);

  if (!tierA && !tierB) {
    for (const prop of boardDisplayProps || []) {
      const tier = String(prop.finalTier || prop.tier || prop.emergencyTier || "").toUpperCase();
      if (tier === "A") tierA += 1;
      if (tier === "B") tierB += 1;
    }
  }

  let prizePicksLines = 0;
  let underdogLines = 0;
  for (const prop of boardDisplayProps || []) {
    const lines = attachLineSourceFields(prop);
    if (lines.prizePicksLine != null) prizePicksLines += 1;
    if (lines.underdogLine != null) underdogLines += 1;
  }

  if (!prizePicksLines) {
    prizePicksLines = finiteCount(providerCoverageAudit?.prizepicksUsable);
  }
  if (!underdogLines) {
    underdogLines = finiteCount(providerCoverageAudit?.underdogUsable);
  }

  const lastRefresh = resolveLastRefreshTimestamp({
    lastUpdated,
    feedMode: providerCoverageAudit?.feedMode,
    providerAudit: providerCoverageAudit,
    debugInfo,
  });

  return {
    tierAPlays: tierA,
    tierBPlays: tierB,
    prizePicksLines,
    underdogLines,
    lastRefresh,
    lastRefreshLabel: lastRefresh ? new Date(lastRefresh).toISOString() : "",
  };
}
