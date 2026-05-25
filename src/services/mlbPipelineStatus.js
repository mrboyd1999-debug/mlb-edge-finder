const DEFAULT_STATUS = {
  mlbStatsApi: {
    label: "MLB Stats API",
    status: "Pending",
    lastSuccessAt: "",
    lastAttemptAt: "",
    lastError: "",
    lastUrl: "",
    lastStatusCode: null,
    playersReturned: null,
    matchedPlayer: null,
    playerId: null,
  },
  projectionApi: {
    label: "MLB Projection Engine",
    status: "Pending",
    lastSuccessAt: "",
    lastAttemptAt: "",
    lastError: "",
    lastProjection: null,
    lastPlayer: "",
    lastStat: "",
  },
  dfsSources: {
    PrizePicks: { status: "Pending", lastSuccessAt: "", lastError: "" },
    Underdog: { status: "Pending", lastSuccessAt: "", lastError: "" },
  },
};

let pipelineStatus = structuredClone(DEFAULT_STATUS);

function cloneStatus() {
  return structuredClone(pipelineStatus);
}

export function getMlbPipelineStatus() {
  return cloneStatus();
}

export function recordMlbStatsFetch({
  ok = false,
  url = "",
  statusCode = null,
  error = "",
  playersReturned = null,
  matchedPlayer = null,
  playerId = null,
} = {}) {
  const now = new Date().toISOString();
  pipelineStatus.mlbStatsApi.lastAttemptAt = now;
  pipelineStatus.mlbStatsApi.lastUrl = url || pipelineStatus.mlbStatsApi.lastUrl;
  pipelineStatus.mlbStatsApi.lastStatusCode = statusCode ?? pipelineStatus.mlbStatsApi.lastStatusCode;
  if (playersReturned != null) pipelineStatus.mlbStatsApi.playersReturned = playersReturned;
  if (matchedPlayer != null) pipelineStatus.mlbStatsApi.matchedPlayer = matchedPlayer;
  if (playerId != null) pipelineStatus.mlbStatsApi.playerId = playerId;
  if (ok) {
    pipelineStatus.mlbStatsApi.status = "Connected";
    pipelineStatus.mlbStatsApi.lastSuccessAt = now;
    pipelineStatus.mlbStatsApi.lastError = "";
  } else {
    pipelineStatus.mlbStatsApi.status = "Failed";
    pipelineStatus.mlbStatsApi.lastError = error || "MLB Stats API request failed";
  }
}

export function recordMlbProjectionResult({
  ok = false,
  player = "",
  statType = "",
  projection = null,
  error = "",
} = {}) {
  const now = new Date().toISOString();
  pipelineStatus.projectionApi.lastAttemptAt = now;
  pipelineStatus.projectionApi.lastPlayer = player || pipelineStatus.projectionApi.lastPlayer;
  pipelineStatus.projectionApi.lastStat = statType || pipelineStatus.projectionApi.lastStat;
  if (ok && projection != null) {
    pipelineStatus.projectionApi.status = "Connected";
    pipelineStatus.projectionApi.lastSuccessAt = now;
    pipelineStatus.projectionApi.lastProjection = projection;
    pipelineStatus.projectionApi.lastError = "";
  } else {
    pipelineStatus.projectionApi.status = ok ? "Connected" : "Failed";
    if (!ok) pipelineStatus.projectionApi.lastError = error || "Projection unavailable";
    if (ok) {
      pipelineStatus.projectionApi.lastSuccessAt = now;
      pipelineStatus.projectionApi.lastProjection = projection;
    }
  }
}

export function recordDfsSourceStatus(source = "", { ok = false, error = "" } = {}) {
  const key = source === "Underdog" ? "Underdog" : source === "PrizePicks" ? "PrizePicks" : null;
  if (!key) return;
  const now = new Date().toISOString();
  pipelineStatus.dfsSources[key].status = ok ? "Connected" : "Failed";
  if (ok) {
    pipelineStatus.dfsSources[key].lastSuccessAt = now;
    pipelineStatus.dfsSources[key].lastError = "";
  } else {
    pipelineStatus.dfsSources[key].lastError = error || "Fetch failed";
  }
}

export function mergeDfsSourceStatusFromApiHealth(apiHealth = {}) {
  ["PrizePicks", "Underdog"].forEach((name) => {
    const row = apiHealth?.[name] || {};
    const failed = /failed|unavailable|offline|empty/i.test(String(row.statusLabel || row.lineSourceBadge || row.status || ""));
    const ok = !failed && (Number(row.usableCount) > 0 || /live|connected|cached/i.test(String(row.statusLabel || "")));
    if (row.lastFetchAt || row.lastSuccessfulFetchAt) {
      pipelineStatus.dfsSources[name].lastSuccessAt = row.lastFetchAt || row.lastSuccessfulFetchAt || pipelineStatus.dfsSources[name].lastSuccessAt;
    }
    pipelineStatus.dfsSources[name].status = ok ? "Connected" : failed ? "Failed" : pipelineStatus.dfsSources[name].status;
    if (row.lastError) pipelineStatus.dfsSources[name].lastError = row.lastError;
  });
}
