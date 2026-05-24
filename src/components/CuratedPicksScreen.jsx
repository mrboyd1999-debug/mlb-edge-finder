import { memo } from "react";
import TopPicksBoard from "./TopPicksBoard.jsx";
import GoblinBoard from "./GoblinBoard.jsx";
import DemonBoard from "./DemonBoard.jsx";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";
import { CURATED_SPORT_LABELS, CURATED_SPORT_ORDER } from "../utils/curatedPicks.js";

function EmptyState({ text }) {
  return <div style={styles.emptyStateCompact}>{text}</div>;
}

function ParlayBuilderSection({ picks = [], loading, onOpen, compactMode = true }) {
  const legs = (picks || []).filter(Boolean).slice(0, 4);
  return (
    <section className="curated-parlay-section" style={styles.section} aria-label="4-Man Builder">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Low correlation · best combined edge</p>
          <h2 style={styles.sectionTitle}>4-Man Builder</h2>
        </div>
        <p style={styles.countPill}>{legs.length}/4</p>
      </div>
      {loading ? (
        <EmptyState text="Building parlay legs…" />
      ) : legs.length === 0 ? (
        <EmptyState text="No strong 4-man combo yet — need four uncorrelated playable legs." />
      ) : (
        <div className="curated-parlay-grid" style={styles.topPicksList}>
          {legs.map((prop, idx) => (
            <PlayerPropCard
              key={prop.id || `parlay-${idx}`}
              prop={prop}
              rank={idx + 1}
              compact={compactMode}
              onOpen={onOpen}
              cardStyle={styles.parlayCard}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CuratedPicksScreen({
  sportPicks = {},
  parlayPicks = [],
  goblinPicks = [],
  demonPicks = [],
  loading = false,
  onOpen,
  compactMode = true,
}) {
  return (
    <div className="curated-picks-screen">
      {CURATED_SPORT_ORDER.map((sport) => (
        <div key={sport} id={`section-streak-${sport.toLowerCase()}`} className="curated-sport-block">
          <TopPicksBoard
            label={CURATED_SPORT_LABELS[sport] || sport}
            picks={sportPicks[sport] || []}
            onOpen={onOpen}
            compactMode={compactMode}
          />
        </div>
      ))}

      <ParlayBuilderSection picks={parlayPicks} loading={loading} onOpen={onOpen} compactMode={compactMode} />

      <GoblinBoard picks={goblinPicks} loading={loading} onOpen={onOpen} compactMode={compactMode} limit={6} />
      <DemonBoard picks={demonPicks} loading={loading} onOpen={onOpen} compactMode={compactMode} limit={6} />
    </div>
  );
}

export default memo(CuratedPicksScreen);
