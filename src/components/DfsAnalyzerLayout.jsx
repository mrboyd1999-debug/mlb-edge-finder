import { memo, useState, useCallback } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import CompactApiHeader from "./CompactApiHeader.jsx";
import CompactAppTabs from "./CompactAppTabs.jsx";
import SystemStatusCard from "./SystemStatusCard.jsx";
import VerificationFailureBreakdown from "./VerificationFailureBreakdown.jsx";
import ManualPropsPanel from "./ManualPropsPanel.jsx";
import BestPlaysTab from "./BestPlaysTab.jsx";
import PlatformFeedTab from "./PlatformFeedTab.jsx";
import SavedPicksTab from "./SavedPicksTab.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import DeveloperDebugPanel from "./DeveloperDebugPanel.jsx";
import ProjectionProviderWarning from "./ProjectionProviderWarning.jsx";
import ApiSetupBanner from "./ApiSetupBanner.jsx";
import HistoricalCoverageBanner from "./HistoricalCoverageBanner.jsx";
import { readSettingsMeta } from "../services/runtimeSettings.js";
import { isDebugModeEnabled } from "../utils/devMode.js";

function DfsAnalyzerLayout({
  appView,
  setAppView,
  apiHealth,
  loading,
  loadingStage,
  pipelineDiagnostics,
  loadError,
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
  verificationFilterDiagnostics = null,
  debugPanelsVisible = false,
  prizePicksFeedProps,
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
  statsAttachmentAudit = null,
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
        onConnectionReportChange={handleConnectionReportChange}
        feedHealthContext={feedHealthContext}
        pipelineProjectionStats={pipelineRenderCounts?.projectionStats ?? null}
      />

      <HistoricalCoverageBanner audit={statsAttachmentAudit} loading={loading} />

      {debugPanelsVisible ? (
        <VerificationFailureBreakdown
          filterDiagnostics={verificationFilterDiagnostics || topMlbPlayBoard?.filterDiagnostics}
          heavyAuditEnabled
        />
      ) : null}

      <ApiSetupBanner onOpenSettings={() => setAppView("settings")} />

      <ProjectionProviderWarning status={debugInfo?.projectionProvider} />

      {learningSaveNotice ? <p className="compact-form-notice">{learningSaveNotice}</p> : null}

      {appView === "bestPlays" ? (
        <SectionErrorBoundary name="Verified Plays" onError={onSectionError}>
          <BestPlaysTab
            sections={topMlbPlayBoard?.sections || []}
            loading={loading}
            loadingStage={loadingStage}
            pipelineDiagnostics={pipelineDiagnostics}
            loadError={loadError}
            onOpen={onOpenProp}
            onSave={onSavePick}
            filterDiagnostics={topMlbPlayBoard?.filterDiagnostics}
          />
        </SectionErrorBoundary>
      ) : null}

      {appView === "manual" ? (
        <SectionErrorBoundary name="Player Lookup" onError={onSectionError}>
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

      {appView === "prizepicks" ? (
        <SectionErrorBoundary name="MLB Props" onError={onSectionError}>
          <PlatformFeedTab
            platformLabel="MLB Props · Research"
            picks={prizePicksFeedProps || []}
            loading={loading}
            onOpen={onOpenProp}
            onSave={onSavePick}
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
          projectionCoverageAudit={debugInfo?.projectionCoverageAudit}
          statsAttachmentAudit={debugInfo?.statsAttachmentAudit}
          pipelinePropCountAudit={debugInfo?.pipelinePropCountAudit}
          prizePicksDiagnostics={debugInfo?.sources?.PrizePicks?.diagnostics}
          bestPlaysFilter={topMlbPlayBoard?.filterDiagnostics}
          showDebugPanels={showDebugPanels}
          onShowDebugPanelsChange={onShowDebugPanelsChange}
          debugModeEnabled={debugModeEnabled}
        />
      </details>
    </main>
  );
}

export default memo(DfsAnalyzerLayout);
