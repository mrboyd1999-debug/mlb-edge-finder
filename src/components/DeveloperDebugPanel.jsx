import { memo } from "react";
import { styles } from "../theme/styles.js";
import { HIDDEN_SETTING_DEFS, getEffectiveSetting } from "../services/runtimeSettings.js";
import ApiHealthPanel from "./ApiHealthPanel.jsx";
import MlbPipelineStatusPanel from "./MlbPipelineStatusPanel.jsx";
import UnderdogDebugPanel from "./UnderdogDebugPanel.jsx";
import ParsedUnderdogDebugCard from "./ParsedUnderdogDebugCard.jsx";
import RawApiDebugPanel from "./RawApiDebugPanel.jsx";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";

function DeveloperDebugPanel({
  connectionReport = null,
  lastTestedAt = "",
  apiHealth = null,
  mlbPipelineStatus = null,
  feedHealthContext = null,
  underdogDebugSnapshot = null,
  rejectionAudit = null,
  showDebugPanels = false,
  onShowDebugPanelsChange,
  debugModeEnabled = false,
}) {
  return (
    <div className="developer-debug-panel">
      {debugModeEnabled ? (
        <label className="developer-debug-panel__toggle">
          <input
            type="checkbox"
            checked={showDebugPanels}
            onChange={(event) => onShowDebugPanelsChange?.(event.target.checked)}
          />
          Show extended diagnostics
        </label>
      ) : null}
      <SectionErrorBoundary name="Developer Debug">
        <ApiHealthPanel connectionReport={connectionReport} lastTestedAt={lastTestedAt} />
        <MlbPipelineStatusPanel pipelineStatus={mlbPipelineStatus} apiHealth={apiHealth} compact />
        <details className="settings-advanced-config compact-settings-details">
          <summary style={styles.detailsSummary}>
            <span>
              <span className="mobile-hide-verbose" style={styles.eyebrow}>Reserved</span>
              <strong>Proxy URLs &amp; StatMuse</strong>
            </span>
          </summary>
          <div style={{ display: "grid", gap: "6px", marginTop: "8px" }}>
            {HIDDEN_SETTING_DEFS.map((def) => {
              const value = getEffectiveSetting(def.key);
              return (
                <p key={def.key} style={styles.compactFlags}>
                  {def.label}: {value ? (def.type === "secret" ? "configured" : value) : "not configured"}
                  {def.key === "VITE_STATMUSE_API_KEY" ? " — reserved, not wired in this build" : ""}
                </p>
              );
            })}
          </div>
        </details>
      </SectionErrorBoundary>

      {showDebugPanels && debugModeEnabled ? (
        <div className="developer-debug-panel__advanced">
          <UnderdogDebugPanel snapshot={underdogDebugSnapshot} />
          <details className="settings-feed-debug" style={styles.compactDetails}>
            <summary style={styles.detailsSummary}>
              <span>
                <span className="mobile-hide-verbose" style={styles.eyebrow}>Feed audit</span>
                <strong>Provider parse counts</strong>
              </span>
            </summary>
            <div style={{ display: "grid", gap: "6px", marginTop: "8px" }}>
              {["PrizePicks", "Underdog"].map((name) => {
                const row = apiHealth?.[name] || feedHealthContext?.[name] || {};
                const raw = row.rawCount ?? row.rawPropsLoaded ?? 0;
                const parsed = row.parsedCount ?? row.propsAfterParsing ?? 0;
                const usable = row.usableCount ?? row.boardCount ?? 0;
                const filtered = row.filteredCount ?? Math.max(0, Number(parsed) - Number(usable));
                const cached = row.cachedCount ?? 0;
                return (
                  <p key={name} style={styles.compactFlags}>
                    {name}: raw {raw} · parsed {parsed} · usable {usable} · filtered {filtered}
                    {cached > 0 ? ` · cached ${cached}` : ""}
                    {row.statusLabel ? ` · ${row.statusLabel}` : ""}
                  </p>
                );
              })}
              <p style={styles.compactFlags}>
                MLB usable on board: {feedHealthContext?.Underdog?.boardCount ?? apiHealth?.Underdog?.usableCount ?? 0}
              </p>
              {rejectionAudit?.reasons && Object.keys(rejectionAudit.reasons).length ? (
                <div>
                  <p style={{ ...styles.compactFlags, marginBottom: 4 }}>Rejected by reason:</p>
                  {Object.entries(rejectionAudit.reasons)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 12)
                    .map(([reason, count]) => (
                      <p key={reason} style={{ ...styles.compactFlags, margin: "2px 0" }}>
                        {reason}: {count}
                      </p>
                    ))}
                </div>
              ) : null}
            </div>
          </details>
          {underdogDebugSnapshot?.parsedPreview?.length ? (
            <ParsedUnderdogDebugCard picks={underdogDebugSnapshot.parsedPreview} />
          ) : null}
          <RawApiDebugPanel embedded open={showDebugPanels} />
        </div>
      ) : null}
    </div>
  );
}

export default memo(DeveloperDebugPanel);
