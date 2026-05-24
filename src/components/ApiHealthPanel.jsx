import { connectionStatusStyle } from "../services/apiConnectionTest.js";
import { formatDateTime } from "../utils/formatters.js";
import { styles } from "../theme/styles.js";

const PRIMARY_PROVIDERS = ["PrizePicks", "Underdog", "Odds API"];

function findProviderRow(results = [], name) {
  return results.find((row) => String(row.provider || "").toLowerCase() === name.toLowerCase()) || null;
}

export default function ApiHealthPanel({ connectionReport = null, lastUpdated = "" }) {
  const results = connectionReport?.results || [];
  const rows = PRIMARY_PROVIDERS.map((label) => {
    const row = findProviderRow(results, label);
    return {
      label,
      status: row?.status || "NOT TESTED",
      message: row?.message || (row ? "" : "Run Test API or save keys to verify."),
      lastSuccessfulFetchAt: row?.lastSuccessfulFetchAt || "",
      lastError: row?.lastError || row?.preview || "",
      route: row?.route || "",
    };
  });

  return (
    <div className="api-health-settings-panel" style={{ marginTop: "10px" }}>
      <strong style={{ fontSize: 13 }}>API Health</strong>
      <p style={{ ...styles.compactFlags, margin: "4px 0 8px" }}>
        Status reflects real probe requests — not config warnings alone.
        {lastUpdated ? ` Board updated ${formatDateTime(lastUpdated)}.` : ""}
      </p>
      {rows.map((row) => (
        <div key={row.label} style={{ ...styles.apiHealthRow, marginTop: "6px" }}>
          <div style={styles.apiHealthRowTop}>
            <span style={styles.sourceName}>{row.label}</span>
            <span style={connectionStatusStyle(row.status)}>{row.status}</span>
          </div>
          {row.message ? <p style={{ ...styles.compactFlags, margin: "2px 0 0" }}>{row.message}</p> : null}
          {row.lastSuccessfulFetchAt ? (
            <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#86efac" }}>
              Last success: {formatDateTime(row.lastSuccessfulFetchAt)}
            </p>
          ) : null}
          {row.lastError && /FAILED|INVALID|DEGRADED/i.test(String(row.status)) ? (
            <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#fca5a5" }}>{row.lastError}</p>
          ) : null}
        </div>
      ))}
      {connectionReport?.testedAt ? (
        <p style={{ ...styles.compactFlags, margin: "8px 0 0" }}>
          Last tested: {formatDateTime(connectionReport.testedAt)}
        </p>
      ) : null}
    </div>
  );
}
