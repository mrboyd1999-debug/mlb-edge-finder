import { memo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";

function TopPicksBoard({ label = "Sport", picks = [], onOpen, compactMode = true }) {
  const topPicks = (picks || []).filter(Boolean).slice(0, 2);

  return (
    <section className="top-picks-section" style={styles.section}>
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Top 2 · {label}</p>
          <h2 style={styles.sectionTitle}>Top Picks</h2>
        </div>
        <p style={styles.countPill}>{topPicks.length}/2</p>
      </div>
      {topPicks.length > 0 ? (
        <div className="top-picks-grid" style={styles.topPicksList}>
          {topPicks.map((prop, idx) => {
            const why = prop.whyThisPick || {};
            return (
              <div key={prop.id || `top-pick-${idx}`} className="top-pick-wrap">
                <PlayerPropCard
                  prop={prop}
                  rank={idx + 1}
                  compact={compactMode}
                  topPick
                  onOpen={onOpen}
                  cardStyle={styles.streakCard}
                />
                <div className="why-this-pick-block" style={styles.whyPickBlock}>
                  <strong style={styles.whyPickTitle}>Why this pick</strong>
                  <p style={styles.whyPickCopy}>
                    {why.compact ||
                      [
                        why.hitRate != null ? `Hit rate ${why.hitRate}%` : null,
                        why.matchupEdge ? `Matchup: ${why.matchupEdge}` : null,
                        why.projectionDelta != null ? `Projection delta ${why.projectionDelta >= 0 ? "+" : ""}${why.projectionDelta}` : null,
                        why.lineValue != null ? `Line value ${why.lineValue}%` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") ||
                      prop.confidenceExplanation}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={styles.emptyStateCompact}>No valid props available for Top Picks yet.</div>
      )}
    </section>
  );
}

export default memo(TopPicksBoard);
