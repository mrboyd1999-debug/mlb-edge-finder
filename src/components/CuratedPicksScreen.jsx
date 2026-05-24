import { memo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import MlbFeaturedPicksBoard from "./MlbFeaturedPicksBoard.jsx";
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
  onSectionError,
}) {
  const hasSections = sections.some((section) => section.picks?.length);

  return (
    <div className="curated-picks-screen curated-picks-mlb-only">
      <PipelineDebugBar debug={pipelineDebug} />
      {usedFallback && fallbackLabel ? (
        <p style={styles.pipelineDebugFallback}>{fallbackLabel}</p>
      ) : null}
      {loading ? (
        <div style={styles.emptyStateCompact}>Loading MLB props…</div>
      ) : !hasSections ? (
        <div style={styles.emptyStateCompact}>
          {waitingForProjections ? "Loading projections…" : "Loading MLB board…"}
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
