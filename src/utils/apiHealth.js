/**
 * Central API health status — standardized green / yellow / red labels.
 */

import { getOddsApiKey, getSportsDataApiKey } from "../services/runtimeSettings.js";
import { formatDateTime } from "./formatters.js";
import { resolvePrizePicksProviderHealth, resolveUnderdogPropCounts, underdogFeedIsConnected } from "./providerStatus.js";

export const API_STATUS_COLOR = {
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red",
};

/** Usable cached prop feeds remain green for up to 24 hours. */
export const USABLE_PROP_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function findProviderRow(results = [], name) {
  return results.find((row) => String(row.provider || "").toLowerCase().includes(name.toLowerCase())) || null;
}

function parseTimestamp(value = "") {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function resolveCacheAgeMs(feed = {}) {
  const ts =
    parseTimestamp(feed.lastFetchAt) ??
    parseTimestamp(feed.lastSuccessfulFetchAt) ??
    parseTimestamp(feed.cacheAge);
  if (ts == null) return null;
  return Date.now() - ts;
}

function formatCacheAgeLabel(feed = {}) {
  const ageMs = resolveCacheAgeMs(feed);
  if (ageMs == null) return feed.cacheAge || "—";
  if (ageMs < 60_000) return "< 1 min";
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)} min`;
  if (ageMs < 86_400_000) return `${(ageMs / 3_600_000).toFixed(1)} hr`;
  return `${(ageMs / 86_400_000).toFixed(1)} days`;
}

function hasUsableProps(feed = {}) {
  return finite(feed.activeUsableCount ?? feed.usableCount ?? feed.boardCount) > 0;
}

function isSportsDataConnected(row = {}, mlbPipelineStatus = null) {
  const playersTest = row.endpointTests?.find((entry) => entry.id === "players");
  const statsTest = row.endpointTests?.find((entry) =>
    /stats|mlb/i.test(String(entry.id || entry.label || ""))
  );
  const playersOk =
    playersTest?.ok === true ||
    (Number(playersTest?.httpStatus) === 200 && Number(playersTest?.recordCount) >= 0);
  const statsOk = statsTest?.ok === true || Number(statsTest?.httpStatus) === 200;
  const settingsOk = /connected/i.test(String(row.settingsLine || row.statusLabel || ""));
  const pipelineOk =
    finite(mlbPipelineStatus?.sportsDataProfilesMatched ?? mlbPipelineStatus?.profilesMatched) > 0 ||
    finite(mlbPipelineStatus?.projectionCount) > 0;
  return Boolean(row.ok || settingsOk || playersOk || statsOk || pipelineOk);
}

function resolveOddsApiHealth({ row, keyConfigured, testedAt, oddsFeed = {} }) {
  const debug = {
    endpointTested: "/sports",
    responseCode: row?.httpStatus ?? row?.status ?? null,
    lastChecked: testedAt || null,
    cacheAge: oddsFeed.cacheAge || "—",
    propsReturned: finite(oddsFeed.usableCount ?? oddsFeed.parsedCount),
    keyPresent: keyConfigured,
    failureReason: "",
  };

  if (!keyConfigured) {
    return {
      status: "Missing API key",
      color: API_STATUS_COLOR.RED,
      detail: "Add Odds API key in Settings",
      debug: { ...debug, failureReason: "No API key saved" },
    };
  }

  if (row?.unauthorized || /invalid/i.test(String(row?.settingsLine || row?.statusLabel || ""))) {
    return {
      status: "Invalid API key",
      color: API_STATUS_COLOR.RED,
      detail: row?.preview || row?.message || "Key rejected by Odds API",
      debug: { ...debug, failureReason: "Unauthorized / invalid key", responseCode: row?.status ?? 401 },
    };
  }

  if (row?.rateLimited) {
    return {
      status: "Rate limited",
      color: API_STATUS_COLOR.YELLOW,
      detail: "Odds API rate limit — cached odds may still be in use",
      debug: { ...debug, failureReason: "Rate limited", responseCode: 429 },
    };
  }

  const sportsOk = Boolean(row?.sportsListOk || row?.ok);
  const propsOk = hasUsableProps(oddsFeed);
  if (sportsOk || propsOk) {
    return {
      status: "Connected",
      color: API_STATUS_COLOR.GREEN,
      detail: propsOk
        ? `${debug.propsReturned} odds props available`
        : row?.sportsCount != null
          ? `${row.sportsCount} sports listed`
          : "Sports endpoint OK",
      debug: { ...debug, failureReason: "" },
    };
  }

  if (row?.timedOut || row?.networkError) {
    return {
      status: "Network failure",
      color: API_STATUS_COLOR.RED,
      detail: row?.preview || row?.message || "Odds API request failed",
      debug: { ...debug, failureReason: row?.preview || "Network failure" },
    };
  }

  if (!testedAt) {
    return {
      status: "Missing optional data",
      color: API_STATUS_COLOR.YELLOW,
      detail: "Save key and run Retest All",
      debug: { ...debug, failureReason: "Not tested yet" },
    };
  }

  return {
    status: "Network failure",
    color: API_STATUS_COLOR.RED,
    detail: row?.preview || row?.message || "Odds API probe failed",
    debug: { ...debug, failureReason: row?.preview || "Probe failed" },
  };
}

function resolveSportsDataHealth({ row, keyConfigured, testedAt, mlbPipelineStatus = null }) {
  const playersTest = row?.endpointTests?.find((entry) => entry.id === "players");
  const debug = {
    endpointTested: playersTest?.url || "/Players",
    responseCode: playersTest?.httpStatus ?? row?.httpStatus ?? row?.status ?? null,
    lastChecked: testedAt || null,
    cacheAge: "—",
    propsReturned: finite(mlbPipelineStatus?.profilesMatched ?? mlbPipelineStatus?.sportsDataProfilesMatched),
    keyPresent: keyConfigured,
    failureReason: "",
  };

  if (!keyConfigured) {
    return {
      status: "Missing API key",
      color: API_STATUS_COLOR.RED,
      detail: "Add SportsDataIO key in Settings",
      debug: { ...debug, failureReason: "No API key saved" },
    };
  }

  if (row?.unauthorized || /invalid/i.test(String(row?.settingsLine || row?.statusLabel || ""))) {
    return {
      status: "Invalid API key",
      color: API_STATUS_COLOR.RED,
      detail: row?.message || "Key rejected by SportsDataIO",
      debug: { ...debug, failureReason: "Unauthorized / invalid key" },
    };
  }

  if (row?.rateLimited) {
    return {
      status: "Rate limited",
      color: API_STATUS_COLOR.YELLOW,
      detail: "SportsDataIO rate limited",
      debug: { ...debug, failureReason: "Rate limited", responseCode: 429 },
    };
  }

  if (isSportsDataConnected(row, mlbPipelineStatus)) {
    return {
      status: "Connected",
      color: API_STATUS_COLOR.GREEN,
      detail: debug.propsReturned
        ? `${debug.propsReturned} player profiles matched`
        : playersTest?.message || "Player endpoint OK",
      debug: { ...debug, failureReason: "" },
    };
  }

  if (row?.timedOut || row?.networkError) {
    return {
      status: "Network failure",
      color: API_STATUS_COLOR.RED,
      detail: row?.preview || row?.message || "SportsDataIO request failed",
      debug: { ...debug, failureReason: row?.preview || "Network failure" },
    };
  }

  return {
    status: "Required provider unavailable",
    color: API_STATUS_COLOR.RED,
    detail: playersTest?.message || row?.message || "SportsDataIO endpoints failed",
    debug: { ...debug, failureReason: playersTest?.message || row?.message || "Endpoint failed" },
  };
}

function resolveUnderdogHealth(
  feed = {},
  {
    pipelinePropCountAudit = null,
    feedHealthContext = null,
    debugSources = null,
    underdogResult = null,
    underdogProps = null,
    debugInfo = null,
  } = {}
) {
  const counts = resolveUnderdogPropCounts({
    feed,
    pipelinePropCountAudit,
    feedHealthContext,
    debugSources,
    underdogResult,
    underdogProps,
    debugInfo,
  });
  const propsReturned = Math.max(
    counts.usableUnderdogProps,
    counts.parsedUnderdogProps,
    counts.rawUnderdogProps
  );
  const hasProps = underdogFeedIsConnected(counts) || propsReturned > 0;
  const live = Boolean(feed.liveHttpOk && !feed.cached && !feed.fallback && hasProps);
  const cacheAgeMs = resolveCacheAgeMs(feed);
  const cacheFresh =
    cacheAgeMs == null ? Boolean(feed.cached && hasProps) : cacheAgeMs <= USABLE_PROP_CACHE_MAX_AGE_MS;
  const usedCache = Boolean(
    feed.cached ||
      feed.fallback ||
      /cached|fallback/i.test(String(feed.lineSourceBadge || feed.statusLabel || feed.status || ""))
  );
  const debug = {
    endpointTested: feed.endpoint || "/underdog/props",
    responseCode: feed.httpStatus ?? null,
    lastChecked: feed.lastFetchAt || null,
    cacheAge: formatCacheAgeLabel(feed),
    propsReturned,
    keyPresent: true,
    failureReason: feed.lastError || "",
    ...counts,
  };

  if (hasProps && (live || (!usedCache && !feed.timedOut))) {
    return {
      status: "Connected",
      color: API_STATUS_COLOR.GREEN,
      detail: `${propsReturned} props`,
      debug: { ...debug, failureReason: "" },
    };
  }

  if (hasProps && usedCache && cacheFresh) {
    return {
      status: "Connected via cache",
      color: API_STATUS_COLOR.GREEN,
      detail: `${propsReturned} props`,
      debug: { ...debug, failureReason: "" },
    };
  }

  if (hasProps && usedCache && !cacheFresh) {
    return {
      status: "Cache stale",
      color: API_STATUS_COLOR.YELLOW,
      detail: `${propsReturned} cached props (${debug.cacheAge})`,
      debug: { ...debug, failureReason: "Cache older than 24 hours" },
    };
  }

  if (feed.timedOut || feed.fetchFailed) {
    return {
      status: "Temporarily unavailable",
      color: API_STATUS_COLOR.YELLOW,
      detail: feed.lastError || "Underdog feed timed out",
      debug: { ...debug, failureReason: feed.lastError || "Timed out" },
    };
  }

  return {
    status: "Temporarily unavailable",
    color: API_STATUS_COLOR.YELLOW,
    detail: feed.lastError || "No usable Underdog props",
    debug: { ...debug, failureReason: feed.lastError || "No usable props" },
  };
}

function resolvePrizePicksHealth(feed = {}, options = {}) {
  return resolvePrizePicksProviderHealth(feed, options);
}

function resolveMlbStatsHealth({ sportsDataHealth, mlbStatsTest = null, mlbPipelineStatus = null }) {
  const debug = {
    endpointTested: mlbStatsTest?.searchEndpoint || "/people/search",
    responseCode: mlbStatsTest?.searchStatus ?? null,
    lastChecked: mlbStatsTest?.testedAt || mlbPipelineStatus?.mlbStatsApi?.lastSuccessAt || null,
    cacheAge: mlbPipelineStatus?.mlbStatsApi?.usingCache ? "cached" : "—",
    propsReturned: finite(mlbStatsTest?.playerCount ?? mlbPipelineStatus?.profilesMatched),
    keyPresent: true,
    failureReason: "",
  };

  if (sportsDataHealth.color === API_STATUS_COLOR.GREEN) {
    return {
      status: "Covered by SportsDataIO",
      color: API_STATUS_COLOR.GREEN,
      detail: "Player lookup, stats, and probable pitchers via SportsDataIO",
      debug: { ...debug, failureReason: "", endpointTested: "SportsDataIO (primary)" },
    };
  }

  const mlbConnected =
    mlbStatsTest?.connected === true ||
    finite(mlbStatsTest?.playerCount) > 0 ||
    finite(mlbPipelineStatus?.profilesMatched ?? mlbPipelineStatus?.gameLogsAttached) > 0;

  if (mlbConnected) {
    return {
      status: "Connected",
      color: API_STATUS_COLOR.GREEN,
      detail: mlbStatsTest?.detail || "MLB Stats API player search OK",
      debug: { ...debug, failureReason: "" },
    };
  }

  return {
    status: "Unavailable",
    color: API_STATUS_COLOR.RED,
    detail: mlbStatsTest?.detail || mlbPipelineStatus?.mlbStatsApi?.lastError || "MLB Stats API unavailable",
    debug: {
      ...debug,
      failureReason: mlbStatsTest?.error || mlbPipelineStatus?.mlbStatsApi?.lastError || "Lookup failed",
    },
  };
}

function resolveProjectionEngineHealth({ pipelineProjectionStats = null, mlbPipelineStatus = null } = {}) {
  const projectionCount = finite(
    pipelineProjectionStats?.projectionCount ?? pipelineProjectionStats?.withProjections
  );
  const fetchFailed = Boolean(
    pipelineProjectionStats?.fetchFailed ||
      /failed/i.test(String(mlbPipelineStatus?.projectionApi?.status || ""))
  );
  const debug = {
    endpointTested: "projection pipeline",
    responseCode: fetchFailed ? "error" : projectionCount > 0 ? 200 : null,
    lastChecked:
      mlbPipelineStatus?.projectionApi?.lastProjectionGeneratedAt ||
      mlbPipelineStatus?.projectionApi?.lastSuccessAt ||
      null,
    cacheAge: "—",
    propsReturned: projectionCount,
    keyPresent: true,
    failureReason: pipelineProjectionStats?.lastError || mlbPipelineStatus?.projectionApi?.lastError || "",
  };

  if (projectionCount > 0) {
    const normalized = finite(pipelineProjectionStats?.normalizedCount ?? pipelineProjectionStats?.normalized);
    const pct = normalized > 0 ? Math.round((projectionCount / normalized) * 100) : 100;
    return {
      status: "Connected",
      color: API_STATUS_COLOR.GREEN,
      detail: `${projectionCount} projections${normalized > 0 ? ` · ${pct}% coverage` : ""}`,
      debug: { ...debug, failureReason: "" },
    };
  }

  if (fetchFailed) {
    return {
      status: "No projections generated",
      color: API_STATUS_COLOR.YELLOW,
      detail: debug.failureReason || "Projection pipeline error",
      debug,
    };
  }

  return {
    status: "No projections generated",
    color: API_STATUS_COLOR.YELLOW,
    detail: "No projections on current props",
    debug: { ...debug, failureReason: "Zero projections" },
  };
}

function resolvePropSourceAvailable({ underdogHealth, prizePicksHealth, oddsHealth, oddsFeed = {} }) {
  const underdogOk =
    underdogHealth.color === API_STATUS_COLOR.GREEN ||
    (underdogHealth.status === "Cache stale" && hasUsableProps({ usableCount: underdogHealth.debug?.propsReturned }));
  const prizePicksOk = prizePicksHealth.color === API_STATUS_COLOR.GREEN;
  const oddsPropsOk = hasUsableProps(oddsFeed) || oddsHealth.color === API_STATUS_COLOR.GREEN;
  return underdogOk || prizePicksOk || oddsPropsOk;
}

function resolveOverallHealth({
  oddsHealth,
  sportsDataHealth,
  projectionHealth,
  propSourceAvailable,
}) {
  const coreGreen =
    oddsHealth.color === API_STATUS_COLOR.GREEN &&
    sportsDataHealth.color === API_STATUS_COLOR.GREEN &&
    projectionHealth.color === API_STATUS_COLOR.GREEN &&
    propSourceAvailable;

  if (coreGreen) {
    return {
      status: "Live Data Available",
      color: API_STATUS_COLOR.GREEN,
      detail: "Core providers connected with at least one prop source",
      debug: { failureReason: "" },
    };
  }

  const anyRedRequired =
    oddsHealth.color === API_STATUS_COLOR.RED ||
    sportsDataHealth.color === API_STATUS_COLOR.RED ||
    (!propSourceAvailable && oddsHealth.color !== API_STATUS_COLOR.GREEN);

  if (anyRedRequired) {
    return {
      status: "Limited Data",
      color: API_STATUS_COLOR.YELLOW,
      detail: "Some required providers need attention — optional feeds may still work",
      debug: {
        failureReason: [
          oddsHealth.color === API_STATUS_COLOR.RED ? "Odds API" : null,
          sportsDataHealth.color === API_STATUS_COLOR.RED ? "SportsDataIO" : null,
          !propSourceAvailable ? "Prop sources" : null,
        ]
          .filter(Boolean)
          .join(", "),
      },
    };
  }

  return {
    status: "Live Data Available",
    color: API_STATUS_COLOR.GREEN,
    detail: "Usable data available",
    debug: { failureReason: "" },
  };
}

/** Stats verification label when SportsDataIO is primary. */
export function resolveStatsVerificationFromHealth(sportsDataHealth = {}) {
  if (sportsDataHealth.color === API_STATUS_COLOR.GREEN) {
    return {
      status: "Live via SportsDataIO",
      detail: sportsDataHealth.detail || "SportsDataIO player/stat data available",
      color: API_STATUS_COLOR.GREEN,
    };
  }
  return {
    status: "Partial Verification",
    detail: sportsDataHealth.detail || "Limited stat verification available",
    color: API_STATUS_COLOR.YELLOW,
  };
}

export function apiStatusColorToConnectionTier(color = "") {
  if (color === API_STATUS_COLOR.GREEN) return "Connected";
  if (color === API_STATUS_COLOR.YELLOW) return "Warning";
  return "Failed";
}

export function apiStatusStyle(color = "") {
  const tier = apiStatusColorToConnectionTier(color);
  const palette = {
    Connected: { bg: "rgba(34,197,94,0.18)", text: "#86efac", border: "rgba(34,197,94,0.35)" },
    Warning: { bg: "rgba(234,179,8,0.18)", text: "#fde047", border: "rgba(234,179,8,0.35)" },
    Failed: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5", border: "rgba(239,68,68,0.3)" },
  };
  const colors = palette[tier] || palette.Warning;
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    background: colors.bg,
    color: colors.text,
    border: `1px solid ${colors.border}`,
  };
}

/**
 * Central API health snapshot for dashboard + debug panels.
 */
export function getApiHealthStatus({
  apiHealth = {},
  connectionReport = null,
  mlbPipelineStatus = null,
  pipelineProjectionStats = null,
  mlbStatsTest = null,
  pipelinePropCountAudit = null,
  feedHealthContext = null,
  debugSources = null,
} = {}) {
  const meta = connectionReport || {};
  const rows = meta.results || [];
  const testedAt = meta.testedAt || "";
  const oddsRow = findProviderRow(rows, "Odds API");
  const sdRow = findProviderRow(rows, "SportsDataIO");
  const ppFeed = apiHealth?.PrizePicks || {};
  const udFeed = apiHealth?.Underdog || {};
  const oddsFeed = apiHealth?.OddsAPI || apiHealth?.["Odds API"] || {};

  let oddsKeyConfigured = false;
  let sdKeyConfigured = false;
  try {
    oddsKeyConfigured = Boolean(getOddsApiKey());
    sdKeyConfigured = Boolean(getSportsDataApiKey());
  } catch {
    // non-browser
  }
  oddsKeyConfigured = oddsKeyConfigured || Boolean(oddsRow?.keyConfigured);
  sdKeyConfigured = sdKeyConfigured || Boolean(sdRow?.keyConfigured ?? sdRow?.keySaved);

  const oddsApi = resolveOddsApiHealth({
    row: oddsRow,
    keyConfigured: oddsKeyConfigured,
    testedAt,
    oddsFeed,
  });
  const sportsDataIO = resolveSportsDataHealth({
    row: sdRow,
    keyConfigured: sdKeyConfigured,
    testedAt,
    mlbPipelineStatus,
  });
  const underdog = resolveUnderdogHealth(udFeed, {
    pipelinePropCountAudit: pipelinePropCountAudit || feedHealthContext?.pipelinePropCountAudit,
    feedHealthContext,
    debugSources: debugSources || apiHealth?.debugSources,
  });
  const prizePicks = resolvePrizePicksHealth(ppFeed, {
    alternatePropSourcesAvailable:
      underdog.color === API_STATUS_COLOR.GREEN ||
      oddsApi.color === API_STATUS_COLOR.GREEN ||
      hasUsableProps(oddsFeed),
    pipelinePropCountAudit: pipelinePropCountAudit || feedHealthContext?.pipelinePropCountAudit,
    feedHealthContext,
    debugSources: debugSources || apiHealth?.debugSources,
  });
  const mlbStats = resolveMlbStatsHealth({
    sportsDataHealth: sportsDataIO,
    mlbStatsTest,
    mlbPipelineStatus,
  });
  const projectionEngine = resolveProjectionEngineHealth({
    pipelineProjectionStats,
    mlbPipelineStatus,
  });

  const propSourceAvailable = resolvePropSourceAvailable({
    underdogHealth: underdog,
    prizePicksHealth: prizePicks,
    oddsHealth: oddsApi,
    oddsFeed,
  });

  const overall = resolveOverallHealth({
    oddsHealth: oddsApi,
    sportsDataHealth: sportsDataIO,
    projectionHealth: projectionEngine,
    propSourceAvailable,
  });

  const statsVerification = resolveStatsVerificationFromHealth(sportsDataIO);

  return {
    oddsApi,
    sportsDataIO,
    underdog,
    prizePicks,
    mlbStats,
    projectionEngine,
    overall,
    statsVerification,
    propSourceAvailable,
    testedAt,
    providerRows: buildProviderStatusRows({
      oddsApi,
      sportsDataIO,
      underdog,
      prizePicks,
      mlbStats,
      projectionEngine,
    }),
  };
}

export function buildProviderStatusRows({
  oddsApi,
  sportsDataIO,
  underdog,
  prizePicks,
  mlbStats,
  projectionEngine,
} = {}) {
  return [
    { provider: "Odds API", ...oddsApi },
    { provider: "SportsDataIO", ...sportsDataIO },
    { provider: "Underdog", ...underdog },
    { provider: "PrizePicks", ...prizePicks },
    { provider: "MLB Stats", ...mlbStats },
    { provider: "Projection Engine", ...projectionEngine },
  ];
}

export function formatApiHealthDebugRow(label, entry = {}) {
  const debug = entry.debug || {};
  return {
    label,
    status: entry.status,
    color: entry.color,
    endpointTested: debug.endpointTested || "—",
    responseCode: debug.responseCode ?? "—",
    lastChecked: debug.lastChecked ? formatDateTime(debug.lastChecked) : "—",
    cacheAge: debug.cacheAge || "—",
    propsReturned: debug.propsReturned ?? "—",
    keyPresent: debug.keyPresent ? "Yes" : "No",
    failureReason: debug.failureReason || "—",
  };
}
