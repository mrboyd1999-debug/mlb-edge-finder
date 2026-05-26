/**
 * Per-prop MLB projection pipeline logging and filter diagnostics.
 */

const filterCounters = {
  filteredMissingProjection: 0,
  filteredLowConfidence: 0,
  filteredBadMatch: 0,
  filteredLowEdge: 0,
  filteredOther: 0,
  verifiedProjections: 0,
  attempted: 0,
};

export function resetProjectionFilterCounters() {
  Object.keys(filterCounters).forEach((key) => {
    filterCounters[key] = 0;
  });
}

export function getProjectionFilterCounters() {
  return { ...filterCounters };
}

function bumpCounter(reason = "") {
  const text = String(reason || "").toLowerCase();
  if (/projection|missing|unavailable|insufficient stats|game log/.test(text)) {
    filterCounters.filteredMissingProjection += 1;
  } else if (/confidence/.test(text)) {
    filterCounters.filteredLowConfidence += 1;
  } else if (/match|player|team|role/.test(text)) {
    filterCounters.filteredBadMatch += 1;
  } else if (/edge/.test(text)) {
    filterCounters.filteredLowEdge += 1;
  } else if (reason) {
    filterCounters.filteredOther += 1;
  }
}

export function recordProjectionFilterRejection(reason = "") {
  bumpCounter(reason);
}

export function recordVerifiedProjectionGenerated() {
  filterCounters.verifiedProjections += 1;
}

export function logPropProjectionPipeline(prop = {}, details = {}) {
  filterCounters.attempted += 1;
  if (details.rejectionReason) {
    bumpCounter(details.rejectionReason);
  } else if (details.projectionValue != null && Number(details.projectionValue) > 0) {
    filterCounters.verifiedProjections += 1;
  }

  console.info("[MLB Projection Pipeline]", {
    playerName: prop.playerName || prop.player || "",
    team: prop.team || "",
    propType: prop.statType || prop.market || prop.propType || "",
    sportsbookLine: prop.line ?? null,
    matchedMLBPlayer: details.matchedMLBPlayer ?? prop.matchedPlayer ?? null,
    recentGamesFound: details.recentGamesFound ?? prop.sampleSize ?? null,
    projectionValue: details.projectionValue ?? prop.projection ?? prop.projectedValue ?? null,
    confidenceValue: details.confidenceValue ?? prop.confidenceScore ?? prop.confidence ?? null,
    edgeValue: details.edgeValue ?? prop.edge ?? null,
    rejectionReason: details.rejectionReason || null,
  });
}

export function logProjectionFilterSummary(label = "Highest Probability filter summary") {
  const counters = getProjectionFilterCounters();
  console.info(`[MLB Projection Pipeline] ${label}`, counters);
  return counters;
}
