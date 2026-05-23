import { memo } from "react";
import SimplePropCard from "./SimplePropCard.jsx";
import { styles } from "../theme/styles.js";

function AcceptedPropsPanel({ props = [], loading = false, onOpen, acceptedCount = 0 }) {
  const rows = (props || []).filter(Boolean);

  if (loading) {
    return (
      <section className="accepted-props-section" style={styles.section} aria-label="Accepted props">
        <h2 style={styles.sectionTitle}>Accepted Props</h2>
        <p style={styles.streakCopy}>Loading accepted props…</p>
      </section>
    );
  }

  if (!rows.length && !Number(acceptedCount)) return null;

  return (
    <section className="accepted-props-section" style={styles.section} aria-label="Accepted props">
      <div style={styles.sectionHeading}>
        <h2 style={styles.sectionTitle}>Accepted Props</h2>
        <p style={styles.countPill}>{rows.length || acceptedCount} accepted</p>
      </div>
      {rows.length ? (
        <div className="accepted-props-grid" style={styles.cardGridCompact}>
          {rows.map((prop, idx) => (
            <SimplePropCard
              key={prop.id || `accepted-${idx}`}
              prop={prop}
              index={idx}
              className="accepted-prop-card"
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <p style={styles.streakCopy}>Pipeline reports {acceptedCount} accepted — waiting for prop objects to hydrate.</p>
      )}
    </section>
  );
}

export default memo(AcceptedPropsPanel);
