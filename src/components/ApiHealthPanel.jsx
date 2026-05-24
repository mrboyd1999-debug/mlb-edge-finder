import { providerStatusStyle } from "../services/providerHealth.js";
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
    const displayStatus = row?.displayStatus || row?.uiStatus || row?.status || "Not tested";
    const displayMessage = row?.displayMessage || row?.message || (row ? "" : "Save keys or refresh props to verify.");
    return {
      label,
      displayStatus,
      displayMessage,
      lastSuccessfulFetchAt: row?.lastSuccessfulFetchAt || "",
      lastError: row?.lastError || row?.preview || "",
      showError: row?.showError === true,
      feedUsableCount: row?.feedUsableCount ?? 0,
    };
  });

  return (
    <div className="api-health-settings-panel" style={{ marginTop: "10px" }}>
      <strong style={{ fontSize: 13 }}>API Health</strong>
      <p style={{ ...styles.compactFlags, margin: "4px 0 8px" }}>
        Status reflects parsed feed data first, then probe results.
        {lastUpdated ? ` Board updated ${formatDateTime(lastUpdated)}.` : ""}
      </p>
      {rows.map((row) => (
        <div key={row.label} style={{ ...styles.apiHealthRow, marginTop: "6px" }}>
          <div style={styles.apiHealthRowTop}>
            <span style={styles.sourceName}>{row.label}</span>
            <span style={providerStatusStyle(row.displayStatus)}>{row.displayStatus}</span>
          </div>
          {row.displayMessage ? <p style={{ ...styles.compactFlags, margin: "2px 0 0" }}>{row.displayMessage}</p> : null}
          {row.feedUsableCount > 0 ? (
            <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#86efac" }}>
              {row.feedUsableCount} usable props in current board
            </p>
          ) : null}
          {row.lastSuccessfulFetchAt ? (
            <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#86efac" }}>
              Last success: {formatDateTime(row.lastSuccessfulFetchAt)}
            </p>
          ) : null}
          {row.showError && row.lastError ? (
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
