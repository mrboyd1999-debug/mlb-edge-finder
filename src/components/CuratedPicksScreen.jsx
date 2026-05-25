import { memo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import MlbFeaturedPicksBoard from "./MlbFeaturedPicksBoard.jsx";
import LiveStatusHeader from "./LiveStatusHeader.jsx";
import PipelineDebugBar from "./PipelineDebugBar.jsx";
import { styles } from "../theme/styles.js";

import { liveBoardLoadingMessage, LIVE_BOARD_UNAVAILABLE_MESSAGE } from "../utils/liveBoardLoading.js";

function CuratedPicksScreen({
  sections = [],
  loading = false,
  loadingStage = "FETCH",
  onOpen,
  waitingForProjections = false,
  usedFallback = false,
  fallbackLabel = "",
  pipelineDebug = null,
  fetchFailureReasons = [],
  loadedPropCount = 0,
  showDebugPanels = false,
  onSectionError,
}) {
  const hasSections = sections.some((section) => section.picks?.length);

  return (
    <div className="curated-picks-screen curated-picks-mlb-only">
      <LiveStatusHeader
        debug={pipelineDebug}
        failureReasons={fetchFailureReasons}
        loading={loading}
        loadedPropCount={loadedPropCount}
      />
      {showDebugPanels ? <PipelineDebugBar debug={pipelineDebug} /> : null}
      {usedFallback && fallbackLabel ? (
        <p style={styles.pipelineDebugFallback} role="alert">
          {fallbackLabel}
        </p>
      ) : null}
      {loading ? (
        <div style={styles.emptyStateCompact}>{liveBoardLoadingMessage(loadingStage)}</div>
      ) : !hasSections ? (
        <div style={styles.emptyStateCompact}>
          {loadedPropCount > 0
            ? `${loadedPropCount} props loaded — adjust filters to view picks.`
            : fetchFailureReasons?.length
              ? fetchFailureReasons.join(" · ")
              : waitingForProjections
                ? liveBoardLoadingMessage("PROJECT")
                : LIVE_BOARD_UNAVAILABLE_MESSAGE}
        </div>
      ) : (
        sections.map((section) => (
          <SectionErrorBoundary key={section.id} name={section.title} onError={onSectionError}>
            <MlbFeaturedPicksBoard
              title={section.title}
              eyebrow={section.eyebrow}
              picks={section.picks}
              onOpen={onOpen}
            />
          </SectionErrorBoundary>
        ))
      )}
    </div>
  );
}

export default memo(CuratedPicksScreen);
