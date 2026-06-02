/**
 * Refresh-session console diagnostics — pinpoints cache fallback stage.
 */

let activeSession = null;

export function beginRefreshDiagnostics({ force = false, autoRefresh = false } = {}) {
  activeSession = {
    startedAt: Date.now(),
    force,
    autoRefresh,
    pp: null,
    ud: null,
    cacheLoads: [],
    totalProps: null,
  };
  console.log("[REFRESH START]", {
    force,
    autoRefresh,
    at: new Date().toISOString(),
  });
  return activeSession;
}

export function getRefreshDiagnosticsSession() {
  return activeSession ? { ...activeSession, cacheLoads: [...(activeSession.cacheLoads || [])] } : null;
}

export function logPpFetchStart(meta = {}) {
  console.log("[PP FETCH START]", meta);
  if (activeSession) activeSession.pp = { phase: "start", ...meta };
}

export function logPpFetchSuccess(meta = {}) {
  console.log("[PP FETCH SUCCESS]", meta);
  if (activeSession) activeSession.pp = { phase: "success", ...meta };
}

export function logPpFetchFailed(meta = {}) {
  console.log("[PP FETCH FAILED]", meta);
  if (activeSession) activeSession.pp = { phase: "failed", ...meta };
}

export function logUdFetchStart(meta = {}) {
  console.log("[UD FETCH START]", meta);
  if (activeSession) activeSession.ud = { phase: "start", ...meta };
}

export function logUdFetchSuccess(meta = {}) {
  console.log("[UD FETCH SUCCESS]", meta);
  if (activeSession) activeSession.ud = { phase: "success", ...meta };
}

export function logUdFetchFailed(meta = {}) {
  console.log("[UD FETCH FAILED]", meta);
  if (activeSession) activeSession.ud = { phase: "failed", ...meta };
}

export function logCacheLoad(meta = {}) {
  console.log("[CACHE LOAD]", meta);
  if (activeSession) {
    activeSession.cacheLoads.push({ ...meta, at: new Date().toISOString() });
  }
}

export function logTotalPropsAvailable(count = 0, meta = {}) {
  console.log("[TOTAL PROPS AVAILABLE]", count, meta);
  if (activeSession) activeSession.totalProps = { count, ...meta };
}

export function endRefreshDiagnostics(meta = {}) {
  if (!activeSession) return null;
  const session = {
    ...activeSession,
    durationMs: Date.now() - activeSession.startedAt,
    ...meta,
  };
  console.log("[REFRESH COMPLETE]", {
    durationMs: session.durationMs,
    totalProps: session.totalProps?.count ?? meta.totalProps ?? 0,
    feedMode: meta.feedMode || null,
    cacheLoads: session.cacheLoads.length,
    pp: session.pp?.phase || null,
    ud: session.ud?.phase || null,
  });
  activeSession = null;
  return session;
}
