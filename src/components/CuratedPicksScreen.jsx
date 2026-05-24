import { memo } from "react";
import TopPicksBoard from "./TopPicksBoard.jsx";
import GoblinBoard from "./GoblinBoard.jsx";
import DemonBoard from "./DemonBoard.jsx";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";
import { CURATED_SPORT_LABELS, CURATED_SPORT_ORDER, DISPLAY_LIMITS } from "../utils/curatedPicks.js";

function ParlayBuilderSection({ picks = [], loading, onOpen, compactMode = true }) {
  const legs = (picks || []).filter(Boolean).slice(0, DISPLAY_LIMITS.parlayLegs);

  return (
    <section className="curated-parlay-section" style={styles.section} aria-label="4-Man Builder">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Low correlation · best combined edge</p>
          <h2 style={styles.sectionTitle}>4-Man Builder</h2>
        </div>
        <p style={styles.countPill}>{legs.length}/{DISPLAY_LIMITS.parlayLegs}</p>
      </div>
      {loading ? (
        <div style={styles.emptyStateCompact}>Building parlay legs…</div>
      ) : legs.length === 0 ? (
        <div style={styles.emptyStateCompact}>No strong 4-man combo yet.</div>
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
            picks={(sportPicks[sport] || []).slice(0, DISPLAY_LIMITS.streakPerSport)}
            onOpen={onOpen}
            compactMode={compactMode}
          />
        </div>
      ))}

      <ParlayBuilderSection
        picks={parlayPicks.slice(0, DISPLAY_LIMITS.parlayLegs)}
        loading={loading}
        onOpen={onOpen}
        compactMode={compactMode}
      />

      <GoblinBoard
        picks={goblinPicks.slice(0, DISPLAY_LIMITS.goblins)}
        loading={loading}
        onOpen={onOpen}
        compactMode={compactMode}
        limit={DISPLAY_LIMITS.goblins}
      />
      <DemonBoard
        picks={demonPicks.slice(0, DISPLAY_LIMITS.demons)}
        loading={loading}
        onOpen={onOpen}
        compactMode={compactMode}
        limit={DISPLAY_LIMITS.demons}
      />
    </div>
  );
}

export default memo(CuratedPicksScreen);
