import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { getApiHealthStatus, formatApiHealthDebugRow, apiStatusStyle } from "../utils/apiHealth.js";

const DEBUG_PROVIDERS = [
  { key: "oddsApi", label: "Odds API" },
  { key: "sportsDataIO", label: "SportsDataIO" },
  { key: "underdog", label: "Underdog" },
  { key: "prizePicks", label: "PrizePicks" },
  { key: "mlbStats", label: "MLB Stats API" },
  { key: "projectionEngine", label: "Projection Engine" },
];

function ApiStatusDebugPanel({
  apiHealth = {},
  connectionReport = null,
  mlbPipelineStatus = null,
  pipelineProjectionStats = null,
  mlbStatsTest = null,
}) {
  const health = getApiHealthStatus({
    apiHealth,
    connectionReport,
    mlbPipelineStatus,
    pipelineProjectionStats,
    mlbStatsTest,
  });

  const rows = DEBUG_PROVIDERS.map(({ key, label }) =>
    formatApiHealthDebugRow(label, health[key])
  );

  return (
    <div className="api-status-debug-panel" style={{ marginTop: "10px" }}>
      <strong style={{ fontSize: 13 }}>API Health Diagnostics</strong>
      <p style={{ fontSize: 11, opacity: 0.75, margin: "6px 0 0" }}>
        Last checked: {health.testedAt ? formatDateTime(health.testedAt) : "—"} · Overall:{" "}
        <span style={apiStatusStyle(health.overall.color)}>{health.overall.status}</span>
      </p>
      <div style={{ marginTop: "10px", display: "grid", gap: "8px" }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.2)",
              fontSize: 11,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <strong>{row.label}</strong>
              <span style={apiStatusStyle(row.color)}>{row.status}</span>
            </div>
            <div style={{ display: "grid", gap: 2, opacity: 0.9 }}>
              <span>Endpoint: {row.endpointTested}</span>
              <span>Response: {row.responseCode}</span>
              <span>Last checked: {row.lastChecked}</span>
              <span>Cache age: {row.cacheAge}</span>
              <span>Props returned: {row.propsReturned}</span>
              <span>Key present: {row.keyPresent}</span>
              <span>Key source: {row.keySource}</span>
              <span>Key preview: {row.keyPreview}</span>
              {row.failureReason && row.failureReason !== "—" ? (
                <span style={{ color: "#fca5a5" }}>Failure: {row.failureReason}</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ApiStatusDebugPanel);
