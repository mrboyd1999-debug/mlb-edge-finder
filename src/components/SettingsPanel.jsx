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
import { connectionStatusStyle, testAllApiConnections } from "../services/apiConnectionTest.js";

export default function SettingsPanel({
  onSaved,
  onClearCaches,
  showDebugPanels = false,
  onShowDebugPanelsChange,
}) {
  const panelRef = useRef(null);
  const [draft, setDraft] = useState(() => readRuntimeSettings());
  const [saved, setSaved] = useState(() => readRuntimeSettings());
  const [meta, setMeta] = useState(() => readSettingsMeta());
  const [notice, setNotice] = useState("");
  const [testing, setTesting] = useState(false);
  const [connectionReport, setConnectionReport] = useState(null);

  const isSaved = settingsDraftMatchesSaved(draft, saved);
  const apiValidation = validateApiConfig();

  function collapsePanel() {
    if (panelRef.current) panelRef.current.open = false;
  }

  function handleSave() {
    writeRuntimeSettings(draft);
    const nextSaved = readRuntimeSettings();
    setSaved(nextSaved);
    setMeta(readSettingsMeta());
    setNotice("Settings saved.");
    onClearCaches?.();
    onSaved?.(nextSaved);
    collapsePanel();
  }

  async function handleTestConnections() {
    setTesting(true);
    setConnectionReport(null);
    try {
      const report = await testAllApiConnections();
      setConnectionReport(report);
      writeSettingsMeta({
        ...readSettingsMeta(),
        lastTestedAt: report.testedAt,
        lastConnectionReport: report.results,
      });
      setMeta(readSettingsMeta());
      collapsePanel();
    } catch (error) {
      setNotice(error?.message || "Connection test failed.");
    } finally {
      setTesting(false);
    }
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
        <p className="mobile-hide-verbose" style={{ ...styles.compactFlags, margin: "8px 0 0" }}>
          Keys are stored in <code>localStorage</code> for development. For production, set the same{" "}
          <code>VITE_*</code> variables in Vercel — never commit <code>.env.local</code>.
        </p>
        {apiValidation.warnings.length > 0 ? (
          <ul className="mobile-hide-verbose" style={{ ...styles.explanationList, margin: "4px 0 0", paddingLeft: "18px" }}>
            {apiValidation.warnings.map((warning) => (
              <li key={warning} style={{ ...styles.compactFlags, color: apiValidation.ok ? "#fcd34d" : "#fca5a5" }}>
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
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
        {connectionReport?.results?.length ? (
          <div style={{ marginTop: "8px" }}>
            <strong style={{ fontSize: 13 }}>Connection test</strong>
            {connectionReport.results.map((row) => (
              <div key={row.provider} style={{ ...styles.apiHealthRow, marginTop: "6px" }}>
                <div style={styles.apiHealthRowTop}>
                  <span style={styles.sourceName}>{row.provider}</span>
                  <span style={connectionStatusStyle(row.status)}>{row.status}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
