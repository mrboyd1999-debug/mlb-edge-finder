import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { styles } from "../theme/styles.js";

const ROW_STYLE = {
  display: "grid",
  gap: "4px",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid #334155",
  background: "#0f172a",
};

function statusColor(status = "") {
  const key = String(status || "").toLowerCase();
  if (key === "connected" || key === "live") return "#86efac";
  if (key === "failed") return "#fca5a5";
  if (key === "pending") return "#cbd5e1";
  return "#fde047";
}

function StatusRow({ label, status, lastSuccessAt, lastError, details = [] }) {
  return (
    <div style={ROW_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
        <strong style={{ fontSize: 12 }}>{label}</strong>
        <span style={{ fontSize: 11, fontWeight: 800, color: statusColor(status) }}>{status || "Pending"}</span>
      </div>
      <p style={{ ...styles.compactFlags, margin: 0, color: "#94a3b8" }}>
        Last success: {lastSuccessAt ? formatDateTime(lastSuccessAt) : "—"}
      </p>
      {lastError ? (
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
  const pp = pipelineStatus?.dfsSources?.PrizePicks || apiHealth?.PrizePicks || {};
  const ud = pipelineStatus?.dfsSources?.Underdog || apiHealth?.Underdog || {};

  const statsDetails = [
    stats.lastUrl ? `URL: ${stats.lastUrl}` : "",
    stats.lastStatusCode != null ? `HTTP ${stats.lastStatusCode}` : "",
    stats.playersReturned != null ? `Players returned: ${stats.playersReturned}` : "",
    stats.matchedPlayer ? `Matched: ${stats.matchedPlayer}${stats.playerId ? ` (${stats.playerId})` : ""}` : "",
    projection.lastProjection != null ? `Last projection: ${projection.lastProjection}` : "",
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
        status={pp.status || pp.statusLabel || "Pending"}
        lastSuccessAt={pp.lastSuccessAt || pp.lastFetchAt}
        lastError={pp.lastError}
      />
      <StatusRow
        label="Underdog"
        status={ud.status || ud.statusLabel || "Pending"}
        lastSuccessAt={ud.lastSuccessAt || ud.lastFetchAt}
        lastError={ud.lastError}
      />
      <StatusRow
        label={stats.label || "MLB Stats API"}
        status={stats.status}
        lastSuccessAt={stats.lastSuccessAt}
        lastError={stats.lastError}
        details={statsDetails}
      />
      <StatusRow
        label={projection.label || "MLB Projection Engine"}
        status={projection.status}
        lastSuccessAt={projection.lastSuccessAt}
        lastError={projection.lastError}
        details={[
          projection.lastPlayer && projection.lastStat ? `Last: ${projection.lastPlayer} · ${projection.lastStat}` : "",
          projection.lastProjection != null ? `Projection used: ${projection.lastProjection}` : "",
        ].filter(Boolean)}
      />
    </div>
  );
}

export default memo(MlbPipelineStatusPanel);
