import { memo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import CompactApiHeader from "./CompactApiHeader.jsx";
import CompactAppTabs from "./CompactAppTabs.jsx";
import ManualPropsPanel from "./ManualPropsPanel.jsx";
import BestPlaysTab from "./BestPlaysTab.jsx";
import CompactPayoutTab from "./CompactPayoutTab.jsx";
import SavedPicksTab from "./SavedPicksTab.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import { GOBLIN_EMPTY_MESSAGE } from "../utils/goblinDemonPairs.js";

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
  return (
    <main className="dfs-app-page compact-dfs-app">
      <CompactApiHeader
        title="MLB Pick Finder"
        apiHealth={apiHealth}
        loading={loading}
        refreshBlocked={refreshBlocked}
        refreshCountdownSec={refreshCountdownSec}
        onRefresh={onRefresh}
        lastUpdated={lastUpdatedLabel}
      />

      <CompactAppTabs activeTab={appView} onChange={setAppView} />

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

      <details className="compact-settings-details">
        <summary>Settings &amp; debug</summary>
        <SettingsPanel
          onSaved={onSettingsSaved}
          onClearCaches={onSettingsSaved}
          showDebugPanels={showDebugPanels}
          onShowDebugPanelsChange={onShowDebugPanelsChange}
          feedHealthContext={feedHealthContext}
          underdogDebugSnapshot={underdogDebugSnapshot}
          rejectionAudit={debugInfo?.rejectionAudit}
          apiHealth={apiHealth}
          mlbPipelineStatus={mlbPipelineStatus}
        />
      </details>
    </main>
  );
}

export default memo(DfsAnalyzerLayout);
