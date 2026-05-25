import { useRef, useState, useEffect } from "react";
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
import { testAllApiConnections, testSportsDataIO, mergeConnectionReportWithFeeds } from "../services/apiConnectionTest.js";
import { isDebugModeEnabled } from "../utils/devMode.js";

export default function SettingsPanel({
  onSaved,
  onClearCaches,
  onConnectionReportChange,
  lastUpdated = "",
  feedHealthContext = null,
}) {
  const panelRef = useRef(null);
  const [draft, setDraft] = useState(() => readRuntimeSettings());
  const [saved, setSaved] = useState(() => readRuntimeSettings());
  const [meta, setMeta] = useState(() => readSettingsMeta());
  const [notice, setNotice] = useState("");
  const [testing, setTesting] = useState(false);
  const [testingSportsData, setTestingSportsData] = useState(false);
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
      const report = await testAllApiConnections({
        feedContext: feedHealthContext || undefined,
        lastUpdated,
      });
      setConnectionReport(report);
      writeSettingsMeta({
        ...readSettingsMeta(),
        lastTestedAt: report.testedAt,
        lastConnectionReport: report.results,
      });
      setMeta(readSettingsMeta());
      const failed = (report.results || []).filter((row) => row.showError === true);
      setNotice(
        failed.length
          ? `${failed.length} provider${failed.length === 1 ? "" : "s"} need attention.`
          : "Connections verified."
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

  async function handleTestSportsData() {
    setTestingSportsData(true);
    try {
      const report = await testSportsDataIO();
      setConnectionReport((current) => {
        const otherResults = (current?.results || []).filter(
          (row) => String(row.provider || "").toLowerCase() !== "sportsdataio"
        );
        const merged = mergeConnectionReportWithFeeds(
          {
            testedAt: report.testedAt,
            durationMs: report.durationMs,
            results: [...otherResults, ...(report.results || [])],
          },
          feedHealthContext || {}
        );
        writeSettingsMeta({
          ...readSettingsMeta(),
          lastTestedAt: merged.testedAt,
          lastConnectionReport: merged.results,
        });
        return merged;
      });
      setMeta(readSettingsMeta());
      const sdRow = (report.results || [])[0];
      setNotice(
        sdRow?.settingsLine === "Connected" || sdRow?.settingsLine === "Connected via Proxy"
          ? "SportsDataIO connected."
          : `SportsDataIO: ${sdRow?.settingsLine || "test complete"}.`
      );
    } catch (error) {
      setNotice(error?.message || "SportsDataIO test failed.");
    } finally {
      setTestingSportsData(false);
    }
  }

  async function handleTestConnections() {
    await runConnectionTest({ collapseAfter: true });
  }

  useEffect(() => {
    onConnectionReportChange?.(connectionReport);
  }, [connectionReport, onConnectionReportChange]);

  useEffect(() => {
    if (!feedHealthContext) return;
    setConnectionReport((current) => {
      const base = current?.results?.length
        ? current
        : readSettingsMeta().lastConnectionReport?.length
          ? {
              testedAt: readSettingsMeta().lastTestedAt,
              results: readSettingsMeta().lastConnectionReport,
            }
          : null;
      if (!base?.results?.length) return current;
      try {
        return mergeConnectionReportWithFeeds(base, feedHealthContext);
      } catch (error) {
        console.error("[Settings] Feed merge failed — keeping last report", error);
        return current;
      }
    });
  }, [feedHealthContext]);

  return (
    <details id="section-settings" ref={panelRef} className="settings-panel compact-settings-details">
      <summary>
        <span>
          <span className="mobile-hide-verbose settings-panel__eyebrow">Runtime setup</span>
          <strong>Settings</strong>
        </span>
        <span className="settings-panel__pill">{isSaved ? "Saved" : "Unsaved"}</span>
      </summary>
      <div style={styles.compactPanel}>
        <div className="settings-test-row" style={{ ...styles.segmentRow, marginTop: 0, flexWrap: "wrap" }}>
          <button type="button" style={styles.secondaryButton} onClick={handleSave}>
            Save
          </button>
          <button type="button" style={styles.secondaryButton} onClick={handleTestConnections} disabled={testing}>
            {testing ? "Testing…" : "Test API"}
          </button>
          <button type="button" style={styles.secondaryButton} onClick={handleTestSportsData} disabled={testingSportsData}>
            {testingSportsData ? "Testing…" : "Test SportsDataIO"}
          </button>
        </div>
        <p className="mobile-hide-verbose settings-panel__hint">
          Keys are stored locally for development. Set <code>VITE_*</code> variables in Vercel for production.
        </p>
        {apiValidation.warnings.length > 0 && debugModeEnabled ? (
          <ul className="mobile-hide-verbose settings-panel__warnings">
            {apiValidation.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <details className="settings-keys-expand compact-settings-details" style={{ marginTop: "8px" }}>
          <summary>
            <span>
              <span className="mobile-hide-verbose settings-panel__eyebrow">Credentials</span>
              <strong>API Keys</strong>
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
                </label>
              );
            })}
          </div>
        </details>
        <div style={{ ...styles.segmentRow, marginTop: "8px", flexWrap: "wrap" }}>
          {meta.savedAt ? (
            <span className="mobile-hide-verbose settings-panel__meta">Last saved: {formatDateTime(meta.savedAt)}</span>
          ) : null}
          {notice ? <p style={styles.compactFlags}>{notice}</p> : null}
        </div>
      </div>
    </details>
  );
}
