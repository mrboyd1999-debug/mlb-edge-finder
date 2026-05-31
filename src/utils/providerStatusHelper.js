/**
 * Strict provider status — green only when live + usable; yellow for cached/fallback; red for failed.
 */

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
