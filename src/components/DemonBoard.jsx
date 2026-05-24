import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function DemonBoard({ picks = [], loading, onOpen, compactMode = true, limit = 6 }) {
  const demons = useMemo(() => (picks || []).filter(Boolean).slice(0, limit), [picks, limit]);

  const renderCard = useMemo(
    () => (prop) => (
      <PlayerPropCard prop={prop} onOpen={onOpen} compact={compactMode} cardStyle={styles.demonCard} />
    ),
    [onOpen, compactMode]
  );

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Higher payout · ceiling upside</p>
          <h2 style={styles.sectionTitle}>Demon Picks</h2>
        </div>
        <p style={styles.countPill}>{demons.length}/{limit}</p>
      </div>
      {loading ? (
        <EmptyState text="Loading Demon lines…" />
      ) : demons.length === 0 ? (
        <EmptyState text="No Demon picks (65–79 confidence with upside) available right now." />
      ) : (
        <>
          <div style={styles.topPicksList}>{demons.map((prop) => renderCard(prop))}</div>
          <p style={styles.compactFlags}>Higher payout means higher variance.</p>
        </>
      )}
    </section>
  );
}

export default memo(DemonBoard);
