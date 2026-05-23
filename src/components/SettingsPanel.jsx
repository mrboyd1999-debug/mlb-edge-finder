import { useState } from "react";
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
import { connectionStatusStyle, testAllApiConnections } from "../services/apiConnectionTest.js";

export default function SettingsPanel({ onSaved, onClearCaches }) {
  const [draft, setDraft] = useState(() => readRuntimeSettings());
  const [saved, setSaved] = useState(() => readRuntimeSettings());
  const [meta, setMeta] = useState(() => readSettingsMeta());
  const [notice, setNotice] = useState("");
  const [testing, setTesting] = useState(false);
  const [connectionReport, setConnectionReport] = useState(null);

  const isSaved = settingsDraftMatchesSaved(draft, saved);

  function handleSave() {
    writeRuntimeSettings(draft);
    const nextSaved = readRuntimeSettings();
    setSaved(nextSaved);
    setMeta(readSettingsMeta());
    setNotice("Settings saved locally. Click Refresh lines to apply.");
    onClearCaches?.();
    onSaved?.(nextSaved);
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
    } catch (error) {
      setNotice(error?.message || "Connection test failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <details style={styles.compactDetails}>
      <summary style={styles.detailsSummary}>
        <span>
          <span style={styles.eyebrow}>Runtime setup</span>
          <strong>Settings</strong>
        </span>
        <span style={styles.countPill}>{isSaved ? "Saved" : "Unsaved changes"}</span>
      </summary>
      <div style={styles.compactPanel}>
        <p style={styles.compactFlags}>
          Keys are stored in <code>localStorage</code> for development. For production, set the same{" "}
          <code>VITE_*</code> variables in Vercel — never commit <code>.env.local</code>.
        </p>
        <div style={styles.controls}>
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
                <span style={{ fontSize: 11, opacity: 0.65 }}>{def.key}</span>
              </label>
            );
          })}
        </div>
        <div style={{ ...styles.segmentRow, marginTop: "8px", flexWrap: "wrap" }}>
          <button type="button" style={styles.secondaryButton} onClick={handleSave}>
            Save settings
          </button>
          <button type="button" style={styles.secondaryButton} onClick={handleTestConnections} disabled={testing}>
            {testing ? "Testing API connections…" : "Test API Connections"}
          </button>
          {meta.savedAt ? (
            <span style={styles.compactFlags}>Last saved: {formatDateTime(meta.savedAt)}</span>
          ) : null}
          {meta.lastTestedAt ? (
            <span style={styles.compactFlags}>Last tested: {formatDateTime(meta.lastTestedAt)}</span>
          ) : null}
          {notice ? <p style={styles.compactFlags}>{notice}</p> : null}
        </div>
        {connectionReport?.results?.length ? (
          <div style={{ marginTop: "12px" }}>
            <strong style={{ fontSize: 13 }}>Connection test results</strong>
            {connectionReport.results.map((row) => (
              <div key={row.provider} style={{ ...styles.apiHealthRow, marginTop: "8px" }}>
                <div style={styles.apiHealthRowTop}>
                  <span style={styles.sourceName}>{row.provider}</span>
                  <span style={connectionStatusStyle(row.status)}>{row.status}</span>
                </div>
                <p style={styles.compactFlags}>
                  {row.message}
                  {row.durationMs ? ` · ${row.durationMs}ms` : ""}
                  {row.route ? ` · ${row.route}` : ""}
                </p>
                {row.preview ? <p style={styles.compactFlags}>{row.preview}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
