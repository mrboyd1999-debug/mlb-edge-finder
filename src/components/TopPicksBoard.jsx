import { memo } from "react";
import SimplePropCard from "./SimplePropCard.jsx";
import { styles } from "../theme/styles.js";

function TopPicksBoard({ label = "Sport", picks = [], loading, onOpen, acceptedCount = 0 }) {
  const topPicks = (picks || []).filter(Boolean).slice(0, 2);
  const hasAccepted = topPicks.length > 0 || Number(acceptedCount) > 0;

  return (
    <section className="top-picks-section" style={styles.section}>
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>{label}</p>
          <h2 style={styles.sectionTitle}>Top 2 Picks</h2>
        </div>
        <p style={styles.countPill}>{topPicks.length}/2</p>
      </div>
      {loading && !topPicks.length ? (
        <div style={styles.emptyState}>Loading {label} picks…</div>
      ) : topPicks.length > 0 ? (
        <div className="top-picks-grid" style={styles.topPicksList}>
          {topPicks.map((prop, idx) => (
            <SimplePropCard
              key={prop.id || `top-pick-${idx}`}
              prop={prop}
              index={idx}
              className="top-pick-card"
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : hasAccepted ? (
        <div style={styles.emptyState}>Accepted props are loading — check Accepted Props above.</div>
      ) : (
        <div style={styles.emptyState}>No accepted props available for Top 2 yet.</div>
      )}
    </section>
  );
}

export default memo(TopPicksBoard);
