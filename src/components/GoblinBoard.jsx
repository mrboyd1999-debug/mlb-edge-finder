import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import MlbPickCard from "./MlbPickCard.jsx";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function GoblinBoard({ picks = [], loading, onOpen, compactMode = true, limit = 6, title = "Goblin Picks", useMlbCard = false }) {
  const goblins = useMemo(() => (picks || []).filter(Boolean).slice(0, limit), [picks, limit]);

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>High hit rate · low variance</p>
          <h2 style={styles.sectionTitle}>{title}</h2>
        </div>
        <p style={styles.countPill}>{goblins.length}/{limit}</p>
      </div>
      {loading ? (
        <EmptyState text="Loading Goblin lines…" />
      ) : goblins.length === 0 ? (
        <EmptyState text="No Goblin picks (80+ confidence, low variance) available right now." />
      ) : (
        <>
          <div style={styles.topPicksList}>
            {goblins.map((prop, idx) =>
              useMlbCard ? (
                <MlbPickCard key={prop.id || `goblin-${idx}`} prop={prop} rank={idx + 1} onOpen={onOpen} cardStyle={styles.goblinCard} />
              ) : (
                <PlayerPropCard key={prop.id || `goblin-${idx}`} prop={prop} onOpen={onOpen} compact={compactMode} cardStyle={styles.goblinCard} />
              )
            )}
          </div>
          <p style={styles.compactFlags}>Safer lines — lower payout does not guarantee a hit.</p>
        </>
      )}
    </section>
  );
}

export default memo(GoblinBoard);
