import { memo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import MlbFeaturedPicksBoard from "./MlbFeaturedPicksBoard.jsx";
import LiveStatusHeader from "./LiveStatusHeader.jsx";
import PipelineDebugBar from "./PipelineDebugBar.jsx";
import { styles } from "../theme/styles.js";

function CuratedPicksScreen({
  sections = [],
  loading = false,
  onOpen,
  waitingForProjections = false,
  usedFallback = false,
  fallbackLabel = "",
  pipelineDebug = null,
  fetchFailureReasons = [],
  showDebugPanels = false,
  onSectionError,
}) {
  const hasSections = sections.some((section) => section.picks?.length);

  return (
    <div className="curated-picks-screen curated-picks-mlb-only">
      <LiveStatusHeader debug={pipelineDebug} failureReasons={fetchFailureReasons} loading={loading} />
      {showDebugPanels ? <PipelineDebugBar debug={pipelineDebug} /> : null}
      {usedFallback && fallbackLabel ? (
        <p style={styles.pipelineDebugFallback} role="alert">
          {fallbackLabel}
        </p>
      ) : null}
      {loading ? (
        <div style={styles.emptyStateCompact}>Loading MLB props…</div>
      ) : !hasSections ? (
        <div style={styles.emptyStateCompact}>
          {fetchFailureReasons?.length
            ? fetchFailureReasons.join(" · ")
            : waitingForProjections
              ? "Loading projections…"
              : "No live MLB props available"}
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
