import { memo } from "react";
import MlbPickCard from "./MlbPickCard.jsx";
import { styles } from "../theme/styles.js";
import { MLB_EMPTY_MESSAGE } from "../utils/curatedPicks.js";
import { SAFE_MODE_LOADING_MESSAGE } from "../utils/safeMode.js";

function MlbStreakPicksBoard({ picks = [], onOpen, hasMlbProps = false, loading = false }) {
  const streakPicks = (picks || []).filter(Boolean).slice(0, 2);

  return (
    <section className="mlb-streak-picks-section" style={styles.section} aria-label="MLB Streak Picks">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Top 2 · MLB only</p>
          <h2 style={styles.sectionTitle}>MLB Streak Picks</h2>
        </div>
        <p style={styles.countPill}>{streakPicks.length}/2</p>
      </div>
      {loading ? (
        <div style={styles.emptyStateCompact}>{SAFE_MODE_LOADING_MESSAGE}</div>
      ) : streakPicks.length > 0 ? (
        <div className="mlb-streak-picks-grid" style={styles.topPicksList}>
          {streakPicks.map((prop, idx) => (
            <MlbPickCard
              key={prop.id || `mlb-streak-${idx}`}
              prop={prop}
              rank={idx + 1}
              streakAction
              onOpen={onOpen}
              cardStyle={styles.streakCard}
            />
          ))}
        </div>
      ) : (
        <div style={styles.emptyStateCompact}>{hasMlbProps ? "No MLB streak picks ranked yet." : MLB_EMPTY_MESSAGE}</div>
      )}
    </section>
  );
}

export default memo(MlbStreakPicksBoard);
