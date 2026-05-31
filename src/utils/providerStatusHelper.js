/**
 * Strict provider status — green only when live + usable; yellow for cached/fallback; red for failed.
 */

import { getOddsApiKey, getSportsDataApiKey } from "../services/runtimeSettings.js";
import { resolveProjectionEngineStatus } from "./projectionPipelineStatus.js";

export const PROVIDER_STATUS = {
  CONNECTED: "connected",
  WARNING: "warning",
  FAILED: "failed",
};

export const PROVIDER_SOURCE_MODE = {
  LIVE: "live",
  CACHED: "cached",
  FALLBACK: "fallback",
  NONE: "none",
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeStatusKey(status = "") {
  return String(status || "").trim().toLowerCase();
}

/** Line feeds: PrizePicks / Underdog — green only on live HTTP 200 with usable props. */
export function resolveStrictLineFeedStatus(feed = {}) {
  const active = finite(feed.activeUsableCount ?? feed.usableCount);
  const parsed = finite(feed.parsedCount);
  const cached = Boolean(
    feed.cached ||
      feed.fallback ||
      feed.fromCache ||
      /cached|fallback|degraded/i.test(String(feed.lineSourceBadge || feed.statusLabel || feed.status || ""))
  );
  const fallback = Boolean(feed.fallback || /fallback/i.test(String(feed.statusLabel || feed.status || "")));
  const timedOut = Boolean(
    feed.timedOut || /timed?\s*out/i.test(String(feed.statusLabel || feed.lastError || ""))
  );
  const liveHttpOk = Boolean(feed.liveHttpOk) && Number(feed.httpStatus) === 200;
  const fetchFailed = Boolean(feed.fetchFailed) || normalizeStatusKey(feed.connectionTier) === "failed";
  const errorDetail = String(feed.lastError || feed.statusLabel || feed.message || "").trim();

  if (liveHttpOk && !cached && !fallback && active > 0 && parsed > 0) {
    return {
      status: "Connected",
      detail: `${active} live props`,
      sourceMode: PROVIDER_SOURCE_MODE.LIVE,
      strictTier: PROVIDER_STATUS.CONNECTED,
    };
  }

  if (active > 0 && (cached || (!liveHttpOk && !fallback && !timedOut))) {
    return {
      status: "Connected (Cached)",
      detail: `${active} props in use (cached)`,
      sourceMode: PROVIDER_SOURCE_MODE.CACHED,
      strictTier: PROVIDER_STATUS.WARNING,
    };
  }

  if (active > 0 && fallback) {
    return {
      status: "Warning",
      detail: `Fallback — ${active} props in use`,
      sourceMode: PROVIDER_SOURCE_MODE.FALLBACK,
      strictTier: PROVIDER_STATUS.WARNING,
    };
  }

  if (timedOut) {
    return {
      status: "Failed",
      detail: errorDetail || "Timed out — no usable props",
      sourceMode: PROVIDER_SOURCE_MODE.NONE,
      strictTier: PROVIDER_STATUS.FAILED,
    };
  }

  if (fetchFailed || active === 0) {
    return {
      status: "Failed",
      detail: errorDetail || "Feed fetch failed",
      sourceMode: PROVIDER_SOURCE_MODE.NONE,
      strictTier: PROVIDER_STATUS.FAILED,
    };
  }

  if (/not configured/i.test(String(feed.status || feed.statusLabel || ""))) {
    return {
      status: "Not configured",
      detail: errorDetail || "Provider not configured",
      sourceMode: PROVIDER_SOURCE_MODE.NONE,
      strictTier: PROVIDER_STATUS.FAILED,
    };
  }

  return {
    status: "Failed",
    detail: errorDetail || "No usable props",
    sourceMode: PROVIDER_SOURCE_MODE.NONE,
    strictTier: PROVIDER_STATUS.FAILED,
  };
}

export function resolveStrictOddsStatus(row, keyConfigured, tested) {
  if (!keyConfigured) return { status: "Not configured", detail: "Add Odds API key in Settings" };
  if (!tested || !row) return { status: "Not tested", detail: "Save key and run Retest All" };
  if (row.sportsListOk || normalizeStatusKey(row.settingsLine) === "connected" || row.ok) {
    return {
      status: "Connected",
      detail: row.debugLine || (row.sportsCount != null ? `${row.sportsCount} sports listed` : "Sports endpoint OK"),
    };
  }
  if (/invalid/i.test(String(row.settingsLine || "")) || row.unauthorized) {
    return { status: "Invalid key", detail: row.responseBody || row.message || row.lastError || "Key rejected" };
  }
  if (/rate/i.test(String(row.settingsLine || "")) || row.rateLimited) {
    return { status: "Limited", detail: row.message || "Rate limited" };
  }
  return {
    status: "Failed",
    detail: row.responseBody || row.message || row.lastError || `HTTP ${row.httpStatus ?? "?"}`,
  };
}

export function resolveStrictSportsDataStatus(row, keyConfigured, tested) {
  if (!keyConfigured) return { status: "Not configured", detail: "API key not saved" };
  if (!tested || !row) return { status: "Not tested", detail: "Run Retest All after saving key" };
  const playersTest = row.endpointTests?.find((entry) => entry.id === "players");
  const playersOk = playersTest?.ok === true || (Number(playersTest?.httpStatus) === 200 && Number(playersTest?.recordCount) >= 0);
  if (normalizeStatusKey(row.settingsLine) === "connected" && playersOk) {
    return {
      status: "Connected",
      detail: row.debugLine || playersTest?.message || "Player endpoint OK",
    };
  }
  if (/invalid|unauthorized/i.test(String(row.settingsLine || "")) || row.unauthorized) {
    return { status: "Invalid key", detail: row.responseBody || row.message || "Key rejected" };
  }
  return {
    status: "Failed",
    detail: playersTest?.message || row.message || row.lastError || "Player endpoint failed",
  };
}

export function resolveStrictMlbStatsStatus({
  testResult = null,
  pipelineStats = {},
  attachmentAudit = null,
} = {}) {
  if (testResult) {
    const connected = testResult.connected === true && finite(testResult.playerCount) > 0;
    if (connected) {
      return {
        status: "Connected",
        detail: `HTTP 200 — ${testResult.playerCount} players matched (${testResult.canaryPlayer || "canary"})`,
        checkedAt: testResult.testedAt,
      };
    }
    return {
      status: "Failed",
      detail: testResult.detail || testResult.error || "MLB Stats API search failed",
      checkedAt: testResult.testedAt,
    };
  }

  const usingCache = Boolean(pipelineStats.usingCache);
  const profilesMatched = Math.max(
    finite(pipelineStats.profilesMatched ?? pipelineStats.playersReturned),
    finite(attachmentAudit?.profilesFound)
  );
  const gameLogsAttached = Math.max(
    finite(pipelineStats.gameLogsAttached),
    finite(attachmentAudit?.gameLogsAttached)
  );
  const hasAttachment = profilesMatched > 0 || gameLogsAttached > 0;

  if (hasAttachment && !usingCache) {
    return { status: "Connected", detail: "Connected — player logs available" };
  }
  if (hasAttachment && usingCache) {
    return { status: "Warning", detail: "Cached — MLB logs in use" };
  }
  return {
    status: "Failed",
    detail: pipelineStats.lastError || pipelineStats.failureReason || "Stats API unavailable",
  };
}

export function buildProviderRefreshAudit({
  connectionReport = null,
  mlbStatsTest = null,
  apiHealth = {},
  boardStats = {},
} = {}) {
  const rows = connectionReport?.results || [];
  const find = (name) => rows.find((row) => String(row.provider || "").toLowerCase().includes(name.toLowerCase())) || null;
  const odds = find("odds");
  const sd = find("sportsdata");
  const ppFeed = apiHealth?.PrizePicks || {};
  const udFeed = apiHealth?.Underdog || {};

  const oddsConnected = Boolean(
    odds?.sportsListOk || normalizeStatusKey(odds?.settingsLine) === "connected" || odds?.ok
  );
  const prizePicksConnected = Boolean(
    ppFeed.liveHttpOk && finite(ppFeed.activeUsableCount ?? ppFeed.usableCount) > 0 && !ppFeed.cached
  );
  const underdogConnected = finite(udFeed.activeUsableCount ?? udFeed.usableCount) > 0;
  const sportsDataConnected = Boolean(
    sd?.endpointTests?.find((entry) => entry.id === "players")?.ok ||
      normalizeStatusKey(sd?.settingsLine) === "connected"
  );
  const mlbStatsConnected = Boolean(mlbStatsTest?.connected || finite(mlbStatsTest?.playerCount) > 0);

  return {
    oddsConnected,
    prizePicksConnected,
    underdogConnected,
    sportsDataConnected,
    mlbStatsConnected,
    pitcherVerificationCount: finite(boardStats.pitcherVerificationCount),
    tierACount: finite(boardStats.tierACount ?? boardStats.verifiedTierA),
    tierBCount: finite(boardStats.tierBCount ?? boardStats.verifiedTierB),
    verifiedCount: finite(boardStats.verifiedCount),
    timestamp: new Date().toISOString(),
  };
}

export function logBoardRefreshAudit(payload = {}) {
  console.info("[Board Refresh Audit]", payload);
}

/** User-facing line feed label — failed feeds read as temporarily unavailable, not broken. */
export function resolveUserFacingLineFeedStatus(feed = {}) {
  const resolved = resolveStrictLineFeedStatus(feed);
  if (resolved.status === "Connected") {
    return { ...resolved, status: "Live" };
  }
  if (resolved.status === "Connected (Cached)") {
    return { ...resolved, status: "Cached" };
  }
  if (/not configured/i.test(String(resolved.status || ""))) {
    return { ...resolved, status: "Not configured" };
  }
  if (resolved.status === "Failed" || resolved.strictTier === PROVIDER_STATUS.FAILED) {
    return {
      status: "Temporarily unavailable",
      detail: resolved.detail,
      sourceMode: resolved.sourceMode,
      strictTier: PROVIDER_STATUS.WARNING,
    };
  }
  return resolved;
}

export function resolveUserFacingOddsStatus(row, keyConfigured, tested) {
  const resolved = resolveStrictOddsStatus(row, keyConfigured, tested);
  if (resolved.status === "Connected") return resolved;
  if (/not configured|not tested/i.test(resolved.status)) return resolved;
  return { ...resolved, status: "Temporarily unavailable" };
}

export function resolveUserFacingSportsDataStatus(row, keyConfigured, tested) {
  const resolved = resolveStrictSportsDataStatus(row, keyConfigured, tested);
  if (resolved.status === "Connected") return resolved;
  if (/not configured|not tested/i.test(resolved.status)) return resolved;
  return { ...resolved, status: "Temporarily unavailable" };
}

/** True when core MLB data paths are usable even if PrizePicks is down. */
export function resolveCoreLiveDataAvailable({
  apiHealth = {},
  connectionReport = null,
  audit = null,
  renderSourceAudit = null,
} = {}) {
  const meta = connectionReport || {};
  const rows = meta.results || [];
  const find = (name) =>
    rows.find((row) => String(row.provider || "").toLowerCase().includes(name.toLowerCase())) || null;
  const oddsRow = find("odds");
  const sdRow = find("sportsdata");
  const ud = resolveUserFacingLineFeedStatus(apiHealth?.Underdog || {});
  const odds = resolveUserFacingOddsStatus(oddsRow, Boolean(getOddsApiKey()), Boolean(meta.testedAt));
  const sd = resolveUserFacingSportsDataStatus(sdRow, Boolean(getSportsDataApiKey()), Boolean(meta.testedAt));

  const underdogOk = ud.status === "Live" || ud.status === "Cached";
  const oddsOk = odds.status === "Connected";
  const sportsDataOk = sd.status === "Connected";
  const liveProviderCount = Number(
    renderSourceAudit?.liveProviderCount ?? audit?.liveProviderCount ?? 0
  );

  return underdogOk || oddsOk || sportsDataOk || liveProviderCount > 0;
}

export function buildUserFacingProviderStatusRows({
  apiHealth = {},
  connectionReport = null,
  pipelineProjectionStats = null,
} = {}) {
  const meta = connectionReport || {};
  const rows = meta.results || [];
  const testedAt = meta.testedAt || "";
  const find = (name) =>
    rows.find((row) => String(row.provider || "").toLowerCase().includes(name.toLowerCase())) || null;
  const oddsRow = find("odds");
  const sdRow = find("sportsdata");

  let oddsKeyConfigured = false;
  let sdKeyConfigured = false;
  try {
    oddsKeyConfigured = Boolean(getOddsApiKey());
    sdKeyConfigured = Boolean(getSportsDataApiKey());
  } catch {
    // ignore in non-browser contexts
  }

  const pp = resolveUserFacingLineFeedStatus(apiHealth?.PrizePicks || {});
  const ud = resolveUserFacingLineFeedStatus(apiHealth?.Underdog || {});
  const odds = resolveUserFacingOddsStatus(oddsRow, oddsKeyConfigured, Boolean(testedAt));
  const sd = resolveUserFacingSportsDataStatus(sdRow, sdKeyConfigured, Boolean(testedAt));
  const projection = resolveProjectionEngineStatus({
    projectionCount: pipelineProjectionStats?.projectionCount ?? pipelineProjectionStats?.withProjections ?? 0,
    normalizedCount: pipelineProjectionStats?.normalizedCount ?? pipelineProjectionStats?.normalized ?? 0,
    projectionCoverage: pipelineProjectionStats?.projectionCoverage ?? 0,
    fetchFailed: Boolean(pipelineProjectionStats?.fetchFailed),
    lastError: pipelineProjectionStats?.lastError || "",
  });

  return [
    { provider: "Odds API", status: odds.status, detail: odds.detail },
    { provider: "SportsDataIO", status: sd.status, detail: sd.detail },
    {
      provider: "Underdog",
      status: ud.status === "Live" ? "Live" : ud.status === "Cached" ? "Cached" : ud.status,
      detail: ud.detail,
    },
    { provider: "PrizePicks", status: pp.status, detail: pp.detail },
    { provider: "Projection Engine", status: projection.status, detail: projection.detail },
  ];
}

/** User-facing stats verification label — SportsDataIO primary, MLB Stats optional fallback. */
export function resolveStatsVerificationStatus({
  connectionReport = null,
  mlbPipelineStatus = null,
} = {}) {
  const meta = connectionReport || {};
  const rows = meta.results || [];
  const testedAt = meta.testedAt || "";
  const find = (name) =>
    rows.find((row) => String(row.provider || "").toLowerCase().includes(name.toLowerCase())) || null;
  const sdRow = find("sportsdata");
  const mlbRow = find("mlb stats");

  let sdKeyConfigured = false;
  try {
    sdKeyConfigured = Boolean(getSportsDataApiKey());
  } catch {
    // ignore in non-browser contexts
  }

  const sd = resolveUserFacingSportsDataStatus(sdRow, sdKeyConfigured, Boolean(testedAt));
  const sportsDataPipelineOk = Boolean(
    sd.status === "Connected" ||
      Number(mlbPipelineStatus?.sportsDataProfilesMatched ?? mlbPipelineStatus?.profilesMatched) > 0 ||
      Number(mlbPipelineStatus?.projectionCount) > 0
  );

  if (sd.status === "Connected" || sportsDataPipelineOk) {
    return {
      status: "Live via SportsDataIO",
      detail: sd.detail || "SportsDataIO player/stat data available",
    };
  }

  const mlb = resolveStrictMlbStatsStatus({
    testResult: mlbRow,
    pipelineStats: mlbPipelineStatus || {},
  });
  if (mlb.status === "Connected") {
    return {
      status: "Live via MLB Stats API",
      detail: mlb.detail,
    };
  }

  return {
    status: "Partial Verification",
    detail: "Limited stat verification available",
  };
}
