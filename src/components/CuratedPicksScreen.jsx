import { memo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import MlbFeaturedPicksBoard from "./MlbFeaturedPicksBoard.jsx";

function CuratedPicksScreen({ topPlays = [], loading = false, onOpen, hasMlbProps = false, onSectionError }) {
  return (
    <div className="curated-picks-screen curated-picks-mlb-only">
      <SectionErrorBoundary name="Top MLB Plays" onError={onSectionError}>
        <MlbFeaturedPicksBoard picks={topPlays} loading={loading} onOpen={onOpen} hasMlbProps={hasMlbProps} />
      </SectionErrorBoundary>
    </div>
  );
}

export default memo(CuratedPicksScreen);
