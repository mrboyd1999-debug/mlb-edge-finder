import { memo, useState, useCallback } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { readSettingsMeta, writeSettingsMeta } from "../services/runtimeSettings.js";
import { testAllApiConnections } from "../services/apiConnectionTest.js";
import { testMlbStatsApiConnection } from "../services/mlbStatsApiTest.js";
import { getApiHealthStatus, apiStatusStyle, API_STATUS_COLOR } from "../utils/apiHealth.js";

function formatCheckedAt(value) {
  if (!value) return "—";
  const formatted = formatDateTime(value);
  if (!formatted) return "—";
  const timePart = formatted.split(",").pop()?.trim();
  return timePart || formatted;
}

function StatusTableRow({ provider, status, color, checkedAt, detail }) {
  return (
    <tr className="system-status-card__table-row">
      <td className="system-status-card__table-provider">
        <span
          className={`system-status-card__dot system-status-card__dot--${
            color === API_STATUS_COLOR.GREEN ? "ok" : color === API_STATUS_COLOR.YELLOW ? "warn" : "fail"
          }`}
          aria-hidden="true"
        />
        {provider}
      </td>
      <td>
        <span style={apiStatusStyle(color)}>{status}</span>
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
    setMlbStatsTest(null);
    onConnectionReportChange?.(null);
    try {
      const [report, mlbResult] = await Promise.all([
        testAllApiConnections({ feedContext: feedHealthContext, includeMlbStats: true }),
        testMlbStatsApiConnection(),
      ]);
      setMlbStatsTest(mlbResult);
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

  const health = getApiHealthStatus({
    apiHealth,
    connectionReport: connectionReport || { testedAt, results: reportRows },
    mlbPipelineStatus,
    pipelineProjectionStats,
    mlbStatsTest,
  });

  const ppFeed = apiHealth?.PrizePicks || {};
  const udFeed = apiHealth?.Underdog || {};
  const projectionCheckedAt =
    mlbPipelineStatus?.projectionApi?.lastProjectionGeneratedAt ||
    mlbPipelineStatus?.projectionApi?.lastSuccessAt;

  const rows = [
    { provider: "Odds API", ...health.oddsApi, checkedAt: testedAt },
    { provider: "SportsDataIO", ...health.sportsDataIO, checkedAt: testedAt },
    { provider: "Underdog", ...health.underdog, checkedAt: udFeed.lastFetchAt || testedAt },
    { provider: "PrizePicks", ...health.prizePicks, checkedAt: ppFeed.lastFetchAt || testedAt },
    { provider: "MLB Stats API", ...health.mlbStats, checkedAt: mlbStatsTest?.testedAt || testedAt },
    {
      provider: "Projection Engine",
      ...health.projectionEngine,
      checkedAt: projectionCheckedAt || testedAt,
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
      <p className="system-status-card__meta">
        Overall: <span style={apiStatusStyle(health.overall.color)}>{health.overall.status}</span>
      </p>
      {mlbStatsTest ? (
        <p className="system-status-card__meta">
          MLB Stats test: {mlbStatsTest.searchEndpoint || "search"} · HTTP {mlbStatsTest.searchStatus ?? "?"} ·{" "}
          {mlbStatsTest.responseTimeMs}ms · {mlbStatsTest.playerCount} players · {mlbStatsTest.gameLogCount} game logs
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
