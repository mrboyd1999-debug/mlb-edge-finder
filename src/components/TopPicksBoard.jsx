import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { CONFIDENCE_THRESHOLDS } from "../services/confidenceEngine.js";
import { buildElitePickExplanation } from "../services/pickExplanation.js";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function TopPicksBoard({ label = "Sport", picks = [], loading, onOpen, compactMode = true }) {
  const sorted = useMemo(() => {
    const list = (picks || []).filter(Boolean).slice(0, 2);
    console.log("TOP PICKS BOARD INPUT COUNT", picks?.length || 0, "RENDER COUNT", list.length);
    return list.map((prop) => {
      const explanation = prop.elitePickExplanation || buildElitePickExplanation(prop);
      return {
        ...prop,
        edgeScore: prop.edgeScore ?? prop.edgeRating,
        elitePickExplanation: explanation,
        topTwoReason: explanation?.compact || prop.topTwoReason || prop.qualificationReason || "",
      };
    });
  }, [picks]);

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>{label}</p>
          <h2 style={styles.sectionTitle}>Top 2 Picks</h2>
          <p style={styles.streakCopy}>
            Best 2 accepted props · Elite {'>'} Strong {'>'} Playable · no re-filtering at render time.
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
              key={prop.id || `${prop.playerName}-${prop.statType}-${index}`}
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
