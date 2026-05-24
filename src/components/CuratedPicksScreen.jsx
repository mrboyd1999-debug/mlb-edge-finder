import { memo } from "react";
import MlbStreakPicksBoard from "./MlbStreakPicksBoard.jsx";
import GoblinBoard from "./GoblinBoard.jsx";
import DemonBoard from "./DemonBoard.jsx";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";
import { DISPLAY_LIMITS, MLB_EMPTY_MESSAGE } from "../utils/curatedPicks.js";
import { MLB_ONLY_MODE } from "../utils/mlbOnlyMode.js";

function ParlayBuilderSection({ picks = [], loading, onOpen, compactMode = true, hasMlbProps = false }) {
  const legs = (picks || []).filter(Boolean).slice(0, DISPLAY_LIMITS.parlayLegs);

  return (
    <section className="curated-parlay-section" style={styles.section} aria-label="MLB 4-Man Builder">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>MLB · low correlation combo</p>
          <h2 style={styles.sectionTitle}>MLB 4-Man Builder</h2>
        </div>
        <p style={styles.countPill}>{legs.length}/{DISPLAY_LIMITS.parlayLegs}</p>
      </div>
      {loading ? (
        <div style={styles.emptyStateCompact}>Building MLB parlay legs…</div>
      ) : legs.length === 0 ? (
        <div style={styles.emptyStateCompact}>{hasMlbProps ? "No strong MLB 4-man combo yet." : MLB_EMPTY_MESSAGE}</div>
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
  mlbStreakPicks = [],
  parlayPicks = [],
  goblinPicks = [],
  demonPicks = [],
  loading = false,
  onOpen,
  compactMode = true,
  hasMlbProps = false,
}) {
  if (MLB_ONLY_MODE) {
    return (
      <div className="curated-picks-screen curated-picks-mlb-only">
        <MlbStreakPicksBoard
          picks={mlbStreakPicks}
          loading={loading}
          onOpen={onOpen}
          compactMode={compactMode}
          hasMlbProps={hasMlbProps}
        />
        <ParlayBuilderSection
          picks={parlayPicks}
          loading={loading}
          onOpen={onOpen}
          compactMode={compactMode}
          hasMlbProps={hasMlbProps}
        />
        <GoblinBoard
          picks={goblinPicks.slice(0, DISPLAY_LIMITS.goblins)}
          loading={loading}
          onOpen={onOpen}
          compactMode={compactMode}
          limit={DISPLAY_LIMITS.goblins}
          title="MLB Goblins"
        />
        <DemonBoard
          picks={demonPicks.slice(0, DISPLAY_LIMITS.demons)}
          loading={loading}
          onOpen={onOpen}
          compactMode={compactMode}
          limit={DISPLAY_LIMITS.demons}
          title="MLB Demons"
        />
      </div>
    );
  }

  return null;
}

export default memo(CuratedPicksScreen);
