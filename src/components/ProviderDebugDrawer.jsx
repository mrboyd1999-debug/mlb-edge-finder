import { styles } from "../theme/styles.js";
import { formatDateTime } from "../utils/formatters.js";

export default function ProviderDebugDrawer({ debugInfo = {}, pipelineAudit = {}, apiHealth = {}, lastUpdated = "" }) {
  const sources = debugInfo?.sources || {};
  const counters = debugInfo?.pipelineCounters || pipelineAudit?.pipelineCounters || {};
  const rejected = Number(counters.rejected ?? pipelineAudit?.rejected ?? 0);
  const parsed = Number(counters.parsed ?? counters.normalized ?? 0);
  const accepted = Number(counters.accepted ?? counters.display ?? 0);

  const sourceRows = Object.entries(sources).map(([name, row]) => ({
    name,
    status: row?.status || row?.lineSourceBadge || "—",
    raw: row?.rawPropsLoaded ?? 0,
    parsed: row?.propsAfterParsing ?? 0,
    usable: row?.usablePropsCount ?? row?.propsAfterParsing ?? 0,
    error: row?.message || row?.lastError || "",
    lastFetch: row?.lastSuccessfulFetchAt || "",
  }));

  const lastSuccess = sourceRows
    .filter((row) => row.usable > 0 || row.lastFetch)
    .sort((a, b) => new Date(b.lastFetch).getTime() - new Date(a.lastFetch).getTime())[0];

  return (
    <details className="provider-debug-drawer dfs-section" style={styles.compactDetails}>
      <summary style={styles.detailsSummary}>
        <span className="details-summary-stack">
          <span style={styles.eyebrow}>Debug</span>
          <strong>Provider Debug Drawer</strong>
        </span>
        <span style={styles.countPill}>{parsed} parsed</span>
      </summary>
      <div className="provider-debug-panel" style={styles.compactPanel}>
        <p style={styles.compactFlags}>
          parsed {parsed} · accepted {accepted} · rejected {rejected}
          {lastUpdated ? ` · updated ${formatDateTime(lastUpdated)}` : ""}
        </p>
        {lastSuccess ? (
          <p style={{ ...styles.compactFlags, color: "#86efac" }}>
            Last successful source: {lastSuccess.name} ({lastSuccess.usable} usable)
          </p>
        ) : null}
        {sourceRows.map((row) => (
          <div key={row.name} style={{ marginTop: "8px" }}>
            <strong style={{ fontSize: 12 }}>{row.name}</strong>
            <p style={styles.compactFlags}>
              {row.status} · raw {row.raw} · parsed {row.parsed} · usable {row.usable}
              {row.lastFetch ? ` · ${formatDateTime(row.lastFetch)}` : ""}
            </p>
            {row.error ? <p style={{ ...styles.compactFlags, color: "#fca5a5" }}>{row.error}</p> : null}
          </div>
        ))}
        {apiHealth?.PrizePicks?.lastError || apiHealth?.Underdog?.lastError || apiHealth?.OddsAPI?.lastError ? (
          <div style={{ marginTop: "8px" }}>
            <strong style={{ fontSize: 12 }}>Fetch errors</strong>
            {apiHealth?.PrizePicks?.lastError ? <p style={styles.compactFlags}>PrizePicks: {apiHealth.PrizePicks.lastError}</p> : null}
            {apiHealth?.Underdog?.lastError ? <p style={styles.compactFlags}>Underdog: {apiHealth.Underdog.lastError}</p> : null}
            {apiHealth?.OddsAPI?.lastError ? <p style={styles.compactFlags}>Odds API: {apiHealth.OddsAPI.lastError}</p> : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
