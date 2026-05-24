import { memo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import { styles } from "../theme/styles.js";

function MlbFeaturedPicksBoard({
  title = "Top MLB Plays",
  eyebrow = "PrizePicks + Underdog · unders favored",
  picks = [],
  onOpen,
}) {
  const rows = picks || [];

  return (
    <section className="mlb-featured-picks-section" style={styles.section} aria-label={title}>
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>{eyebrow}</p>
          <h2 style={styles.sectionTitle}>{title}</h2>
        </div>
        <p style={styles.countPill}>{rows.length}</p>
      </div>
      <div className="best-play-row-list" style={styles.bestPlayRowList}>
        {rows.map((prop, idx) => (
          <BestPlayRowCard key={prop.id || `${title}-${idx}`} prop={prop} rank={idx + 1} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

export default memo(MlbFeaturedPicksBoard);
