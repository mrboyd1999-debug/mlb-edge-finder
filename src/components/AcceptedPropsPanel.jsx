import { memo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";

function SavedPicksPanel({ props = [], onOpen, compactMode = true }) {
  const rows = (props || []).filter(Boolean);

  return (
    <section className="saved-picks-section" style={styles.section} aria-label="Saved picks">
      <div style={styles.sectionHeading}>
        <h2 style={styles.sectionTitle}>Saved Picks</h2>
        <p style={styles.countPill}>{rows.length} saved</p>
      </div>
      {rows.length === 0 ? (
        <div style={styles.emptyStateCompact}>No saved picks yet.</div>
      ) : (
        <div className="saved-picks-grid" style={styles.cardGridCompact}>
          {rows.map((prop, idx) => (
            <PlayerPropCard
              key={prop.id || `saved-${idx}`}
              prop={prop}
              rank={idx + 1}
              compact={compactMode}
              onOpen={onOpen}
              savedResult={prop.resultStatus || prop.finalResult || prop.status}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(SavedPicksPanel);
