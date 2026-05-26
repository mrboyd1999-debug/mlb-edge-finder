import { memo, useMemo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";

function BestPlaysTab({ sections = [], loading = false, onOpen }) {
  const picks = useMemo(() => {
    const section =
      (sections || []).find((row) => row.id === "highest-probability") ||
      (sections || []).find((row) => row.id === "best-plays") ||
      (sections || [])[0];
    return section?.picks || [];
  }, [sections]);

  if (loading) {
    return <p className="compact-empty">Loading highest probability props…</p>;
  }

  if (!picks.length) {
    return (
      <p className="compact-empty">
        No highest-probability MLB plays yet. Verified projections need 65%+ confidence, +0.5 edge, and matched MLB Stats API logs.
      </p>
    );
  }

  return (
    <div className="compact-tab-panel">
      <section className="compact-section">
        <div className="compact-section__head">
          <h2>Highest Probability Props</h2>
          <p>Top verified MLB edges ranked by confidence, edge, and sample depth</p>
        </div>
        <div className="compact-card-list">
          {picks.map((prop, index) => (
            <BestPlayRowCard key={prop.id || `hp-${index}`} prop={prop} rank={index + 1} onOpen={onOpen} />
          ))}
        </div>
      </section>
    </div>
  );
}

export default memo(BestPlaysTab);
