import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { isEliteTopPickEligible } from "../services/pickScoring.js";
import { sortDecisionBoard } from "../services/decisionEngine.js";
import { CONFIDENCE_THRESHOLDS } from "../services/confidenceEngine.js";
import { buildElitePickExplanation } from "../services/pickExplanation.js";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function TopPicksBoard({ label = "Sport", picks = [], loading, onOpen, compactMode = true }) {
  const sorted = useMemo(
    () =>
      sortDecisionBoard(picks.filter(isEliteTopPickEligible))
        .slice(0, 2)
        .map((prop, index) => {
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
            Tier-1 MLB only · verified stats · ≥{CONFIDENCE_THRESHOLDS.ELITE}% confidence · stable lines · no volatile movement.
          </p>
        </div>
        <p style={styles.countPill}>{sorted.length}/2</p>
      </div>
      {loading ? (
        <EmptyState text={`Loading ${label} picks…`} />
      ) : sorted.length === 0 ? (
        <EmptyState text="No elite MLB picks currently qualify." />
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
