import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import MlbPickCard from "./MlbPickCard.jsx";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function DemonBoard({ picks = [], loading, onOpen, compactMode = true, limit = 6, title = "Demon Picks", useMlbCard = false }) {
  const demons = useMemo(() => (picks || []).filter(Boolean).slice(0, limit), [picks, limit]);

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Higher payout · ceiling upside</p>
          <h2 style={styles.sectionTitle}>{title}</h2>
        </div>
        <p style={styles.countPill}>{demons.length}/{limit}</p>
      </div>
      {loading ? (
        <EmptyState text="Loading Demon lines…" />
      ) : demons.length === 0 ? (
        <EmptyState text="No Demon picks (65–79 confidence with upside) available right now." />
      ) : (
        <>
          <div style={styles.topPicksList}>
            {demons.map((prop, idx) =>
              useMlbCard ? (
                <MlbPickCard key={prop.id || `demon-${idx}`} prop={prop} rank={idx + 1} onOpen={onOpen} cardStyle={styles.demonCard} />
              ) : (
                <PlayerPropCard key={prop.id || `demon-${idx}`} prop={prop} onOpen={onOpen} compact={compactMode} cardStyle={styles.demonCard} />
              )
            )}
          </div>
          <p style={styles.compactFlags}>Higher payout means higher variance.</p>
        </>
      )}
    </section>
  );
}

export default memo(DemonBoard);
