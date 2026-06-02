import { useRef, useState, useEffect } from "react";
import { styles } from "../theme/styles.js";
import {
  USER_SETTING_DEFS,
  readRuntimeSettings,
  readSettingsMeta,
  userSettingsDraftMatchesSaved,
  writeRuntimeSettings,
  writeSettingsMeta,
  resolveSettingSource,
  formatSettingSourceLabel,
  getOddsApiKey,
  getSportsDataApiKey,
  getOddsApiKeySource,
  getSportsDataApiKeySource,
  maskApiKeyPreview,
  saveOddsApiKey,
} from "../services/runtimeSettings.js";
import { getOddsKeyDebugMeta, resetOddsKey, saveOddsKey } from "../lib/oddsKey.js";
import { testOddsApi } from "../lib/testOddsApi.js";
import { clearProviderHealthCache } from "../services/apiConnectionTest.js";
import { clearSourceAuthBlock, SOURCE_IDS } from "../services/sourceRateLimit.js";
import { resetOddsApiStartupValidation } from "../services/oddsApiClient.js";
import {
  testOddsAPI,
  testSportsDataIO,
  testAllApiConnections,
  mergeConnectionReportWithFeeds,
  formatOddsTestNotice,
  formatSportsDataTestNotice,
} from "../services/apiConnectionTest.js";
import { cleanApiKey, getOddsKeyLengthWarning } from "../utils/cleanApiKey.js";
import SportsDataTestResults from "./SportsDataTestResults.jsx";

function findProviderRow(results = [], name) {
  return results.find((row) => String(row.provider || "").toLowerCase() === name.toLowerCase()) || null;
}

function mergeProviderResult(current, report, providerName) {
  const otherResults = (current?.results || []).filter(
    (row) => String(row.provider || "").toLowerCase() !== providerName.toLowerCase()
  );
  return mergeConnectionReportWithFeeds(
    {
      testedAt: report.testedAt,
      durationMs: report.durationMs,
      results: [...otherResults, ...(report.results || [])],
    },
    {}
  );
}

function cleanUserDraft(rawDraft = {}) {
  return {
    ...rawDraft,
    VITE_ODDS_API_KEY: cleanApiKey(rawDraft.VITE_ODDS_API_KEY),
    VITE_SPORTSDATA_API_KEY: cleanApiKey(rawDraft.VITE_SPORTSDATA_API_KEY),
    VITE_PRIZEPICKS_PROXY_URL: String(rawDraft.VITE_PRIZEPICKS_PROXY_URL || "").trim(),
  };
}

export default function SettingsPanel({
  onSaved,
  onClearCaches,
  onConnectionReportChange,
  feedHealthContext = null,
}) {
  const panelRef = useRef(null);
  const [draft, setDraft] = useState(() => readRuntimeSettings());
  const [saved, setSaved] = useState(() => readRuntimeSettings());
  const [notice, setNotice] = useState("");
  const [testingOdds, setTestingOdds] = useState(false);
  const [testingSportsData, setTestingSportsData] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [connectionReport, setConnectionReport] = useState(() => {
    const storedMeta = readSettingsMeta();
    if (storedMeta.lastTestedAt && Array.isArray(storedMeta.lastConnectionReport)) {
      return { testedAt: storedMeta.lastTestedAt, results: storedMeta.lastConnectionReport };
    }
    return null;
  });

  const isSaved = userSettingsDraftMatchesSaved(draft, saved);

  function persistDraft() {
    const cleaned = cleanUserDraft(draft);
    if (cleaned.VITE_ODDS_API_KEY) {
      saveOddsKey(cleaned.VITE_ODDS_API_KEY);
    } else {
      resetOddsKey();
    }
    clearSourceAuthBlock(SOURCE_IDS.ODDS_API);
    resetOddsApiStartupValidation();
    setDraft(cleaned);
    const merged = { ...readRuntimeSettings(), ...cleaned };
    writeRuntimeSettings(merged);
    const nextSaved = readRuntimeSettings();
    setSaved(nextSaved);
    onClearCaches?.();
    onSaved?.(nextSaved);
    return { nextSaved, cleaned };
  }

  function buildSaveNotice(cleaned = {}) {
    const parts = ["API keys saved."];
    if (cleaned.VITE_ODDS_API_KEY) parts.push(`Odds key: ${cleaned.VITE_ODDS_API_KEY.length} chars`);
    if (cleaned.VITE_SPORTSDATA_API_KEY) parts.push(`SportsDataIO key: ${cleaned.VITE_SPORTSDATA_API_KEY.length} chars`);
    if (cleaned.VITE_PRIZEPICKS_PROXY_URL) parts.push("PrizePicks proxy URL saved");
    const oddsWarning = getOddsKeyLengthWarning(cleaned.VITE_ODDS_API_KEY);
    if (oddsWarning) parts.push(oddsWarning);
    return parts.join(" ");
  }

  async function handleSave() {
    const { cleaned } = persistDraft();
    setTestingAll(true);
    try {
      const report = await testAllApiConnections({ feedContext: feedHealthContext });
      setConnectionReport(report);
      writeSettingsMeta({
        ...readSettingsMeta(),
        lastTestedAt: report.testedAt,
        lastConnectionReport: report.results,
      });
      onConnectionReportChange?.(report);
      const oddsRow = findProviderRow(report.results || [], "Odds API");
      const sdRow = findProviderRow(report.results || [], "SportsDataIO");
      const parts = [buildSaveNotice(cleaned), "Providers retested."];
      if (oddsRow?.settingsLine) parts.push(`Odds API: ${oddsRow.settingsLine}.`);
      if (sdRow?.settingsLine) parts.push(`SportsDataIO: ${sdRow.settingsLine}.`);
      setNotice(parts.join(" "));
    } catch (error) {
      setNotice(error?.message || "Keys saved, but provider retest failed.");
    } finally {
      setTestingAll(false);
    }
  }

  function handleResetOddsKey() {
    resetOddsKey();
    clearSourceAuthBlock(SOURCE_IDS.ODDS_API);
    resetOddsApiStartupValidation();
    clearProviderHealthCache();
    window.location.reload();
  }

  async function handleSaveOddsKey() {
    const cleaned = cleanApiKey(draft.VITE_ODDS_API_KEY);
    if (!cleaned) {
      setNotice("Enter an Odds API key before saving.");
      return;
    }
    saveOddsKey(cleaned);
    clearSourceAuthBlock(SOURCE_IDS.ODDS_API);
    resetOddsApiStartupValidation();
    setDraft((current) => ({ ...current, VITE_ODDS_API_KEY: cleaned }));
    writeRuntimeSettings({ ...readRuntimeSettings(), VITE_ODDS_API_KEY: cleaned });
    setSaved(readRuntimeSettings());
    setTestingOdds(true);
    try {
      const health = await testOddsApi();
      const report = await testOddsAPI();
      setConnectionReport((current) => {
        const merged = mergeProviderResult(current, report, "Odds API");
        writeSettingsMeta({
          ...readSettingsMeta(),
          lastTestedAt: merged.testedAt,
          lastConnectionReport: merged.results,
        });
        onConnectionReportChange?.(merged);
        return merged;
      });
      const meta = getOddsKeyDebugMeta();
      const failDebug = health.ok
        ? ""
        : ` · len ${meta.keyLength} · ${meta.first4}…${meta.last4} · raw: ${
            typeof health.raw === "object" && health.raw
              ? JSON.stringify(health.raw)
              : health.details || health.status
          }`;
      setNotice(
        health.ok
          ? `Odds API connected. ${health.details || ""}`
          : `${health.status}: ${health.details || "Test failed"}${failDebug}`
      );
    } catch (error) {
      setNotice(error?.message || "Odds API save/test failed.");
    } finally {
      setTestingOdds(false);
    }
  }

  async function handleTestOdds() {
    setTestingOdds(true);
    try {
      const { cleaned } = persistDraft();
      const direct = await testOddsApi();
      if (!direct.ok && cleaned.VITE_ODDS_API_KEY) {
        const meta = getOddsKeyDebugMeta();
        const raw =
          typeof direct.raw === "object" && direct.raw
            ? JSON.stringify(direct.raw)
            : direct.details || direct.status;
        setNotice(
          `${direct.status || "Odds API test failed"} · len ${meta.keyLength} · ${meta.first4}…${meta.last4} · raw: ${raw}`
        );
      }
      const report = await testOddsAPI();
      setConnectionReport((current) => {
        const merged = mergeProviderResult(current, report, "Odds API");
        writeSettingsMeta({
          ...readSettingsMeta(),
          lastTestedAt: merged.testedAt,
          lastConnectionReport: merged.results,
        });
        return merged;
      });
      const oddsRow = (report.results || [])[0];
      setNotice(formatOddsTestNotice(oddsRow) || buildSaveNotice(cleaned));
    } catch (error) {
      setNotice(error?.message || "Odds API test failed.");
    } finally {
      setTestingOdds(false);
    }
  }

  async function handleRetestAll() {
    setTestingAll(true);
    clearProviderHealthCache();
    setConnectionReport(null);
    try {
      const { cleaned } = persistDraft();
      const report = await testAllApiConnections({ feedContext: feedHealthContext });
      setConnectionReport(report);
      writeSettingsMeta({
        ...readSettingsMeta(),
        lastTestedAt: report.testedAt,
        lastConnectionReport: report.results,
      });
      const oddsRow = findProviderRow(report.results || [], "Odds API");
      const sdRow = findProviderRow(report.results || [], "SportsDataIO");
      const parts = ["All providers tested."];
      if (oddsRow?.settingsLine) parts.push(`Odds API: ${oddsRow.settingsLine}.`);
      if (sdRow?.settingsLine) parts.push(`SportsDataIO: ${sdRow.settingsLine}.`);
      setNotice(parts.join(" ") || buildSaveNotice(cleaned));
    } catch (error) {
      setNotice(error?.message || "API retest failed.");
    } finally {
      setTestingAll(false);
    }
  }

  async function handleTestSportsData() {
    setTestingSportsData(true);
    try {
      const { cleaned } = persistDraft();
      const report = await testSportsDataIO();
      setConnectionReport((current) => {
        const merged = mergeProviderResult(current, report, "SportsDataIO");
        writeSettingsMeta({
          ...readSettingsMeta(),
          lastTestedAt: merged.testedAt,
          lastConnectionReport: merged.results,
        });
        return merged;
      });
      const sdRow = (report.results || [])[0];
      setNotice(formatSportsDataTestNotice(sdRow) || buildSaveNotice(cleaned));
    } catch (error) {
      setNotice(error?.message || "SportsDataIO test failed.");
    } finally {
      setTestingSportsData(false);
    }
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

  const oddsDef = USER_SETTING_DEFS.find((def) => def.key === "VITE_ODDS_API_KEY");
  const sdDef = USER_SETTING_DEFS.find((def) => def.key === "VITE_SPORTSDATA_API_KEY");
  const ppProxyDef = USER_SETTING_DEFS.find((def) => def.key === "VITE_PRIZEPICKS_PROXY_URL");
  const cleanedOddsDraft = cleanApiKey(draft[oddsDef.key]);
  const cleanedSdDraft = cleanApiKey(draft[sdDef.key]);
  const oddsSaved = Boolean(saved[oddsDef.key]?.trim());
  const sdSaved = Boolean(saved[sdDef.key]?.trim());
  const ppProxySaved = Boolean(saved[ppProxyDef.key]?.trim());
  const oddsKeyWarning = getOddsKeyLengthWarning(cleanedOddsDraft);
  const sdRow = findProviderRow(connectionReport?.results || [], "SportsDataIO");
  const oddsKeySource = oddsKeyDebug.source || getOddsApiKeySource();
  const sdKeySource = getSportsDataApiKeySource();
  const ppProxySource = resolveSettingSource(ppProxyDef.key);
  const oddsKeyPreview = maskApiKeyPreview(getOddsApiKey());
  const oddsKeyDebug = getOddsKeyDebugMeta();
  const sdKeyPreview = maskApiKeyPreview(getSportsDataApiKey());
  const oddsRow = findProviderRow(connectionReport?.results || [], "Odds API");

  return (
    <details id="section-settings" ref={panelRef} className="settings-panel compact-settings-details">
      <summary>
        <span>
          <span className="mobile-hide-verbose settings-panel__eyebrow">API keys</span>
          <strong>Settings</strong>
        </span>
        <span className="settings-panel__pill">{isSaved ? "Saved" : "Unsaved"}</span>
      </summary>
      <div className="settings-panel__body" style={styles.compactPanel}>
        <div className="settings-api-row">
          <label className="settings-api-row__field" style={styles.selectLabel}>
            <span className="settings-api-row__head">
              <span>{oddsDef.label}</span>
              <span className="settings-api-row__saved">{formatSettingSourceLabel(oddsKeySource)}</span>
              {oddsKeyPreview !== "missing" ? (
                <span className="settings-api-row__saved">Key {oddsKeyPreview}</span>
              ) : null}
              {oddsSaved ? (
                <span className="settings-api-row__saved">Active · {saved[oddsDef.key].length} chars</span>
              ) : null}
            </span>
            <input
              style={styles.textInput}
              type="password"
              autoComplete="off"
              value={draft[oddsDef.key] || ""}
              onChange={(event) => setDraft((current) => ({ ...current, [oddsDef.key]: event.target.value }))}
              placeholder={oddsDef.placeholder}
            />
            {oddsKeyWarning ? <span className="settings-api-row__warning">{oddsKeyWarning}</span> : null}
            <p className="settings-api-row__hint" style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.45, color: "#94a3b8" }}>
              Key source: {oddsKeyDebug.source}
              {oddsKeyDebug.keyPresent ? (
                <>
                  {" "}
                  · len {oddsKeyDebug.keyLength} · {oddsKeyDebug.first4}…{oddsKeyDebug.last4}
                </>
              ) : null}
              {oddsRow?.settingsLine ? (
                <>
                  <br />
                  Odds API status: {oddsRow.settingsLine}
                </>
              ) : null}
              {oddsRow?.showError && oddsRow?.oddsRawError ? (
                <>
                  <br />
                  Raw error: {String(oddsRow.oddsRawError).slice(0, 240)}
                </>
              ) : null}
            </p>
          </label>
          <button type="button" style={styles.secondaryButton} onClick={handleSaveOddsKey} disabled={testingOdds}>
            {testingOdds ? "Saving…" : "Save Odds Key"}
          </button>
          <button type="button" style={styles.secondaryButton} onClick={handleTestOdds} disabled={testingOdds}>
            {testingOdds ? "Testing…" : "Test Odds API"}
          </button>
          <button type="button" style={styles.secondaryButton} onClick={handleResetOddsKey}>
            Reset Odds Key
          </button>
        </div>

        <div className="settings-api-row">
          <label className="settings-api-row__field" style={styles.selectLabel}>
            <span className="settings-api-row__head">
              <span>{sdDef.label}</span>
              <span className="settings-api-row__saved">{formatSettingSourceLabel(sdKeySource)}</span>
              {sdKeyPreview !== "missing" ? (
                <span className="settings-api-row__saved">Key {sdKeyPreview}</span>
              ) : null}
              {sdSaved ? (
                <span className="settings-api-row__saved">Active · {saved[sdDef.key].length} chars</span>
              ) : null}
            </span>
            <input
              style={styles.textInput}
              type="password"
              autoComplete="off"
              value={draft[sdDef.key] || ""}
              onChange={(event) => setDraft((current) => ({ ...current, [sdDef.key]: event.target.value }))}
              placeholder={sdDef.placeholder}
            />
          </label>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={handleTestSportsData}
            disabled={testingSportsData}
          >
            {testingSportsData ? "Testing…" : "Retest SportsDataIO"}
          </button>
        </div>

        <SportsDataTestResults
          endpointTests={sdRow?.endpointTests || []}
          fallbackNote={sdRow?.mlbStatsFallbackNote || ""}
        />

        <div className="settings-api-row">
          <label className="settings-api-row__field" style={styles.selectLabel}>
            <span className="settings-api-row__head">
              <span>{ppProxyDef.label}</span>
              <span className="settings-api-row__saved">{formatSettingSourceLabel(ppProxySource)}</span>
              {ppProxySaved ? <span className="settings-api-row__saved">Active</span> : null}
            </span>
            <input
              style={styles.textInput}
              type="url"
              autoComplete="off"
              value={draft[ppProxyDef.key] || ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [ppProxyDef.key]: event.target.value }))
              }
              placeholder={ppProxyDef.placeholder}
            />
            <p className="settings-api-row__hint" style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.45, color: "#94a3b8" }}>
              PrizePicks requires a proxy URL that returns JSON with <code>data</code> +{" "}
              <code>included</code>. Set <strong>VITE_PRIZEPICKS_PROXY_URL</strong> in Settings or{" "}
              <code>.env.local</code>. Local dev: run <code>npm run proxy</code>, then use{" "}
              <code>http://localhost:4000/api/prizepicks/mlb</code>.
            </p>
          </label>
        </div>

        <div className="settings-api-actions">
          <button type="button" style={styles.secondaryButton} onClick={handleSave}>
            Save Keys
          </button>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={handleRetestAll}
            disabled={testingAll || testingOdds || testingSportsData}
          >
            {testingAll ? "Testing…" : "Retest All APIs"}
          </button>
        </div>

        {notice ? <p className="settings-panel__notice">{notice}</p> : null}
      </div>
    </details>
  );
}
