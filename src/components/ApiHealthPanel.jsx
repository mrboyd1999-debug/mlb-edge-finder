import { providerStatusStyle } from "../services/providerHealth.js";
import { getOddsApiKeyDebugInfo, ODDS_API_INVALID_KEY_MESSAGE, sanitizeOddsApiUiMessage } from "../services/oddsApiClient.js";
import { formatDateTime } from "../utils/formatters.js";
import { styles } from "../theme/styles.js";

const PRIMARY_PROVIDERS = ["PrizePicks", "Underdog", "Odds API", "SportsDataIO"];

function findProviderRow(results = [], name) {
  return results.find((row) => String(row.provider || "").toLowerCase() === name.toLowerCase()) || null;
}

function sportsDataKeySaved(row) {
  return Boolean(row?.keySaved || row?.keyConfigured);
}

function formatProviderError(row = {}) {
  if (!row?.showError) return "";
  const raw = row?.lastError || row?.preview || row?.message || "";
  if (String(row?.provider || "").toLowerCase() === "odds api") {
    return sanitizeOddsApiUiMessage(raw) || ODDS_API_INVALID_KEY_MESSAGE;
  }
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.startsWith("{") || text.startsWith("[")) return "Connection check failed.";
  return text.slice(0, 180);
}

function providerDetails(label, row, testedAt) {
  if (label === "SportsDataIO") {
    return {
      savedKey: sportsDataKeySaved(row) ? "Yes" : "No",
      lastTested: testedAt ? formatDateTime(testedAt) : "Not tested",
      result: row?.settingsLine || "Not Used",
      error: formatProviderError(row),
      debugLine: row?.debugLine || "",
    };
  }
  if (label === "Odds API") {
    const keyDebug = getOddsApiKeyDebugInfo();
    return {
      result: row?.settingsLine || "Not tested",
      error: formatProviderError(row),
      keyLength: row?.keyLength ?? keyDebug.keyLength,
      keyConfigured: row?.keyConfigured ?? keyDebug.configured,
    };
  }
  return {
    result: row?.settingsLine || "Not tested",
    error: formatProviderError(row),
  };
}

export default function ApiHealthPanel({ connectionReport = null, lastTestedAt = "" }) {
  const results = connectionReport?.results || [];
  const testedAt = connectionReport?.testedAt || lastTestedAt || "";

  return (
    <div className="api-health-settings-panel" style={{ marginTop: "10px" }}>
      <strong style={{ fontSize: 13 }}>API Health</strong>
      <p style={{ ...styles.compactFlags, margin: "6px 0 0" }}>
        Last tested: {testedAt ? formatDateTime(testedAt) : "Not tested"}
      </p>
      <div className="api-health-cards" style={{ marginTop: "10px", display: "grid", gap: "8px" }}>
        {PRIMARY_PROVIDERS.map((label) => {
          const row = findProviderRow(results, label);
          const settingsLine = row?.settingsLine || row?.displayStatus || (label === "SportsDataIO" ? "Not Used" : "Not tested");
          const details = providerDetails(label, row, testedAt);
          const isSportsData = label === "SportsDataIO";
          const isOddsApi = label === "Odds API";

          return (
            <div
              key={label}
              className={`api-health-card${isSportsData ? " api-health-card-sportsdata" : ""}`}
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
              {isSportsData ? (
                <>
                  <span style={styles.compactFlags}>Saved key: {details.savedKey}</span>
                  <span style={styles.compactFlags}>Last tested: {details.lastTested}</span>
                  <span style={styles.compactFlags}>Result: {details.result}</span>
                </>
              ) : isOddsApi ? (
                <>
                  <span style={styles.compactFlags}>Status: {details.result}</span>
                  <span style={styles.compactFlags}>
                    Odds key length: {details.keyConfigured ? details.keyLength : 0}
                  </span>
                </>
              ) : (
                <span style={styles.compactFlags}>Status: {details.result}</span>
              )}
              {details.error ? (
                <span style={{ ...styles.compactFlags, color: "#fca5a5" }}>{details.error}</span>
              ) : null}
              {isSportsData && details.debugLine ? (
                <span style={{ ...styles.compactFlags, color: "#86efac" }}>{details.debugLine}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
