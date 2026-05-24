import { memo } from "react";
import TopPicksBoard from "./TopPicksBoard.jsx";
import GoblinBoard from "./GoblinBoard.jsx";
import DemonBoard from "./DemonBoard.jsx";
import { styles } from "../theme/styles.js";
import { CURATED_SPORT_LABELS, CURATED_SPORT_ORDER, DISPLAY_LIMITS } from "../utils/curatedPicks.js";
import { displayMarketLabel } from "../utils/propLabels.js";
import { formatNumber } from "../utils/formatters.js";

function ParlayBuilderSection({ picks = [], loading, onOpen, compactMode = true }) {
  const legs = (picks || []).filter(Boolean).slice(0, DISPLAY_LIMITS.parlayLegs);
  const hasBuilder = legs.length > 0;

  return (
    <section className="curated-parlay-section" style={styles.section} aria-label="4-Man Builder">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Low correlation · best combined edge</p>
          <h2 style={styles.sectionTitle}>4-Man Builder</h2>
        </div>
        <p style={styles.countPill}>{hasBuilder ? `${Math.min(legs.length, DISPLAY_LIMITS.parlayLegs)}/4` : "0/4"}</p>
      </div>
      {loading ? (
        <div style={styles.emptyStateCompact}>Building parlay legs…</div>
      ) : !hasBuilder ? (
        <div style={styles.emptyStateCompact}>No strong 4-man combo yet.</div>
      ) : (
        <details className="parlay-builder-card" style={styles.compactDetails}>
          <summary style={styles.detailsSummary}>
            <span>
              <strong>Best 4-leg combo</strong>
              <span style={{ ...styles.compactFlags, display: "block", marginTop: "2px" }}>
                {legs[0]?.playerName || "Top legs"} · {legs.length} leg{legs.length === 1 ? "" : "s"}
              </span>
            </span>
            <span style={styles.countPill}>Open</span>
          </summary>
          <div style={styles.compactPanel}>
            <ol style={{ margin: 0, paddingLeft: "18px" }}>
              {legs.map((prop, idx) => (
                <li key={prop.id || `parlay-leg-${idx}`} style={{ marginBottom: "6px" }}>
                  <button
                    type="button"
                    style={{
                      ...styles.secondaryButton,
                      width: "100%",
                      textAlign: "left",
                      padding: compactMode ? "4px 6px" : "6px 8px",
                      fontSize: compactMode ? "11px" : "12px",
                    }}
                    onClick={() => onOpen?.(prop)}
                  >
                    {prop.playerName} · {displayMarketLabel(prop)} {formatNumber(prop.line)} ·{" "}
                    {prop.confidenceScore ?? prop.confidence ?? "—"}%
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </details>
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

      <ParlayBuilderSection picks={parlayPicks} loading={loading} onOpen={onOpen} compactMode={compactMode} />

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
