import { memo, useState, useCallback } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import CompactApiHeader from "./CompactApiHeader.jsx";
import CompactAppTabs from "./CompactAppTabs.jsx";
import SystemStatusCard from "./SystemStatusCard.jsx";
import PropPipelineCounters from "./PropPipelineCounters.jsx";
import ManualPropsPanel from "./ManualPropsPanel.jsx";
import BestPlaysTab from "./BestPlaysTab.jsx";
import PlatformFeedTab from "./PlatformFeedTab.jsx";
import CompactPayoutTab from "./CompactPayoutTab.jsx";
import SavedPicksTab from "./SavedPicksTab.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import DeveloperDebugPanel from "./DeveloperDebugPanel.jsx";
import { readSettingsMeta } from "../services/runtimeSettings.js";
import { GOBLIN_EMPTY_MESSAGE } from "../utils/goblinDemonPairs.js";
import { isDebugModeEnabled } from "../utils/devMode.js";

function DfsAnalyzerLayout({
  appView,
  setAppView,
  apiHealth,
  loading,
  refreshBlocked,
  refreshCountdownSec,
  onRefresh,
  lastUpdatedLabel,
  learningSaveNotice,
  manualAnalyzerProps,
  onAnalyzeManualProp,
  onRemoveManualProp,
  onClearManualProps,
  onOpenProp,
  onSavePick,
  topMlbPlayBoard,
  curatedGoblinPicks,
  curatedDemonPicks,
  prizePicksFeedProps,
  underdogFeedProps,
  pipelineRenderCounts,
  savedDisplayPicks,
  onRemoveSavedPick,
  onClearSavedPicks,
  onSectionError,
  showDebugPanels,
  onShowDebugPanelsChange,
  onSettingsSaved,
  feedHealthContext,
  underdogDebugSnapshot,
  debugInfo,
  mlbPipelineStatus,
}) {
  const [connectionReport, setConnectionReport] = useState(() => {
    const meta = readSettingsMeta();
    if (meta.lastTestedAt && Array.isArray(meta.lastConnectionReport)) {
      return { testedAt: meta.lastTestedAt, results: meta.lastConnectionReport };
    }
    return null;
  });

  const handleConnectionReportChange = useCallback((report) => {
    if (report) setConnectionReport(report);
  }, []);

  const debugModeEnabled = isDebugModeEnabled();

  return (
    <main className="dfs-app-page compact-dfs-app">
      <CompactApiHeader
        title="MLB Pick Finder"
        loading={loading}
        refreshBlocked={refreshBlocked}
        refreshCountdownSec={refreshCountdownSec}
        onRefresh={onRefresh}
        lastUpdated={lastUpdatedLabel}
      />

      <CompactAppTabs activeTab={appView} onChange={setAppView} />

      <SystemStatusCard
        apiHealth={apiHealth}
        mlbPipelineStatus={mlbPipelineStatus}
        connectionReport={connectionReport}
      />

      <PropPipelineCounters counts={pipelineRenderCounts} />

      {learningSaveNotice ? <p className="compact-form-notice">{learningSaveNotice}</p> : null}

      {appView === "manual" ? (
        <SectionErrorBoundary name="Manual Analyzer" onError={onSectionError}>
          <ManualPropsPanel
            props={manualAnalyzerProps}
            loading={loading}
            notice={learningSaveNotice}
            onAnalyzeProp={onAnalyzeManualProp}
            onRemoveProp={onRemoveManualProp}
            onClearAll={onClearManualProps}
            onOpenProp={onOpenProp}
            onSavePick={onSavePick}
          />
        </SectionErrorBoundary>
      ) : null}

      {appView === "bestPlays" ? (
        <SectionErrorBoundary name="Best Plays" onError={onSectionError}>
          <BestPlaysTab
            sections={topMlbPlayBoard?.sections || []}
            loading={loading}
            onOpen={onOpenProp}
            onSave={onSavePick}
          />
        </SectionErrorBoundary>
      ) : null}

      {appView === "prizepicks" ? (
        <SectionErrorBoundary name="PrizePicks" onError={onSectionError}>
          <PlatformFeedTab
            platformLabel="PrizePicks"
            picks={prizePicksFeedProps || []}
            loading={loading}
            onOpen={onOpenProp}
            onSave={onSavePick}
          />
        </SectionErrorBoundary>
      ) : null}

      {appView === "underdog" ? (
        <SectionErrorBoundary name="Underdog" onError={onSectionError}>
          <PlatformFeedTab
            platformLabel="Underdog"
            picks={underdogFeedProps || []}
            loading={loading}
            onOpen={onOpenProp}
            onSave={onSavePick}
          />
        </SectionErrorBoundary>
      ) : null}

      {appView === "goblins" ? (
        <SectionErrorBoundary name="Goblins" onError={onSectionError}>
          <CompactPayoutTab
            role="goblin"
            picks={curatedGoblinPicks || []}
            loading={loading}
            onOpen={onOpenProp}
            onSave={onSavePick}
            emptyMessage={GOBLIN_EMPTY_MESSAGE}
          />
        </SectionErrorBoundary>
      ) : null}

      {appView === "demons" ? (
        <SectionErrorBoundary name="Demons" onError={onSectionError}>
          <CompactPayoutTab
            role="demon"
            picks={curatedDemonPicks || []}
            loading={loading}
            onOpen={onOpenProp}
            onSave={onSavePick}
            emptyMessage="No demon lines ranked yet. Refresh live props when connected."
          />
        </SectionErrorBoundary>
      ) : null}

      {appView === "saved" ? (
        <SectionErrorBoundary name="Saved Picks" onError={onSectionError}>
          <SavedPicksTab
            picks={savedDisplayPicks || []}
            onOpen={onOpenProp}
            onDelete={onRemoveSavedPick}
            onClearAll={onClearSavedPicks}
          />
        </SectionErrorBoundary>
      ) : null}

      <SettingsPanel
        onSaved={onSettingsSaved}
        onClearCaches={onSettingsSaved}
        onConnectionReportChange={handleConnectionReportChange}
        feedHealthContext={feedHealthContext}
      />

      <details className="compact-settings-details developer-debug-details">
        <summary>Developer Debug</summary>
        <DeveloperDebugPanel
          connectionReport={connectionReport}
          lastTestedAt={connectionReport?.testedAt || readSettingsMeta().lastTestedAt || ""}
          apiHealth={apiHealth}
          mlbPipelineStatus={mlbPipelineStatus}
          feedHealthContext={feedHealthContext}
          underdogDebugSnapshot={underdogDebugSnapshot}
          rejectionAudit={debugInfo?.rejectionAudit}
          showDebugPanels={showDebugPanels}
          onShowDebugPanelsChange={onShowDebugPanelsChange}
          debugModeEnabled={debugModeEnabled}
        />
      </details>
    </main>
  );
}

export default memo(DfsAnalyzerLayout);
