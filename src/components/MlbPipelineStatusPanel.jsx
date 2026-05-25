import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { styles } from "../theme/styles.js";
import { healthStateStyle } from "../services/sourceHealth.js";

const ROW_STYLE = {
  display: "grid",
  gap: "4px",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid #334155",
  background: "#0f172a",
};

function resolveDisplayStatus(row = {}) {
  const tier = row.connectionTier || row.status || "Pending";
  const label = row.statusLabel || tier;
  return { tier, label };
}

function StatusRow({ label, row = {}, lastSuccessAt, lastError, details = [], extraTimestamp = "" }) {
  const { tier, label: statusLabel } = resolveDisplayStatus(row);
  return (
    <div style={ROW_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12 }}>{label}</strong>
        <span style={healthStateStyle(tier)}>{statusLabel}</span>
      </div>
      <p style={{ ...styles.compactFlags, margin: 0, color: "#94a3b8" }}>
        Last success: {lastSuccessAt ? formatDateTime(lastSuccessAt) : "—"}
      </p>
      {extraTimestamp ? (
        <p style={{ ...styles.compactFlags, margin: 0, color: "#94a3b8" }}>
          {extraTimestamp}
        </p>
      ) : null}
      {row.ingestionSummary ? (
        <p style={{ ...styles.compactFlags, margin: 0, color: "#64748b", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10 }}>
          {row.ingestionSummary}
        </p>
      ) : null}
      {lastError && tier === "Failed" ? (
        <p style={{ ...styles.compactFlags, margin: 0, color: "#fca5a5" }}>{lastError}</p>
      ) : null}
      {details.map((line) => (
        <p key={line} style={{ ...styles.compactFlags, margin: 0, color: "#64748b", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10 }}>
          {line}
        </p>
      ))}
    </div>
  );
}

function MlbPipelineStatusPanel({ pipelineStatus = null, apiHealth = null, compact = false }) {
  const stats = pipelineStatus?.mlbStatsApi || {};
  const projection = pipelineStatus?.projectionApi || {};
  const pp = { ...(apiHealth?.PrizePicks || {}), ...(pipelineStatus?.dfsSources?.PrizePicks || {}) };
  const ud = { ...(apiHealth?.Underdog || {}), ...(pipelineStatus?.dfsSources?.Underdog || {}) };

  const statsDetails = [
    stats.lastUrl ? `URL: ${stats.lastUrl}` : "",
    stats.lastStatusCode != null ? `HTTP ${stats.lastStatusCode}` : "",
    stats.playersReturned != null ? `Players returned: ${stats.playersReturned}` : "",
    stats.matchedPlayer ? `Matched: ${stats.matchedPlayer}${stats.playerId ? ` (${stats.playerId})` : ""}` : "",
  ].filter(Boolean);

  const projectionDetails = [
    projection.lastPlayer && projection.lastStat ? `Last: ${projection.lastPlayer} · ${projection.lastStat}` : "",
    projection.lastProjection != null ? `Projection used: ${projection.lastProjection}` : "",
  ].filter(Boolean);

  return (
    <div className="mlb-pipeline-status-panel" style={{ display: "grid", gap: compact ? "6px" : "8px", marginTop: compact ? "8px" : "10px" }}>
      {!compact ? (
        <>
          <strong style={{ fontSize: 13 }}>MLB Pipeline Status</strong>
          <p style={{ ...styles.compactFlags, margin: 0, color: "#94a3b8" }}>
            Verified projections only — props without real MLB data are not graded.
          </p>
        </>
      ) : null}
      <StatusRow
        label="PrizePicks"
        row={pp}
        lastSuccessAt={pp.lastSuccessAt || pp.lastFetchAt}
        lastError={pp.lastError}
      />
      <StatusRow
        label="Underdog"
        row={ud}
        lastSuccessAt={ud.lastSuccessAt || ud.lastFetchAt}
        lastError={ud.lastError}
      />
      <StatusRow
        label={stats.label || "MLB Stats API"}
        row={{ status: stats.status, connectionTier: stats.status, statusLabel: stats.status }}
        lastSuccessAt={stats.lastSuccessAt}
        lastError={stats.lastError}
        details={statsDetails}
      />
      <StatusRow
        label={projection.label || "MLB Projection Engine"}
        row={{
          status: projection.status,
          connectionTier: projection.status,
          statusLabel: projection.status,
        }}
        lastSuccessAt={projection.lastSuccessAt}
        lastError={projection.lastError}
        extraTimestamp={
          projection.lastProjectionGeneratedAt
            ? `Last projection generated: ${formatDateTime(projection.lastProjectionGeneratedAt)}`
            : ""
        }
        details={projectionDetails}
      />
    </div>
  );
}

export default memo(MlbPipelineStatusPanel);
