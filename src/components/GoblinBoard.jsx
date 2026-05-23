import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import VirtualCardList from "./VirtualCardList.jsx";
import { RENDER_LIMITS } from "../utils/approvedMarkets.js";
import { computeRankScore } from "../services/projectionEngine.js";
import { isGoblinProp } from "../utils/propLabels.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function GoblinBoard({ picks = [], loading, onOpen, compactMode = true }) {
  const goblins = useMemo(
    () =>
      [...picks]
        .filter(isVerifiedSportsbookProp)
        .filter(isGoblinProp)
        .sort((a, b) => computeRankScore(b) - computeRankScore(a))
        .slice(0, RENDER_LIMITS.goblins),
    [picks]
  );

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
          <p style={styles.eyebrow}>Verified Goblin</p>
          <h2 style={styles.sectionTitle}>Goblin Picks</h2>
        </div>
        <p style={styles.countPill}>{goblins.length} picks</p>
      </div>
      {loading ? (
        <EmptyState text="Loading Goblin lines…" />
      ) : goblins.length === 0 ? (
        <EmptyState text="No verified Goblin props available right now." />
      ) : (
        <>
          <VirtualCardList items={goblins} renderCard={renderCard} initialVisible={10} />
          <p style={styles.compactFlags}>Lower payout does not guarantee a hit.</p>
        </>
      )}
    </section>
  );
}

export default memo(GoblinBoard);
