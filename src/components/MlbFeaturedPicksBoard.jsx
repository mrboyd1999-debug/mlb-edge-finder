import { memo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import { styles } from "../theme/styles.js";
import { MLB_EMPTY_MESSAGE } from "../utils/curatedPicks.js";
import { SAFE_MODE_LOADING_MESSAGE } from "../utils/safeMode.js";
import { TOP_MLB_PLAYS_LIMIT } from "../utils/topMlbPlays.js";

function EmptyState({ text }) {
  return <div style={styles.emptyStateCompact}>{text}</div>;
}

function MlbFeaturedPicksBoard({ picks = [], loading = false, onOpen, hasMlbProps = false }) {
  const rows = (picks || []).slice(0, TOP_MLB_PLAYS_LIMIT);

  return (
    <section className="mlb-featured-picks-section" style={styles.section} aria-label="Top MLB Plays">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>PrizePicks + Underdog · unders favored</p>
          <h2 style={styles.sectionTitle}>Top MLB Plays</h2>
        </div>
        <p style={styles.countPill}>{rows.length}/{TOP_MLB_PLAYS_LIMIT}</p>
      </div>
      {loading ? (
        <EmptyState text={SAFE_MODE_LOADING_MESSAGE} />
      ) : rows.length === 0 ? (
        <EmptyState text={hasMlbProps ? "No MLB plays ranked yet — refresh the feed." : MLB_EMPTY_MESSAGE} />
      ) : (
        <div className="best-play-row-list" style={styles.bestPlayRowList}>
          {rows.map((prop, idx) => (
            <BestPlayRowCard key={prop.id || `top-mlb-${idx}`} prop={prop} rank={idx + 1} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(MlbFeaturedPicksBoard);
