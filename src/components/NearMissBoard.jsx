import { memo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { sortPropsForDisplay } from "../utils/displayPropScoring.js";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function NearMissBoard({ picks = [], loading, onOpen, compactMode = true }) {
  const sorted = sortPropsForDisplay(picks).slice(0, 12);

  return (
    <section style={styles.section} aria-label="Near miss board">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Almost there</p>
          <h2 style={styles.sectionTitleSmall}>Near Miss</h2>
          <p style={styles.streakCopy}>
            Playable props that narrowly missed Top Pick thresholds — not low-confidence research lines.
          </p>
        </div>
        <p style={styles.countPill}>{sorted.length} near</p>
      </div>
      {loading ? (
        <EmptyState text="Loading near-miss props…" />
      ) : sorted.length === 0 ? (
        <EmptyState text="No near-miss playable props this cycle." />
      ) : (
        <div style={styles.topPicksList}>
          {sorted.map((prop) => (
            <PlayerPropCard key={prop.id} prop={prop} onOpen={onOpen} compact={compactMode} cardStyle={styles.streakCard} />
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(NearMissBoard);
