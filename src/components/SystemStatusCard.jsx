import { memo, useState, useCallback } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { readSettingsMeta, getOddsApiKey, getSportsDataApiKey, writeSettingsMeta } from "../services/runtimeSettings.js";
import { healthStateStyle, CONNECTION_TIERS } from "../services/sourceHealth.js";
import { isPrizePicksFeedNotConfigured, PRIZEPICKS_NOT_CONFIGURED_DETAIL } from "../utils/providerProxy.js";
import { testAllApiConnections } from "../services/apiConnectionTest.js";
import { testMlbStatsApiConnection } from "../services/mlbStatsApiTest.js";
import { resolveProjectionEngineStatus } from "../utils/projectionPipelineStatus.js";

function findProviderRow(results = [], name) {
  return results.find((row) => String(row.provider || "").toLowerCase().includes(name.toLowerCase())) || null;
}

function formatCheckedAt(value) {
  if (!value) return "—";
  const formatted = formatDateTime(value);
  if (!formatted) return "—";
  const timePart = formatted.split(",").pop()?.trim();
  return timePart || formatted;
}

function statusTier(status) {
  const key = String(status || "").toLowerCase();
  if (key === "connected") return CONNECTION_TIERS.CONNECTED;
  if (key === "refreshing") return CONNECTION_TIERS.REFRESHING;
  if (key === "warning") return CONNECTION_TIERS.WARNING;
  if (key === "degraded" || key === "not configured" || key === "not tested" || key === "limited") {
    return CONNECTION_TIERS.DEGRADED;
  }
  return CONNECTION_TIERS.FAILED;
}

function indicatorTier(status) {
  const key = String(status || "").toLowerCase();
  if (key === "connected") return "ok";
  if (key === "refreshing") return "info";
  if (key === "warning" || key === "degraded" || key === "not configured" || key === "not tested" || key === "limited") {
    return "warn";
  }
  return "fail";
}

function resolveOddsStatus(row, keyConfigured, tested) {
  if (!keyConfigured) return { status: "Not configured", detail: "Add Odds API key in Settings" };
  if (!tested || !row) return { status: "Not tested", detail: "Save key and run Retest All" };
  const label = String(row.settingsLine || row.statusLabel || row.displayStatus || "").trim();
  if (/^connected$/i.test(label) || row.sportsListOk) {
    const extra = row.debugLine || (row.sportsCount != null ? `${row.sportsCount} sports listed` : "Sports endpoint OK");
    return { status: "Connected", detail: extra };
  }
  if (/invalid/i.test(label) || row.unauthorized) {
    return { status: "Invalid key", detail: row.responseBody || row.message || row.lastError || "Key rejected by Odds API" };
  }
  if (/rate/i.test(label) || row.rateLimited) {
    return { status: "Limited", detail: row.message || "Rate limited" };
  }
  return {
    status: "Failed",
    detail: row.responseBody || row.message || row.lastError || label || `HTTP ${row.httpStatus ?? "?"}`,
  };
}

function resolveKeyProviderStatus(row, keyConfigured, tested) {
  if (!keyConfigured) return { status: "Not configured", detail: "API key not saved" };
  if (!tested || !row) return { status: "Not tested", detail: "Run Retest All after saving key" };
  const label = String(row.settingsLine || row.statusLabel || "").trim();
  if (/^connected$/i.test(label)) {
    return { status: "Connected", detail: row.debugLine || row.message || "Key valid" };
  }
  if (/not configured/i.test(label)) return { status: "Not configured", detail: row.message || "" };
  if (/invalid|unauthorized/i.test(label) || row.unauthorized) {
    return { status: "Invalid key", detail: row.responseBody || row.message || label };
  }
  if (/rate/i.test(label) || row.rateLimited) {
    return { status: "Limited", detail: row.message || "Rate limited" };
  }
  return { status: "Failed", detail: row.message || row.lastError || label || "Connection failed" };
}

function resolveLineFeedStatus(feed = {}) {
  const statusLabel = String(feed.statusLabel || feed.lastError || "").trim();
  const tier = String(feed.connectionTier || feed.status || "");
  const active = Number(feed.activeUsableCount ?? feed.usableCount) || 0;
  const timedOut =
    /timed?\s*out/i.test(statusLabel) || /timed?\s*out/i.test(feed.lastError || "") || tier === CONNECTION_TIERS.DEGRADED;

  if (active > 0) {
    if (tier === CONNECTION_TIERS.CONNECTED) {
      return { status: "Connected", detail: `${active} props in use (live refresh)` };
    }
    if (tier === CONNECTION_TIERS.REFRESHING) {
      return { status: "Refreshing", detail: `${active} props in use while refresh runs` };
    }
    if (tier === CONNECTION_TIERS.WARNING) {
      return {
        status: "Warning",
        detail: timedOut
          ? `Refresh timed out — ${active} cached props in use`
          : `${active} props in use (cached)`,
      };
    }
    return {
      status: "Degraded",
      detail: timedOut
        ? `Refresh timed out — ${active} cached props in use`
        : `${active} props in use (cached)`,
    };
  }

  if (tier === CONNECTION_TIERS.CONNECTED) {
    return { status: "Connected", detail: statusLabel || "Feed OK" };
  }

  if (Number(feed.rawCount) > 0 && Number(feed.parsedCount) > 0 && active === 0) {
    return { status: "Degraded", detail: "API returned data but 0 usable MLB props after filters" };
  }

  if (Number(feed.rawCount) > 0 && active === 0) {
    return { status: "Degraded", detail: "API returned data but parser produced 0 usable props" };
  }

  if (timedOut) {
    return { status: "Failed", detail: statusLabel || feed.lastError || "Timed out — no cached props" };
  }

  if (tier === CONNECTION_TIERS.FAILED || /failed|unavailable/i.test(statusLabel)) {
    return { status: "Failed", detail: statusLabel || feed.lastError || "Feed fetch failed" };
  }

  if (/not configured/i.test(String(feed.status || ""))) {
    return { status: "Not configured", detail: PRIZEPICKS_NOT_CONFIGURED_DETAIL };
  }

  return { status: "Failed", detail: statusLabel || feed.lastError || "No usable props" };
}

function resolveMlbStatsStatus(stats = {}) {
  if (stats.status === "Connected") {
    return { status: "Connected", detail: stats.lastError ? stats.lastError : "Game logs OK" };
  }
  if (stats.status === "Refreshing") {
    return { status: "Refreshing", detail: "Refreshing MLB player profiles" };
  }
  if (stats.status === "Warning") {
    return { status: "Warning", detail: stats.lastError || "Using cached MLB player profiles" };
  }
  return { status: "Failed", detail: stats.lastError || stats.failureReason || "Stats API unavailable" };
}

function resolveProjectionStatus(projection = {}, pipelineStats = {}) {
  const fetchFailed =
    /failed/i.test(String(projection.status || "")) &&
    !Number(pipelineStats.projectionCount);
  const resolved = resolveProjectionEngineStatus({
    projectionCount: pipelineStats.projectionCount,
    normalizedCount: pipelineStats.normalizedCount,
    projectionCoverage: pipelineStats.projectionCoverage,
    fetchFailed,
    lastError: projection.lastError || projection.failureReason || "",
  });
  return {
    ...resolved,
    checkedAt: projection.lastProjectionGeneratedAt || projection.lastSuccessAt,
  };
}

function StatusTableRow({ provider, status, checkedAt, detail }) {
  const tier = indicatorTier(status);
  return (
    <tr className="system-status-card__table-row">
      <td className="system-status-card__table-provider">
        <span className={`system-status-card__dot system-status-card__dot--${tier}`} aria-hidden="true" />
        {provider}
      </td>
      <td>
        <span style={healthStateStyle(statusTier(status))}>{status}</span>
      </td>
      <td className="system-status-card__table-time">{formatCheckedAt(checkedAt)}</td>
      <td className="system-status-card__table-detail">{detail || "—"}</td>
    </tr>
  );
}

function SystemStatusCard({
  apiHealth = {},
  mlbPipelineStatus = null,
  connectionReport = null,
  onConnectionReportChange,
  feedHealthContext = null,
  pipelineProjectionStats = null,
}) {
  const meta = readSettingsMeta();
  const reportRows = connectionReport?.results || meta.lastConnectionReport || [];
  const testedAt = connectionReport?.testedAt || meta.lastTestedAt || "";
  const hasBeenTested = Boolean(testedAt);
  const oddsRow = findProviderRow(reportRows, "Odds API");
  const sdRow = findProviderRow(reportRows, "SportsDataIO");

  const [retesting, setRetesting] = useState(false);
  const [testingMlbStats, setTestingMlbStats] = useState(false);
  const [mlbStatsTest, setMlbStatsTest] = useState(null);

  const handleTestMlbStats = useCallback(async () => {
    setTestingMlbStats(true);
    try {
      const result = await testMlbStatsApiConnection();
      setMlbStatsTest(result);
    } catch (error) {
      console.error("[System Status] MLB Stats test failed", error);
      setMlbStatsTest({
        status: "Failed",
        connected: false,
        detail: error?.message || "MLB Stats API test failed",
        responseTimeMs: 0,
        playerCount: 0,
        gameLogCount: 0,
      });
    } finally {
      setTestingMlbStats(false);
    }
  }, []);

  const handleRetestAll = useCallback(async () => {
    setRetesting(true);
    try {
      const report = await testAllApiConnections({ feedContext: feedHealthContext });
      writeSettingsMeta({
        ...readSettingsMeta(),
        lastTestedAt: report.testedAt,
        lastConnectionReport: report.results,
      });
      onConnectionReportChange?.(report);
    } catch (error) {
      console.error("[System Status] Retest failed", error);
    } finally {
      setRetesting(false);
    }
  }, [feedHealthContext, onConnectionReportChange]);

  const pp = apiHealth?.PrizePicks || {};
  const ud = apiHealth?.Underdog || {};
  const ppResolved = isPrizePicksFeedNotConfigured(pp)
    ? { status: "Not configured", detail: PRIZEPICKS_NOT_CONFIGURED_DETAIL }
    : resolveLineFeedStatus(pp);
  const udResolved = resolveLineFeedStatus(ud);
  const oddsResolved = resolveOddsStatus(oddsRow, Boolean(getOddsApiKey()), hasBeenTested);
  const sdResolved = resolveKeyProviderStatus(sdRow, Boolean(getSportsDataApiKey()), hasBeenTested);

  const stats = mlbPipelineStatus?.mlbStatsApi || {};
  const projection = mlbPipelineStatus?.projectionApi || {};
  const statsResolved = mlbStatsTest
    ? {
        status: mlbStatsTest.status,
        detail: mlbStatsTest.connected
          ? `Connected · ${mlbStatsTest.responseTimeMs}ms · ${mlbStatsTest.playerCount} players · ${mlbStatsTest.gameLogCount} game logs`
          : mlbStatsTest.detail,
        checkedAt: mlbStatsTest.testedAt,
      }
    : resolveMlbStatsStatus(stats);
  const projectionResolved = resolveProjectionStatus(projection, pipelineProjectionStats || {});

  const rows = [
    { provider: "Odds API", ...oddsResolved, checkedAt: testedAt },
    { provider: "PrizePicks", ...ppResolved, checkedAt: pp.lastFetchAt || testedAt },
    { provider: "Underdog", ...udResolved, checkedAt: ud.lastFetchAt || testedAt },
    { provider: "SportsDataIO", ...sdResolved, checkedAt: testedAt },
    { provider: "MLB Stats API", ...statsResolved, checkedAt: mlbStatsTest?.testedAt || stats.lastSuccessAt },
    {
      provider: "Projection Engine",
      status: projectionResolved.status,
      detail: projectionResolved.detail,
      checkedAt: projectionResolved.checkedAt || projection.lastProjectionGeneratedAt || projection.lastSuccessAt,
    },
  ];

  return (
    <section className="system-status-card" aria-label="System status">
      <div className="system-status-card__head">
        <strong>System Status</strong>
        <div className="system-status-card__actions">
          <button
            type="button"
            className="system-status-card__retest"
            onClick={handleTestMlbStats}
            disabled={testingMlbStats}
          >
            {testingMlbStats ? "Testing Stats…" : "Test Stats API"}
          </button>
          <button
            type="button"
            className="system-status-card__retest"
            onClick={handleRetestAll}
            disabled={retesting}
          >
            {retesting ? "Testing…" : "Retest All"}
          </button>
        </div>
      </div>
      {mlbStatsTest ? (
        <p className="system-status-card__meta">
          MLB Stats test: {mlbStatsTest.searchEndpoint || "search"} · HTTP {mlbStatsTest.searchStatus ?? "?"} ·{" "}
          {mlbStatsTest.responseTimeMs}ms · {mlbStatsTest.playerCount} players · {mlbStatsTest.gameLogCount} game logs
          {mlbStatsTest.searchResponseBody ? ` · ${mlbStatsTest.searchResponseBody.slice(0, 120)}` : ""}
        </p>
      ) : null}
      <div className="system-status-card__table-wrap">
        <table className="system-status-card__table">
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Status</th>
              <th scope="col">Last checked</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <StatusTableRow key={row.provider} {...row} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default memo(SystemStatusCard);
