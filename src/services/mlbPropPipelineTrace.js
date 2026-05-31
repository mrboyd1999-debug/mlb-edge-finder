/** Structured MLB prop pipeline trace — failure codes, stages, debug store. */
import { statProfileKey } from "../utils/playerNames.js";

/** User-facing card codes (exactly one per prop). */
export const MLB_CARD_CODE = {
  PLAYER_NOT_MATCHED: "PLAYER_NOT_MATCHED",
  API_KEY_MISSING: "API_KEY_MISSING",
  API_FETCH_FAILED: "API_FETCH_FAILED",
  EMPTY_GAME_LOGS: "EMPTY_GAME_LOGS",
  INVALID_RESPONSE_SCHEMA: "INVALID_RESPONSE_SCHEMA",
  PROJECTION_NOT_CALLED: "PROJECTION_NOT_CALLED",
  PROJECTION_SUCCESS: "PROJECTION_SUCCESS",
};

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
const fetchTraceByKey = new Map();

export function storeFetchPropTrace(prop = {}, trace = {}) {
  if (!prop || !trace) return;
  const key = statProfileKey(prop);
  if (!key) return;
  fetchTraceByKey.set(key, { ...trace, recordedAt: new Date().toISOString() });
  if (typeof window !== "undefined") {
    window.__MLB_PROP_FETCH_TRACES__ = Object.fromEntries(fetchTraceByKey);
  }
}

export function getFetchPropTrace(prop = {}) {
  return fetchTraceByKey.get(statProfileKey(prop)) || null;
}

export function toCardPipelineCode(internalCode = "", { projectionNotCalled = false, failureReason = "" } = {}) {
  if (projectionNotCalled) return MLB_CARD_CODE.PROJECTION_NOT_CALLED;
  const reason = String(failureReason || "").toLowerCase();
  if (/api[_\s-]?key|not configured|missing key/.test(reason)) return MLB_CARD_CODE.API_KEY_MISSING;
  if (internalCode === MLB_FAILURE.SUCCESS) return MLB_CARD_CODE.PROJECTION_SUCCESS;
  if (internalCode === MLB_FAILURE.PLAYER_NOT_MATCHED) return MLB_CARD_CODE.PLAYER_NOT_MATCHED;
  if (internalCode === MLB_FAILURE.MLB_API_FAILED) return MLB_CARD_CODE.API_FETCH_FAILED;
  if (
    internalCode === MLB_FAILURE.EMPTY_GAME_LOGS ||
    internalCode === MLB_FAILURE.INSUFFICIENT_MARKET_LOGS ||
    internalCode === MLB_FAILURE.MISSING_STAT_VALUES
  ) {
    return MLB_CARD_CODE.EMPTY_GAME_LOGS;
  }
  if (internalCode === MLB_FAILURE.INVALID_RESPONSE_SCHEMA || internalCode === MLB_FAILURE.INVALID_LINE) {
    return MLB_CARD_CODE.INVALID_RESPONSE_SCHEMA;
  }
  if (internalCode === MLB_FAILURE.PROJECTION_BUILD_FAILED || internalCode === MLB_FAILURE.EDGE_CALCULATION_FAILED) {
    return MLB_CARD_CODE.EMPTY_GAME_LOGS;
  }
  return MLB_CARD_CODE.EMPTY_GAME_LOGS;
}

export function buildCardPipelineDebug(trace = {}, options = {}) {
  const merged = {
    ...trace,
    normalizedName: trace.normalizedName ?? options.normalizedName ?? null,
    playerId: trace.playerId ?? options.playerId ?? null,
    logsCount: trace.logsCount ?? options.logsCount ?? 0,
    apiStatusCode: trace.apiStatusCode ?? options.apiStatusCode ?? null,
    lastSuccessfulStage: trace.lastSuccessfulStage ?? options.lastSuccessfulStage ?? null,
    failureReason: trace.failureReason ?? options.failureReason ?? null,
    failureCode: trace.failureCode ?? options.failureCode ?? null,
  };
  const cardCode = toCardPipelineCode(merged.failureCode, {
    projectionNotCalled: options.projectionNotCalled,
    failureReason: merged.failureReason,
  });
  const normalized = merged.normalizedName || "—";
  const playerId = merged.playerId ?? "—";
  const logs = merged.logsCount ?? 0;
  const apiStatus = merged.apiStatusCode ?? "—";
  const stage = merged.lastSuccessfulStage || "—";
  const reason = merged.failureReason || (cardCode === MLB_CARD_CODE.PROJECTION_SUCCESS ? "verified projection ready" : "—");
  return {
    pipelineFailureCode: cardCode,
    pipelineDebugLine: `${cardCode} | ${normalized} | id: ${playerId} | logs: ${logs} | api: ${apiStatus} | stage: ${stage} | ${reason}`,
    mlbPipelineTrace: merged,
  };
}

export function mergeLiveAndFetchTraces(liveTrace = {}, fetchTrace = null, profile = {}) {
  if (!fetchTrace) return liveTrace;
  const merged = { ...fetchTrace, ...liveTrace };
  merged.normalizedName = liveTrace.normalizedName || fetchTrace.normalizedName;
  merged.playerId = liveTrace.playerId ?? fetchTrace.playerId ?? profile.mlbId ?? profile.playerId ?? null;
  merged.matchedPlayer = liveTrace.matchedPlayer || fetchTrace.matchedPlayer || profile.playerName;
  merged.logsCount = liveTrace.logsCount || fetchTrace.logsCount || profile.sampleSize || 0;
  merged.apiStatusCode = liveTrace.apiStatusCode ?? fetchTrace.apiStatusCode ?? null;
  if ((profile.sparse || profile.fallback) && Number(fetchTrace.logsCount) >= 3 && fetchTrace.playerId) {
    merged.failureCode = MLB_FAILURE.MISSING_STAT_VALUES;
    merged.failureReason = "Stats fetched in batch but live board profile missing (lookup/key mismatch)";
    merged.lastSuccessfulStage = fetchTrace.lastSuccessfulStage || MLB_STAGE.PROFILE_BUILT;
    merged.success = false;
  }
  return merged;
}

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
    apiStatusCode: null,
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
  storeFetchPropTrace(prop, trace);
  return trace;
}
