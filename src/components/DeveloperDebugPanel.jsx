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
  bestPlaysFilter = null,
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
              {rejectionAudit?.mlbProjection ? (
                <div>
                  <p style={{ ...styles.compactFlags, marginBottom: 4 }}>MLB projection pipeline:</p>
                  {rejectionAudit.mlbProjection.liveDebug ? (
                    <>
                      <p style={{ ...styles.compactFlags, margin: "2px 0" }}>
                        Props fetched: {rejectionAudit.mlbProjection.liveDebug.propsFetched ?? 0}
                      </p>
                      <p style={{ ...styles.compactFlags, margin: "2px 0" }}>
                        Props normalized: {rejectionAudit.mlbProjection.liveDebug.propsNormalized ?? 0}
                      </p>
                      <p style={{ ...styles.compactFlags, margin: "2px 0" }}>
                        Player matches: {rejectionAudit.mlbProjection.liveDebug.playerMatches ?? 0}
                      </p>
                      <p style={{ ...styles.compactFlags, margin: "2px 0" }}>
                        Game logs fetched: {rejectionAudit.mlbProjection.liveDebug.gameLogsFetched ?? 0}
                      </p>
                      <p style={{ ...styles.compactFlags, margin: "2px 0" }}>
                        Projections created: {rejectionAudit.mlbProjection.liveDebug.projectionsCreated ?? 0}
                      </p>
                      <p style={{ ...styles.compactFlags, margin: "2px 0" }}>
                        Verified props: {rejectionAudit.mlbProjection.liveDebug.verifiedProps ?? 0}
                      </p>
                    </>
                  ) : (
                    <p style={{ ...styles.compactFlags, margin: "2px 0" }}>
                      Fetched {rejectionAudit.mlbProjection.stages?.FETCHED_PROPS_COUNT ?? 0} · Normalized{" "}
                      {rejectionAudit.mlbProjection.stages?.NORMALIZED_PROPS_COUNT ?? 0} · Matched{" "}
                      {rejectionAudit.mlbProjection.stages?.MATCHED_PLAYERS_COUNT ?? 0} · Logs{" "}
                      {rejectionAudit.mlbProjection.stages?.GAME_LOGS_FOUND_COUNT ?? 0} · Projections{" "}
                      {rejectionAudit.mlbProjection.stages?.PROJECTIONS_GENERATED_COUNT ?? 0} · Verified{" "}
                      {rejectionAudit.mlbProjection.verifiedPropsCount ?? 0}
                    </p>
                  )}
                  {rejectionAudit.mlbProjection.emergencyCanary ? (
                    <p style={{ ...styles.compactFlags, margin: "2px 0" }}>
                      Emergency canary ({rejectionAudit.mlbProjection.emergencyCanary.player || "Spencer Strider"}):{" "}
                      {rejectionAudit.mlbProjection.emergencyCanary.success ? "SUCCESS" : "FAILED"}
                      {rejectionAudit.mlbProjection.emergencyCanary.projection != null
                        ? ` · projection ${rejectionAudit.mlbProjection.emergencyCanary.projection}`
                        : ""}
                      {rejectionAudit.mlbProjection.emergencyCanary.forcedInjected ? " · injected" : ""}
                    </p>
                  ) : null}
                  {rejectionAudit.mlbProjection.lastProjectionFailure ? (
                    <p style={{ ...styles.compactFlags, margin: "2px 0", color: "#f87171" }}>
                      Projection failed: {rejectionAudit.mlbProjection.lastProjectionFailure.stage} — reason = "
                      {rejectionAudit.mlbProjection.lastProjectionFailure.reason}"
                    </p>
                  ) : null}
                  {Array.isArray(rejectionAudit.mlbProjection.projectionErrors) &&
                  rejectionAudit.mlbProjection.projectionErrors.length ? (
                    <div>
                      <p style={{ ...styles.compactFlags, marginBottom: 4 }}>Projection errors:</p>
                      {rejectionAudit.mlbProjection.projectionErrors.slice(0, 8).map((row, index) => (
                        <p key={`${row.stage}-${index}`} style={{ ...styles.compactFlags, margin: "2px 0" }}>
                          {row.stage}: {row.reason}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {rejectionAudit.mlbProjection.statsFetchTimedOut ? " · stats timed out" : ""}
                  {bestPlaysFilter ? (
                    <p style={{ ...styles.compactFlags, margin: "2px 0" }}>
                      Best Plays filters: {bestPlaysFilter.filteredMissingProjection ?? 0} missing projection ·{" "}
                      {bestPlaysFilter.filteredLowConfidence ?? 0} low confidence · {bestPlaysFilter.filteredWeakEdge ?? 0}{" "}
                      weak edge · {bestPlaysFilter.selected ?? 0} selected
                      {bestPlaysFilter.usedVerifiedFallback ? " · verified fallback" : ""}
                    </p>
                  ) : null}
                  {rejectionAudit.mlbProjection.testMode ? " · test thresholds" : ""}
                  {rejectionAudit.mlbProjection.rejections &&
                  Object.keys(rejectionAudit.mlbProjection.rejections).length ? (
                    Object.entries(rejectionAudit.mlbProjection.rejections)
                      .filter(([, count]) => Number(count) > 0)
                      .map(([reason, count]) => (
                        <p key={reason} style={{ ...styles.compactFlags, margin: "2px 0" }}>
                          {reason}: {count}
                        </p>
                      ))
                  ) : null}
                </div>
              ) : null}
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
