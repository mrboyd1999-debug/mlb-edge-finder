import { providerStatusStyle } from "../services/providerHealth.js";
import { styles } from "../theme/styles.js";

const PRIMARY_PROVIDERS = ["PrizePicks", "Underdog", "Odds API"];

function findProviderRow(results = [], name) {
  return results.find((row) => String(row.provider || "").toLowerCase() === name.toLowerCase()) || null;
}

export default function ApiHealthPanel({ connectionReport = null }) {
  const results = connectionReport?.results || [];
  const rows = PRIMARY_PROVIDERS.map((label) => {
    const row = findProviderRow(results, label);
    const settingsLine = row?.settingsLine || row?.displayStatus || (row ? "—" : "Not tested");
    return { label, settingsLine };
  });

  return (
    <div className="api-health-settings-panel" style={{ marginTop: "10px" }}>
      <strong style={{ fontSize: 13 }}>API Health</strong>
      <div style={{ marginTop: "8px" }}>
        {rows.map((row) => (
          <p key={row.label} style={{ ...styles.compactFlags, margin: "4px 0", display: "flex", justifyContent: "space-between", gap: "8px" }}>
            <span>{row.label}</span>
            <span style={providerStatusStyle(row.settingsLine)}>{row.settingsLine}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
