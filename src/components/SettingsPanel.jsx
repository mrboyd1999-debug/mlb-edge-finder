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
import ApiHealthPanel from "./ApiHealthPanel.jsx";
import UnderdogDebugPanel from "./UnderdogDebugPanel.jsx";
import ParsedUnderdogDebugCard from "./ParsedUnderdogDebugCard.jsx";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import { testAllApiConnections, testSportsDataIO, mergeConnectionReportWithFeeds } from "../services/apiConnectionTest.js";
import { isDebugModeEnabled } from "../utils/devMode.js";

export default function SettingsPanel({
  onSaved,
  onClearCaches,
  showDebugPanels = false,
  onShowDebugPanelsChange,
  lastUpdated = "",
  feedHealthContext = null,
  underdogDebugSnapshot = null,
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
          ? `${failed.length} provider${failed.length === 1 ? "" : "s"} need attention — see API Health below.`
          : "Provider health updated from live feed + probe."
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
        sdRow?.debugLine ||
          (sdRow?.settingsLine === "Connected" || sdRow?.settingsLine === "Connected via Proxy"
            ? sdRow.settingsLine === "Connected via Proxy"
              ? "SportsDataIO connected via backend proxy."
              : "SportsDataIO endpoint tested successfully."
            : `SportsDataIO: ${sdRow?.settingsLine || "test complete"} — see console for details.`)
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
        console.error("[API Health] Feed merge failed — keeping last report", error);
        return current;
      }
    });
  }, [feedHealthContext]);

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
          <button type="button" style={styles.secondaryButton} onClick={handleTestSportsData} disabled={testingSportsData}>
            {testingSportsData ? "Testing…" : "Test SportsDataIO"}
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
        <SectionErrorBoundary
          name="API Health"
          fallback={
            <div className="api-health-settings-panel" style={{ marginTop: "10px" }}>
              <strong style={{ fontSize: 13 }}>API Health</strong>
              <p style={{ ...styles.compactFlags, margin: "6px 0 0", color: "#fcd34d" }}>
                API diagnostics temporarily unavailable.
              </p>
            </div>
          }
        >
          <ApiHealthPanel connectionReport={connectionReport} lastTestedAt={meta.lastTestedAt} />
        </SectionErrorBoundary>
        <UnderdogDebugPanel snapshot={underdogDebugSnapshot} />
        {showDebugPanels && underdogDebugSnapshot?.parsedPreview?.length ? (
          <ParsedUnderdogDebugCard picks={underdogDebugSnapshot.parsedPreview} />
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
      </div>
    </details>
  );
}
