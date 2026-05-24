import { memo } from "react";
import PlayerPropCard from "./PlayerPropCard.jsx";
import { styles } from "../theme/styles.js";

function AcceptedPropsPanel({ props = [], onOpen, compactMode = true }) {
  const rows = (props || []).filter(Boolean);
  if (!rows.length) return null;
  const eliteCount = rows.filter((prop) => prop.isEliteAccepted || prop.acceptedTier === "Elite").length;

  return (
    <section className="accepted-props-section" style={styles.section} aria-label="Accepted props">
      <div style={styles.sectionHeading}>
        <h2 style={styles.sectionTitle}>Accepted Props</h2>
        <p style={styles.countPill}>
          {eliteCount > 0 ? `${eliteCount} elite · ` : ""}
          {rows.length} accepted
        </p>
      </div>
      <div className="accepted-props-grid" style={styles.cardGridCompact}>
        {rows.map((prop, idx) => (
          <PlayerPropCard
            key={prop.id || `accepted-${idx}`}
            prop={prop}
            rank={idx + 1}
            compact={compactMode}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

export default memo(AcceptedPropsPanel);
