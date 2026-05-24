import { memo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import MlbFeaturedPicksBoard from "./MlbFeaturedPicksBoard.jsx";
import { WAITING_FOR_PROJECTIONS_MESSAGE } from "../utils/topMlbPlays.js";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyStateCompact}>{text}</div>;
}

function CuratedPicksScreen({
  sections = [],
  loading = false,
  onOpen,
  hasMlbProps = false,
  waitingForProjections = false,
  onSectionError,
}) {
  const hasSections = sections.some((section) => section.picks?.length);

  return (
    <div className="curated-picks-screen curated-picks-mlb-only">
      {loading ? (
        <EmptyState text="Loading MLB props…" />
      ) : !hasSections ? (
        <EmptyState
          text={
            waitingForProjections || hasMlbProps
              ? WAITING_FOR_PROJECTIONS_MESSAGE
              : "No verified MLB props available."
          }
        />
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
