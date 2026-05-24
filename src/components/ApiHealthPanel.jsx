import { providerStatusStyle } from "../services/providerHealth.js";
import { formatDateTime } from "../utils/formatters.js";
import { styles } from "../theme/styles.js";

const PRIMARY_PROVIDERS = ["PrizePicks", "Underdog", "Odds API", "SportsDataIO"];

function findProviderRow(results = [], name) {
  return results.find((row) => String(row.provider || "").toLowerCase() === name.toLowerCase()) || null;
}

function keySavedLabel(row) {
  if (row?.provider === "SportsDataIO") {
    return row.keySaved || row.keyConfigured ? "Key saved" : "Key not saved";
  }
  if (row?.keyConfigured === false) return "Key not saved";
  if (row?.keyConfigured) return "Key saved";
  return "";
}

export default function ApiHealthPanel({ connectionReport = null, lastTestedAt = "" }) {
  const results = connectionReport?.results || [];
  const testedAt = connectionReport?.testedAt || lastTestedAt || "";

  return (
    <div className="api-health-settings-panel" style={{ marginTop: "10px" }}>
      <strong style={{ fontSize: 13 }}>API Health</strong>
      {testedAt ? (
        <p style={{ ...styles.compactFlags, margin: "6px 0 0" }}>Last tested: {formatDateTime(testedAt)}</p>
      ) : (
        <p style={{ ...styles.compactFlags, margin: "6px 0 0" }}>Last tested: Not tested</p>
      )}
      <div className="api-health-cards" style={{ marginTop: "10px", display: "grid", gap: "8px" }}>
        {PRIMARY_PROVIDERS.map((label) => {
          const row = findProviderRow(results, label);
          const settingsLine = row?.settingsLine || row?.displayStatus || "Not Tested";
          const keyLabel = keySavedLabel(row);
          return (
            <div
              key={label}
              className="api-health-card"
              style={{
                ...styles.compactPanel,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                <strong style={{ fontSize: 13 }}>{label}</strong>
                <span style={providerStatusStyle(settingsLine)}>{settingsLine}</span>
              </div>
              {keyLabel ? <span style={styles.compactFlags}>{keyLabel}</span> : null}
              {row?.lastError && row.showError ? (
                <span style={{ ...styles.compactFlags, color: "#fca5a5" }}>{row.lastError}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
