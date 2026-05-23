import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { selectTopPicks } from "../services/pickScoring.js";
import { CONFIDENCE_THRESHOLDS } from "../services/confidenceEngine.js";
import { buildElitePickExplanation } from "../services/pickExplanation.js";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function TopPicksBoard({ label = "Sport", picks = [], loading, onOpen, compactMode = true }) {
  const sorted = useMemo(
    () =>
      selectTopPicks(picks, 2).map((prop, index) => {
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
            Weighted score · confidence + edge + market reliability − volatility − line movement · target ≥
            {CONFIDENCE_THRESHOLDS.PLAYABLE}% playable.
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
