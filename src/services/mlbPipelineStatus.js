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
    attachmentConfirmed: false,
    historicalCoveragePercent: 0,
    profilesMatched: 0,
    gameLogsAttached: 0,
    last5Last10Attached: 0,
    usingCache: false,
  },
  projectionApi: {
    label: "MLB Projection Engine",
    status: "Pending",
    lastSuccessAt: "",
    lastProjectionGeneratedAt: "",
    lastAttemptAt: "",
    lastError: "",
    lastProjection: null,
    lastPlayer: "",
    lastStat: "",
  },
  dfsSources: {
    PrizePicks: {
      status: "Pending",
      connectionTier: "Pending",
      lastSuccessAt: "",
      lastError: "",
      rawCount: 0,
      parsedCount: 0,
      usableCount: 0,
      filteredCount: 0,
      cachedCount: 0,
      statusLabel: "",
      ingestionSummary: "",
    },
    Underdog: {
      status: "Pending",
      connectionTier: "Pending",
      lastSuccessAt: "",
      lastError: "",
      rawCount: 0,
      parsedCount: 0,
      usableCount: 0,
      filteredCount: 0,
      cachedCount: 0,
      statusLabel: "",
      ingestionSummary: "",
    },
  },
};

let pipelineStatus = structuredClone(DEFAULT_STATUS);
const listeners = new Set();

function cloneStatus() {
  return structuredClone(pipelineStatus);
}

function notifyPipelineStatusListeners() {
  const snapshot = cloneStatus();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn("[MLB Pipeline Status] listener failed", error);
    }
  });
}

export function subscribeMlbPipelineStatus(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  listener(cloneStatus());
  return () => listeners.delete(listener);
}

export function getMlbPipelineStatus() {
  return cloneStatus();
}

export function setMlbPipelineRefreshing(isRefreshing = false) {
  if (isRefreshing) {
    if (pipelineStatus.mlbStatsApi.lastSuccessAt) {
      pipelineStatus.mlbStatsApi.status = "Refreshing";
    }
    if (pipelineStatus.projectionApi.lastProjectionGeneratedAt || pipelineStatus.projectionApi.lastSuccessAt) {
      pipelineStatus.projectionApi.status = "Refreshing";
    }
    ["PrizePicks", "Underdog"].forEach((name) => {
      if (pipelineStatus.dfsSources[name].lastSuccessAt) {
        pipelineStatus.dfsSources[name].status = "Refreshing";
        pipelineStatus.dfsSources[name].connectionTier = "Refreshing";
      }
    });
  }
  notifyPipelineStatusListeners();
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
  } else if (
    pipelineStatus.mlbStatsApi.attachmentConfirmed ||
    (pipelineStatus.mlbStatsApi.historicalCoveragePercent ?? 0) > 0 ||
    pipelineStatus.mlbStatsApi.lastSuccessAt ||
    (pipelineStatus.mlbStatsApi.playersReturned ?? 0) > 0
  ) {
    pipelineStatus.mlbStatsApi.status = "Warning";
    pipelineStatus.mlbStatsApi.lastError = error || "MLB Stats API request failed";
  } else {
    pipelineStatus.mlbStatsApi.status = "Failed";
    pipelineStatus.mlbStatsApi.lastError = error || "MLB Stats API request failed";
  }
  notifyPipelineStatusListeners();
}

function countPropsWithHistoricalFields(props = []) {
  let count = 0;
  for (const prop of props || []) {
    const last5 = Number(prop?.last5Average ?? prop?.last5);
    const last10 = Number(prop?.last10Average ?? prop?.last10);
    const season = Number(prop?.seasonAverage ?? prop?.seasonAvg);
    if (
      (Number.isFinite(last5) && last5 >= 0) ||
      (Number.isFinite(last10) && last10 >= 0) ||
      (Number.isFinite(season) && season >= 0)
    ) {
      count += 1;
    }
  }
  return count;
}

/** Reflect successful historical attachment on the board — never show Failed when stats landed. */
export function syncMlbStatsStatusFromAttachment(audit = {}, props = [], context = {}) {
  const profilesFound = Number(audit.profilesFound) || 0;
  const gameLogsAttached = Number(audit.gameLogsAttached) || 0;
  const historicalAttached = Number(audit.historicalAttached) || 0;
  const auditCoverage = Number(audit.historicalCoveragePercent) || 0;
  const propsWithHistorical = countPropsWithHistoricalFields(props);
  const propCoverage =
    props.length > 0 ? Math.round((propsWithHistorical / props.length) * 1000) / 10 : 0;
  const coveragePercent = Math.max(auditCoverage, propCoverage);
  const hasAttachment =
    profilesFound > 0 ||
    gameLogsAttached > 0 ||
    historicalAttached > 0 ||
    propsWithHistorical > 0 ||
    coveragePercent > 0;

  if (!hasAttachment) return;

  const now = new Date().toISOString();
  pipelineStatus.mlbStatsApi.lastAttemptAt = now;
  pipelineStatus.mlbStatsApi.lastSuccessAt = pipelineStatus.mlbStatsApi.lastSuccessAt || now;
  pipelineStatus.mlbStatsApi.attachmentConfirmed = true;
  pipelineStatus.mlbStatsApi.historicalCoveragePercent = coveragePercent;
  pipelineStatus.mlbStatsApi.profilesMatched = Math.max(
    pipelineStatus.mlbStatsApi.profilesMatched ?? 0,
    profilesFound
  );
  pipelineStatus.mlbStatsApi.gameLogsAttached = Math.max(
    pipelineStatus.mlbStatsApi.gameLogsAttached ?? 0,
    gameLogsAttached
  );
  pipelineStatus.mlbStatsApi.last5Last10Attached = Math.max(
    pipelineStatus.mlbStatsApi.last5Last10Attached ?? 0,
    propsWithHistorical
  );
  pipelineStatus.mlbStatsApi.usingCache = Boolean(context?.statsFromCache || context?.usedCache);
  pipelineStatus.mlbStatsApi.playersReturned = Math.max(
    pipelineStatus.mlbStatsApi.playersReturned ?? 0,
    profilesFound,
    propsWithHistorical
  );

  if (propsWithHistorical > 0 || gameLogsAttached > 0 || historicalAttached > 0 || coveragePercent > 0) {
    pipelineStatus.mlbStatsApi.status = "Connected";
    pipelineStatus.mlbStatsApi.lastError = "";
  }
  notifyPipelineStatusListeners();
}

export function formatMlbStatsAttachmentDetail(stats = {}) {
  const coverage = Number(stats.historicalCoveragePercent) || 0;
  const profiles = Number(stats.profilesMatched ?? stats.playersReturned) || 0;
  const logs = Number(stats.gameLogsAttached) || 0;
  const last5Last10 = Number(stats.last5Last10Attached) || 0;
  const usingCache = Boolean(stats.usingCache);
  return [
    `Historical coverage: ${coverage}%`,
    `Profiles matched: ${profiles}`,
    `Game logs attached: ${logs}`,
    `Last5/Last10 attached: ${last5Last10}`,
    `Using cache: ${usingCache ? "true" : "false"}`,
  ].join(" · ");
}

export function recordMlbProjectionResult({
  ok = false,
  player = "",
  statType = "",
  projection = null,
  error = "",
  engineOperational = null,
} = {}) {
  const now = new Date().toISOString();
  pipelineStatus.projectionApi.lastAttemptAt = now;
  pipelineStatus.projectionApi.lastPlayer = player || pipelineStatus.projectionApi.lastPlayer;
  pipelineStatus.projectionApi.lastStat = statType || pipelineStatus.projectionApi.lastStat;
  const hasProjection = projection != null && Number.isFinite(Number(projection));
  const mlbStatsOperational =
    engineOperational != null
      ? engineOperational
      : ["Connected", "Warning", "Refreshing"].includes(pipelineStatus.mlbStatsApi.status);
  if (ok || hasProjection) {
    pipelineStatus.projectionApi.status = "Connected";
    pipelineStatus.projectionApi.lastSuccessAt = now;
    pipelineStatus.projectionApi.lastProjectionGeneratedAt = now;
    pipelineStatus.projectionApi.lastProjection = projection;
    pipelineStatus.projectionApi.lastError = "";
  } else if (mlbStatsOperational) {
    pipelineStatus.projectionApi.status = pipelineStatus.projectionApi.lastProjectionGeneratedAt
      ? "Warning"
      : "Connected";
    pipelineStatus.projectionApi.lastError = error || "Last prop projection unavailable — MLB Stats API active";
  } else {
    pipelineStatus.projectionApi.status =
      pipelineStatus.projectionApi.lastProjectionGeneratedAt ? "Warning" : "Failed";
    pipelineStatus.projectionApi.lastError = error || "Projection unavailable";
  }
  notifyPipelineStatusListeners();
}

export function recordDfsSourceStatus(source = "", { ok = false, error = "" } = {}) {
  const key = source === "Underdog" ? "Underdog" : source === "PrizePicks" ? "PrizePicks" : null;
  if (!key) return;
  const now = new Date().toISOString();
  pipelineStatus.dfsSources[key].status = ok ? "Connected" : pipelineStatus.dfsSources[key].lastSuccessAt ? "Warning" : "Failed";
  pipelineStatus.dfsSources[key].connectionTier = ok ? "Connected" : pipelineStatus.dfsSources[key].lastSuccessAt ? "Warning" : "Failed";
  if (ok) {
    pipelineStatus.dfsSources[key].lastSuccessAt = now;
    pipelineStatus.dfsSources[key].lastError = "";
  } else {
    pipelineStatus.dfsSources[key].lastError = error || "Fetch failed";
  }
  notifyPipelineStatusListeners();
}

export function mergeDfsSourceStatusFromApiHealth(apiHealth = {}) {
  ["PrizePicks", "Underdog"].forEach((name) => {
    const row = apiHealth?.[name] || {};
    const usable = Number(row.usableCount) || 0;
    const parsed = Number(row.parsedCount) || 0;
    const cachedCount = Number(row.cachedCount) || 0;
    const hasCached = cachedCount > 0 || /cached/i.test(String(row.statusLabel || row.lineSourceBadge || ""));
    const ppOptionalNotConfigured =
      name === "PrizePicks" &&
      (/not configured/i.test(String(row.status || row.statusLabel || "")) ||
        row.httpExecuted === false ||
        row.diagnostics?.httpExecuted === false);

    if (ppOptionalNotConfigured) {
      pipelineStatus.dfsSources[name] = {
        ...pipelineStatus.dfsSources[name],
        status: "Not configured",
        connectionTier: "Not configured",
        statusLabel: row.statusLabel || "Missing VITE_PRIZEPICKS_PROXY_URL",
        rawCount: 0,
        parsedCount: 0,
        usableCount: 0,
        filteredCount: 0,
        cachedCount: 0,
        ingestionSummary: row.ingestionSummary || "",
        lastSuccessAt: pipelineStatus.dfsSources[name].lastSuccessAt,
        lastError: "",
      };
      return;
    }

    const connected = usable > 0 || parsed > 0 || hasCached;
    const warning =
      connected &&
      (hasCached ||
        row.connectionTier === "Warning" ||
        /cached|warning|fallback|degraded/i.test(String(row.statusLabel || row.status || "")));

    const tier = connected ? (warning ? "Warning" : "Connected") : "Failed";
    const lastFetchAt = row.lastFetchAt || row.lastSuccessfulFetchAt || "";

    pipelineStatus.dfsSources[name] = {
      ...pipelineStatus.dfsSources[name],
      status: tier,
      connectionTier: tier,
      statusLabel: row.statusLabel || pipelineStatus.dfsSources[name].statusLabel || "",
      rawCount: Number(row.rawCount) || 0,
      parsedCount: Number(row.parsedCount) || 0,
      usableCount: usable,
      filteredCount: Number(row.filteredCount) || Math.max(0, parsed - usable),
      cachedCount: cachedCount,
      ingestionSummary: row.ingestionSummary || "",
      lastSuccessAt: connected ? lastFetchAt || pipelineStatus.dfsSources[name].lastSuccessAt : pipelineStatus.dfsSources[name].lastSuccessAt,
      lastError: tier === "Failed" ? row.lastError || pipelineStatus.dfsSources[name].lastError : "",
    };
  });
}
