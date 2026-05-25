/** Structured MLB prop pipeline trace — failure codes, stages, debug store. */

export const MLB_FAILURE = {
  INVALID_LINE: "INVALID_LINE",
  PLAYER_NOT_MATCHED: "PLAYER_NOT_MATCHED",
  MLB_API_FAILED: "MLB_API_FAILED",
  EMPTY_GAME_LOGS: "EMPTY_GAME_LOGS",
  INSUFFICIENT_MARKET_LOGS: "INSUFFICIENT_MARKET_LOGS",
  INVALID_RESPONSE_SCHEMA: "INVALID_RESPONSE_SCHEMA",
  MISSING_STAT_VALUES: "MISSING_STAT_VALUES",
  PROJECTION_BUILD_FAILED: "PROJECTION_BUILD_FAILED",
  EDGE_CALCULATION_FAILED: "EDGE_CALCULATION_FAILED",
  SUCCESS: "SUCCESS",
};

export const MLB_STAGE = {
  NORMALIZED: "normalized sportsbook prop",
  MATCHED: "player matched successfully",
  LOGS_FETCHED: "game logs fetched",
  LOGS_FILTERED: "market logs filtered",
  PROFILE_BUILT: "profile built",
  OPPONENT_FETCHED: "opponent stats fetched",
  PROJECTION_COMPUTED: "projection computed",
  EDGE_CALCULATED: "edge calculated",
  COMPLETE: "analysis complete",
};

const MAX_TRACES = 60;
const traceStore = [];

export function createPropTrace(prop = {}) {
  return {
    id: prop.id || `${prop.playerName}|${prop.statType}|${prop.line}|${Date.now()}`,
    playerName: prop.playerName || "",
    statType: prop.statType || "",
    line: prop.line,
    source: prop.source || prop.platform || "",
    startedAt: new Date().toISOString(),
    lastSuccessfulStage: null,
    failureCode: null,
    failureReason: null,
    normalizedName: null,
    matchedPlayer: null,
    playerId: null,
    matchConfidence: null,
    logs: null,
    logsCount: 0,
    pitcherStats: null,
    opponentStats: null,
    projection: null,
    edge: null,
    confidence: null,
    recommendation: null,
    success: false,
  };
}

export function markStage(trace, stage, payload = {}) {
  if (!trace) return trace;
  trace.lastSuccessfulStage = stage;
  Object.assign(trace, payload);
  return trace;
}

export function failTrace(trace, code, reason, stage = null) {
  if (!trace) return trace;
  trace.failureCode = code;
  trace.failureReason = reason;
  if (stage) trace.lastSuccessfulStage = stage;
  trace.success = false;
  return trace;
}

export function completeTrace(trace, payload = {}) {
  if (!trace) return trace;
  Object.assign(trace, payload);
  trace.failureCode = MLB_FAILURE.SUCCESS;
  trace.failureReason = null;
  trace.lastSuccessfulStage = MLB_STAGE.COMPLETE;
  trace.success = true;
  return trace;
}

export function pushPropTrace(trace) {
  if (!trace) return;
  traceStore.unshift({ ...trace, recordedAt: new Date().toISOString() });
  if (traceStore.length > MAX_TRACES) traceStore.length = MAX_TRACES;
  if (typeof window !== "undefined") {
    window.__MLB_PROP_DEBUG_TRACES__ = traceStore;
  }
}

export function getPropTraces(limit = MAX_TRACES) {
  return traceStore.slice(0, limit);
}

export function getPropTraceSummary() {
  const traces = getPropTraces();
  const failed = traces.filter((row) => row.failureCode && row.failureCode !== MLB_FAILURE.SUCCESS);
  const failureCounts = {};
  failed.forEach((row) => {
    failureCounts[row.failureCode] = (failureCounts[row.failureCode] || 0) + 1;
  });
  return {
    total: traces.length,
    failed: failed.length,
    succeeded: traces.filter((row) => row.success).length,
    failureCounts,
    recent: traces.slice(0, 12),
  };
}

export function logPropDebugGroup(prop = {}, trace = {}) {
  if (typeof console === "undefined" || !console.group) return;
  const label = `PROP DEBUG — ${prop.playerName || trace.playerName || "?"} · ${prop.statType || trace.statType || "?"}`;
  console.group(label);
  console.log("Incoming prop:", prop);
  console.log("Normalized player name:", trace.normalizedName);
  console.log("Matched player:", trace.matchedPlayer);
  console.log("Player ID:", trace.playerId);
  console.log("Fetching MLB logs...");
  console.log("Logs response:", trace.logs);
  console.log("Logs count:", trace.logsCount ?? trace.logs?.length ?? 0);
  console.log("Pitcher stats:", trace.pitcherStats);
  console.log("Opponent stats:", trace.opponentStats);
  console.log("Projection result:", trace.projection);
  console.log("Edge result:", trace.edge);
  console.log("Confidence result:", trace.confidence);
  console.log("Recommendation:", trace.recommendation);
  if (trace.failureCode && trace.failureCode !== MLB_FAILURE.SUCCESS) {
    console.log("Failure reason:", trace.failureCode, trace.failureReason);
    console.log("Last successful stage:", trace.lastSuccessfulStage);
  }
  console.groupEnd();
}

export function finalizePropTrace(prop = {}, trace = {}) {
  logPropDebugGroup(prop, trace);
  pushPropTrace(trace);
  return trace;
}
