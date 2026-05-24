import { memo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";
import { displayMarketLabel } from "../utils/propLabels.js";
import { formatLeanSide, formatNumber, shortReason } from "../utils/formatters.js";
import { MLB_EMPTY_MESSAGE } from "../utils/curatedPicks.js";

function MlbStreakPicksBoard({ picks = [], onOpen, compactMode = true, hasMlbProps = false, loading = false }) {
  const streakPicks = (picks || []).filter(Boolean).slice(0, 2);

  return (
    <section className="mlb-streak-picks-section" style={styles.section} aria-label="MLB Streak Picks">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Top 2 · MLB only</p>
          <h2 style={styles.sectionTitle}>MLB Streak Picks</h2>
        </div>
        <p style={styles.countPill}>{streakPicks.length}/2</p>
      </div>
      {loading ? (
        <div style={styles.emptyStateCompact}>Loading MLB streak picks…</div>
      ) : streakPicks.length > 0 ? (
        <div className="mlb-streak-picks-grid" style={styles.topPicksList}>
          {streakPicks.map((prop, idx) => {
            const conf = prop.confidenceScore ?? prop.confidence ?? "—";
            const edge = Number.isFinite(Number(prop.edge)) ? formatNumber(prop.edge) : "—";
            const lean = formatLeanSide(prop.bestPick || prop.side || "Watch");
            const source = prop.platform || prop.source || "—";
            return (
              <div key={prop.id || `mlb-streak-${idx}`} className="mlb-streak-pick-wrap">
                <PlayerPropCard
                  prop={prop}
                  rank={idx + 1}
                  compact={compactMode}
                  topPick
                  onOpen={onOpen}
                  cardStyle={styles.streakCard}
                />
                <p style={{ ...styles.compactFlags, margin: "4px 0 0", color: "#cbd5e1" }}>
                  {prop.team ? `${prop.team} · ` : ""}
                  {displayMarketLabel(prop)} · Line {formatNumber(prop.line)} · {source} · CONF {conf}% · EDGE {edge} · {lean}
                  {prop.isFallbackMlbPick ? " · Fallback MLB pick" : ""}
                </p>
                <p style={{ ...styles.compactFlags, margin: "2px 0 0" }}>{shortReason(prop)}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={styles.emptyStateCompact}>{hasMlbProps ? "No MLB streak picks ranked yet." : MLB_EMPTY_MESSAGE}</div>
      )}
    </section>
  );
}

export default memo(MlbStreakPicksBoard);
