import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { CONFIDENCE_THRESHOLDS } from "../services/confidenceEngine.js";
import { buildElitePickExplanation } from "../services/pickExplanation.js";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function TopPicksBoard({ label = "Sport", picks = [], loading, onOpen, compactMode = true }) {
  const sorted = useMemo(
    () =>
      (picks || []).slice(0, 2).map((prop) => {
        const explanation = prop.elitePickExplanation || buildElitePickExplanation(prop);
        return {
          ...prop,
          edgeScore: prop.edgeScore ?? prop.edgeRating,
          elitePickExplanation: explanation,
          topTwoReason: explanation.compact,
        };
      }),
    [picks]
  );

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>{label}</p>
          <h2 style={styles.sectionTitle}>Top 2 Picks</h2>
          <p style={styles.streakCopy}>
            Best 2 accepted props · Elite {'>'} Strong {'>'} Playable · ≥
            {CONFIDENCE_THRESHOLDS.PLAYABLE}% confidence · positive edge · minor volatility allowed.
          </p>
        </div>
        <p style={styles.countPill}>{sorted.length}/2</p>
      </div>
      {loading ? (
        <EmptyState text={`Loading ${label} picks…`} />
      ) : sorted.length === 0 ? (
        <EmptyState text="No qualified MLB picks currently rank in the top 2." />
      ) : (
        <div style={styles.topPicksList}>
          {sorted.map((prop, index) => (
            <PlayerPropCard
              key={prop.id}
              prop={prop}
              rank={index + 1}
              onOpen={onOpen}
              compact={compactMode}
              cardStyle={styles.streakCard}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(TopPicksBoard);
