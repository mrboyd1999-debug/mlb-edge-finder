import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function GoblinBoard({ picks = [], loading, onOpen, compactMode = true, limit = 6 }) {
  const goblins = useMemo(() => (picks || []).filter(Boolean).slice(0, limit), [picks, limit]);

  const renderCard = useMemo(
    () => (prop) => (
      <PlayerPropCard prop={prop} onOpen={onOpen} compact={compactMode} cardStyle={styles.goblinCard} />
    ),
    [onOpen, compactMode]
  );

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>High hit rate · low variance</p>
          <h2 style={styles.sectionTitle}>Goblin Picks</h2>
        </div>
        <p style={styles.countPill}>{goblins.length}/{limit}</p>
      </div>
      {loading ? (
        <EmptyState text="Loading Goblin lines…" />
      ) : goblins.length === 0 ? (
        <EmptyState text="No Goblin picks (80+ confidence, low variance) available right now." />
      ) : (
        <>
          <div style={styles.topPicksList}>{goblins.map((prop) => renderCard(prop))}</div>
          <p style={styles.compactFlags}>Safer lines — lower payout does not guarantee a hit.</p>
        </>
      )}
    </section>
  );
}

export default memo(GoblinBoard);
