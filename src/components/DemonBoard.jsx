import { memo, useMemo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import VirtualCardList from "./VirtualCardList.jsx";
import { RENDER_LIMITS } from "../utils/approvedMarkets.js";
import { isDemonEligible, sortDecisionBoard } from "../services/decisionEngine.js";
import { styles } from "../theme/styles.js";

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function DemonBoard({ picks = [], loading, onOpen, compactMode = true }) {
  const demons = useMemo(
    () => sortDecisionBoard(picks.filter(isDemonEligible)).slice(0, RENDER_LIMITS.demons),
    [picks]
  );

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
          <p style={styles.eyebrow}>Verified Demon</p>
          <h2 style={styles.sectionTitle}>Demon Picks</h2>
        </div>
        <p style={styles.countPill}>{demons.length} picks</p>
      </div>
      {loading ? (
        <EmptyState text="Loading Demon lines…" />
      ) : demons.length === 0 ? (
        <EmptyState text="No verified Demon props available right now." />
      ) : (
        <>
          <VirtualCardList items={demons} renderCard={renderCard} initialVisible={10} />
          <p style={styles.compactFlags}>Higher payout means higher variance.</p>
        </>
      )}
    </section>
  );
}

export default memo(DemonBoard);
