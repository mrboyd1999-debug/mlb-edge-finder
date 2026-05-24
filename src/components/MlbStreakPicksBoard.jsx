import { memo } from "react";
import MlbPickCard from "./MlbPickCard.jsx";
import { styles } from "../theme/styles.js";
import { UNDERDOG_STREAK_EMPTY_MESSAGE } from "../utils/underdogStreakPool.js";
import { SAFE_MODE_LOADING_MESSAGE } from "../utils/safeMode.js";

function MlbStreakPicksBoard({ picks = [], onOpen, hasUnderdogProps = false, emptyMessage = "", loading = false }) {
  const streakPicks = (picks || []).filter(Boolean).slice(0, 2);

  return (
    <section className="mlb-streak-picks-section" style={styles.section} aria-label="MLB Streak Picks">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Top 2 · Underdog only</p>
          <h2 style={styles.sectionTitle}>MLB Streak Picks</h2>
        </div>
        <p style={styles.countPill}>{streakPicks.length}/2</p>
      </div>
      {loading ? (
        <div style={styles.emptyStateCompact}>{SAFE_MODE_LOADING_MESSAGE}</div>
      ) : streakPicks.length > 0 ? (
        <div className="streak-grid pick-grid cards-grid" style={styles.mlbOutlookGrid}>
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
        <div style={styles.emptyStateCompact}>
          {emptyMessage ||
            (hasUnderdogProps ? "No Underdog streak picks ranked yet." : UNDERDOG_STREAK_EMPTY_MESSAGE)}
        </div>
      )}
    </section>
  );
}

export default memo(MlbStreakPicksBoard);
