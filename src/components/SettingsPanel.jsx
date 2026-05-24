import { useRef, useState } from "react";
import { styles } from "../theme/styles.js";
import { formatDateTime } from "../utils/formatters.js";
import {
  RUNTIME_SETTING_DEFS,
  readRuntimeSettings,
  readSettingsMeta,
  settingsDraftMatchesSaved,
  writeRuntimeSettings,
  writeSettingsMeta,
} from "../services/runtimeSettings.js";
import { validateApiConfig } from "../config/apiConfig.js";
import ApiHealthPanel from "./ApiHealthPanel.jsx";
import { testAllApiConnections } from "../services/apiConnectionTest.js";
import { isDebugModeEnabled } from "../utils/devMode.js";

export default function SettingsPanel({
  onSaved,
  onClearCaches,
  showDebugPanels = false,
  onShowDebugPanelsChange,
  lastUpdated = "",
}) {
  const panelRef = useRef(null);
  const [draft, setDraft] = useState(() => readRuntimeSettings());
  const [saved, setSaved] = useState(() => readRuntimeSettings());
  const [meta, setMeta] = useState(() => readSettingsMeta());
  const [notice, setNotice] = useState("");
  const [testing, setTesting] = useState(false);
  const [connectionReport, setConnectionReport] = useState(() => {
    const storedMeta = readSettingsMeta();
    if (storedMeta.lastTestedAt && Array.isArray(storedMeta.lastConnectionReport)) {
      return { testedAt: storedMeta.lastTestedAt, results: storedMeta.lastConnectionReport };
    }
    return null;
  });

  const isSaved = settingsDraftMatchesSaved(draft, saved);
  const apiValidation = validateApiConfig();
  const debugModeEnabled = isDebugModeEnabled();

  function collapsePanel() {
    if (panelRef.current) panelRef.current.open = false;
  }

  async function runConnectionTest({ collapseAfter = false } = {}) {
    setTesting(true);
    try {
      const report = await testAllApiConnections();
      setConnectionReport(report);
      writeSettingsMeta({
        ...readSettingsMeta(),
        lastTestedAt: report.testedAt,
        lastConnectionReport: report.results,
      });
      setMeta(readSettingsMeta());
      const failed = (report.results || []).filter((row) =>
        ["FAILED", "INVALID"].includes(String(row.status || "").toUpperCase())
      );
      setNotice(
        failed.length
          ? `${failed.length} provider${failed.length === 1 ? "" : "s"} failed — see API Health below.`
          : "All probed providers responded."
      );
      if (collapseAfter) collapsePanel();
      return report;
    } catch (error) {
      setNotice(error?.message || "Connection test failed.");
      return null;
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    writeRuntimeSettings(draft);
    const nextSaved = readRuntimeSettings();
    setSaved(nextSaved);
    setMeta(readSettingsMeta());
    setNotice("Settings saved — testing connections…");
    onClearCaches?.();
    onSaved?.(nextSaved);
    await runConnectionTest();
  }

  async function handleTestConnections() {
    await runConnectionTest({ collapseAfter: true });
  }

  return (
    <details id="section-settings" ref={panelRef} className="settings-panel" style={styles.compactDetails}>
      <summary style={styles.detailsSummary}>
        <span>
          <span className="mobile-hide-verbose" style={styles.eyebrow}>Runtime setup</span>
          <strong>Settings</strong>
        </span>
        <span style={styles.countPill}>{isSaved ? "Saved" : "Unsaved"}</span>
      </summary>
      <div style={styles.compactPanel}>
        <div className="settings-test-row" style={{ ...styles.segmentRow, marginTop: 0, flexWrap: "wrap" }}>
          <button type="button" style={styles.secondaryButton} onClick={handleSave}>
            Save
          </button>
          <button type="button" style={styles.secondaryButton} onClick={handleTestConnections} disabled={testing}>
            {testing ? "Testing…" : "Test API"}
          </button>
        </div>
        {debugModeEnabled ? (
        <label
          style={{
            ...styles.selectLabel,
            flexDirection: "row",
            alignItems: "center",
            gap: "8px",
            marginTop: "8px",
          }}
        >
          <input
            type="checkbox"
            checked={showDebugPanels}
            onChange={(event) => onShowDebugPanelsChange?.(event.target.checked)}
          />
          Show Debug Panels
        </label>
        ) : null}
        <p className="mobile-hide-verbose" style={{ ...styles.compactFlags, margin: "8px 0 0" }}>
          Keys are stored in <code>localStorage</code> for development. For production, set the same{" "}
          <code>VITE_*</code> variables in Vercel — never commit <code>.env.local</code>.
        </p>
        {apiValidation.warnings.length > 0 && debugModeEnabled ? (
          <ul className="mobile-hide-verbose" style={{ ...styles.explanationList, margin: "4px 0 0", paddingLeft: "18px" }}>
            {apiValidation.warnings.map((warning) => (
              <li key={warning} style={{ ...styles.compactFlags, color: "#fcd34d" }}>
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
        <ApiHealthPanel connectionReport={connectionReport} lastUpdated={lastUpdated} />
        <details className="settings-keys-expand" style={{ ...styles.compactDetails, marginTop: "8px" }}>
          <summary style={styles.detailsSummary}>
            <span>
              <span className="mobile-hide-verbose" style={styles.eyebrow}>Credentials</span>
              <strong>API Keys & Proxies</strong>
            </span>
          </summary>
          <div className="settings-key-fields" style={styles.controls}>
            {RUNTIME_SETTING_DEFS.map((def) => {
              const value = draft[def.key] || "";
              const effectiveSaved = Boolean(saved[def.key]?.trim());
              return (
                <label key={def.key} style={styles.selectLabel}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                    <span>{def.label}</span>
                    <span style={{ fontSize: 11, opacity: 0.75 }}>{effectiveSaved ? "Saved" : "Not saved"}</span>
                  </span>
                  <input
                    style={styles.textInput}
                    type={def.type === "secret" ? "password" : "text"}
                    autoComplete="off"
                    value={value}
                    onChange={(event) => setDraft((current) => ({ ...current, [def.key]: event.target.value }))}
                    placeholder={def.placeholder || def.key}
                  />
                  <span className="mobile-hide-verbose" style={{ fontSize: 11, opacity: 0.65 }}>{def.key}</span>
                </label>
              );
            })}
          </div>
        </details>
        <div style={{ ...styles.segmentRow, marginTop: "8px", flexWrap: "wrap" }}>
          {meta.savedAt ? (
            <span className="mobile-hide-verbose" style={styles.compactFlags}>Last saved: {formatDateTime(meta.savedAt)}</span>
          ) : null}
          {meta.lastTestedAt ? (
            <span className="mobile-hide-verbose" style={styles.compactFlags}>Last tested: {formatDateTime(meta.lastTestedAt)}</span>
          ) : null}
          {notice ? <p style={styles.compactFlags}>{notice}</p> : null}
        </div>
      </div>
    </details>
  );
}
