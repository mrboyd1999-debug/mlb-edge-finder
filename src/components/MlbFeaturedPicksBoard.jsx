import { memo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import { styles } from "../theme/styles.js";
import { MLB_EMPTY_MESSAGE } from "../utils/curatedPicks.js";
import { SAFE_MODE_LOADING_MESSAGE } from "../utils/safeMode.js";

function EmptyState({ text }) {
  return <div style={styles.emptyStateCompact}>{text}</div>;
}

function MlbFeaturedPicksBoard({
  bestPlays = [],
  bestOverall = null,
  sharpestEdge = null,
  safestPlay = null,
  loading = false,
  onOpen,
  hasMlbProps = false,
}) {
  const picks = (bestPlays?.length
    ? bestPlays
    : [bestOverall, sharpestEdge, safestPlay].filter(Boolean)
  ).slice(0, 6);

  return (
    <section className="mlb-featured-picks-section" style={styles.section} aria-label="Best Plays">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>PrizePicks + Underdog · model-ranked</p>
          <h2 style={styles.sectionTitle}>Best Plays</h2>
        </div>
        <p style={styles.countPill}>{picks.length}</p>
      </div>
      {loading ? (
        <EmptyState text={SAFE_MODE_LOADING_MESSAGE} />
      ) : picks.length === 0 ? (
        <EmptyState text={hasMlbProps ? "No ranked MLB plays yet — check feed refresh." : MLB_EMPTY_MESSAGE} />
      ) : (
        <div className="best-play-row-list" style={styles.bestPlayRowList}>
          {picks.map((prop, idx) => (
            <BestPlayRowCard
              key={prop.id || `best-play-${idx}`}
              prop={prop}
              rank={idx + 1}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(MlbFeaturedPicksBoard);
