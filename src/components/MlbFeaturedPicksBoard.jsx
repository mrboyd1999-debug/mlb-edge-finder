import { memo } from "react";
import MlbPickCard from "./MlbPickCard.jsx";
import { styles } from "../theme/styles.js";
import { MLB_EMPTY_MESSAGE } from "../utils/curatedPicks.js";
import { SAFE_MODE_LOADING_MESSAGE } from "../utils/safeMode.js";

const FEATURED_CARD_STYLES = {
  bestOverall: styles.featuredBestCard,
  sharpestEdge: styles.featuredEdgeCard,
  safestPlay: styles.featuredSafeCard,
};

function EmptyState({ text }) {
  return <div style={styles.emptyStateCompact}>{text}</div>;
}

function MlbFeaturedPicksBoard({
  bestOverall = null,
  sharpestEdge = null,
  safestPlay = null,
  loading = false,
  onOpen,
  hasMlbProps = false,
}) {
  const picks = [
    { prop: bestOverall, key: "bestOverall" },
    { prop: sharpestEdge, key: "sharpestEdge" },
    { prop: safestPlay, key: "safestPlay" },
  ].filter((entry) => entry.prop);

  return (
    <section className="mlb-featured-picks-section" style={styles.section} aria-label="Featured MLB Plays">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Slate leaders · model-ranked</p>
          <h2 style={styles.sectionTitle}>Featured MLB Plays</h2>
        </div>
        <p style={styles.countPill}>{picks.length}/3</p>
      </div>
      {loading ? (
        <EmptyState text={SAFE_MODE_LOADING_MESSAGE} />
      ) : picks.length === 0 ? (
        <EmptyState text={hasMlbProps ? "No featured plays above confidence floor." : MLB_EMPTY_MESSAGE} />
      ) : (
        <div className="mlb-featured-grid mlb-outlook-grid" style={styles.mlbOutlookGrid}>
          {picks.map(({ prop, key }, idx) => (
            <MlbPickCard
              key={prop.id || `featured-${key}`}
              prop={prop}
              rank={idx + 1}
              onOpen={onOpen}
              cardStyle={FEATURED_CARD_STYLES[key]}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(MlbFeaturedPicksBoard);
