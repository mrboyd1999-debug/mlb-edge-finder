import { memo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import MlbFeaturedPicksBoard from "./MlbFeaturedPicksBoard.jsx";
import MlbStreakPicksBoard from "./MlbStreakPicksBoard.jsx";
import GoblinBoard from "./GoblinBoard.jsx";
import DemonBoard from "./DemonBoard.jsx";
import MlbPickCard from "./MlbPickCard.jsx";
import { styles } from "../theme/styles.js";
import ParsedUnderdogDebugCard from "./ParsedUnderdogDebugCard.jsx";
import { DISPLAY_LIMITS, MLB_EMPTY_MESSAGE } from "../utils/curatedPicks.js";
import { MLB_ONLY_MODE } from "../utils/mlbOnlyMode.js";
import { SAFE_MODE_LOADING_MESSAGE } from "../utils/safeMode.js";

function ParlayBuilderSection({ picks = [], loading, onOpen, hasMlbProps = false }) {
  const legs = (picks || []).filter(Boolean).slice(0, DISPLAY_LIMITS.parlayLegs);

  return (
    <section className="curated-parlay-section" style={styles.section} aria-label="MLB 4-Man Builder">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>MLB · low correlation combo</p>
          <h2 style={styles.sectionTitle}>MLB 4-Man Builder</h2>
        </div>
        <p style={styles.countPill}>{legs.length}/{DISPLAY_LIMITS.parlayLegs}</p>
      </div>
      {loading ? (
        <div style={styles.emptyStateCompact}>{SAFE_MODE_LOADING_MESSAGE}</div>
      ) : legs.length === 0 ? (
        <div style={styles.emptyStateCompact}>{hasMlbProps ? "No strong MLB 4-man combo yet." : MLB_EMPTY_MESSAGE}</div>
      ) : (
        <div className="mlb-outlook-grid curated-parlay-grid" style={styles.mlbOutlookGrid}>
          {legs.map((prop, idx) => (
            <MlbPickCard
              key={prop.id || `parlay-${idx}`}
              prop={prop}
              rank={idx + 1}
              onOpen={onOpen}
              cardStyle={styles.parlayCard}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CuratedPicksScreen({
  featuredPicks = {},
  mlbStreakPicks = [],
  parlayPicks = [],
  goblinPicks = [],
  demonPicks = [],
  loading = false,
  onOpen,
  hasMlbProps = false,
  hasUnderdogProps = false,
  underdogEmptyMessage = "",
  parsedUnderdogPreview = [],
  onSectionError,
}) {
  if (MLB_ONLY_MODE) {
    return (
      <div className="curated-picks-screen curated-picks-mlb-only">
        <SectionErrorBoundary name="Featured MLB Plays" onError={onSectionError}>
          <MlbFeaturedPicksBoard
            bestOverall={featuredPicks.bestOverall}
            sharpestEdge={featuredPicks.sharpestEdge}
            safestPlay={featuredPicks.safestPlay}
            loading={loading}
            onOpen={onOpen}
            hasMlbProps={hasMlbProps}
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="MLB Streak Picks" onError={onSectionError}>
          <MlbStreakPicksBoard
            picks={mlbStreakPicks}
            loading={loading}
            onOpen={onOpen}
            hasUnderdogProps={hasUnderdogProps}
            emptyMessage={underdogEmptyMessage}
          />
          <ParsedUnderdogDebugCard picks={parsedUnderdogPreview} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="MLB 4-Man Builder" onError={onSectionError}>
          <ParlayBuilderSection picks={parlayPicks} loading={loading} onOpen={onOpen} hasMlbProps={hasMlbProps} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="MLB Goblins" onError={onSectionError}>
          <GoblinBoard
            picks={goblinPicks.slice(0, DISPLAY_LIMITS.goblins)}
            loading={loading}
            onOpen={onOpen}
            limit={DISPLAY_LIMITS.goblins}
            title="MLB Goblins"
            useMlbCard
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="MLB Demons" onError={onSectionError}>
          <DemonBoard
            picks={demonPicks.slice(0, DISPLAY_LIMITS.demons)}
            loading={loading}
            onOpen={onOpen}
            limit={DISPLAY_LIMITS.demons}
            title="MLB Demons"
            useMlbCard
          />
        </SectionErrorBoundary>
      </div>
    );
  }

  return null;
}

export default memo(CuratedPicksScreen);
