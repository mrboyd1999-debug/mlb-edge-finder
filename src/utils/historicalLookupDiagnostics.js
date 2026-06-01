/**
 * Historical profile lookup diagnostics — counters + failure logs.
 */

const MAX_FAILURE_LOG = 200;

let snapshot = {
  historicalMatched: 0,
  historicalMissing: 0,
  fallbackUsed: 0,
  failures: [],
};

export function resetHistoricalLookupDiagnostics() {
  snapshot = {
    historicalMatched: 0,
    historicalMissing: 0,
    fallbackUsed: 0,
    failures: [],
  };
}

export function recordHistoricalLookupMatch() {
  snapshot.historicalMatched += 1;
}

export function recordHistoricalLookupMissing() {
  snapshot.historicalMissing += 1;
}

export function recordHistoricalLookupFallback() {
  snapshot.fallbackUsed += 1;
}

export function logHistoricalLookupFailure({
  player = "",
  market = "",
  expectedStatKey = "",
  matchedStatKey = "",
  playerId = "",
  reason = "",
} = {}) {
  const row = {
    player: String(player || "Unknown").trim(),
    market: String(market || "—").trim(),
    expectedStatKey: String(expectedStatKey || "—"),
    matchedStatKey: String(matchedStatKey || "none"),
    playerId: String(playerId || "—"),
    reason: String(reason || "unknown"),
    at: new Date().toISOString(),
  };
  snapshot.failures.push(row);
  if (snapshot.failures.length > MAX_FAILURE_LOG) {
    snapshot.failures = snapshot.failures.slice(-MAX_FAILURE_LOG);
  }
  console.warn("[HistoricalLookup] failure", row);
  return row;
}

export function getHistoricalLookupDiagnostics() {
  return {
    historicalMatched: snapshot.historicalMatched,
    historicalMissing: snapshot.historicalMissing,
    fallbackUsed: snapshot.fallbackUsed,
    failures: snapshot.failures.slice(),
  };
}

export function logHistoricalLookupSummary(tag = "HistoricalLookup") {
  const diag = getHistoricalLookupDiagnostics();
  console.info(`[${tag}] summary`, {
    historicalMatched: diag.historicalMatched,
    historicalMissing: diag.historicalMissing,
    fallbackUsed: diag.fallbackUsed,
    failureSamples: diag.failures.slice(-5),
  });
  return diag;
}
