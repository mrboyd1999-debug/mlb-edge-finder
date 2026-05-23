import { memo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";

function TopPicksBoard({ label = "Sport", picks = [], onOpen, compactMode = true }) {
  const topPicks = (picks || []).filter(Boolean).slice(0, 2);

  return (
    <section className="top-picks-section" style={styles.section}>
      <div style={styles.sectionHeading}>
        <div>
          <h2 style={styles.sectionTitle}>Top 2 Picks</h2>
        </div>
        <p style={styles.countPill}>{topPicks.length}/2</p>
      </div>
      {topPicks.length > 0 ? (
        <div className="top-picks-grid" style={styles.topPicksList}>
          {topPicks.map((prop, idx) => (
            <PlayerPropCard
              key={prop.id || `top-pick-${idx}`}
              prop={prop}
              rank={idx + 1}
              compact={compactMode}
              topPick
              onOpen={onOpen}
              cardStyle={styles.streakCard}
            />
          ))}
        </div>
      ) : (
        <div style={styles.emptyState}>No accepted props available for Top 2 yet.</div>
      )}
    </section>
  );
}

export default memo(TopPicksBoard);
