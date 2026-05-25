import { memo, useMemo } from "react";
import CompactPropCard from "./CompactPropCard.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";

const SECTION_SPECS = [
  { id: "best-plays", title: "Top 2 Safest Plays", limit: 2, useRow: true },
  { id: "4-man-builder", title: "4-Man Builder", limit: 4, useRow: false },
  { id: "goblins", title: "Top 6 Goblins", limit: 6, useRow: false },
  { id: "demons", title: "Top 6 Demons", limit: 6, useRow: false },
];

function BestPlaysTab({ sections = [], loading = false, onOpen, onSave }) {
  const mapped = useMemo(() => {
    const byId = Object.fromEntries((sections || []).map((section) => [section.id, section]));
    return SECTION_SPECS.map((spec) => ({
      ...spec,
      picks: (byId[spec.id]?.picks || []).slice(0, spec.limit),
      eyebrow: byId[spec.id]?.eyebrow || "",
    })).filter((section) => section.picks.length > 0 || loading);
  }, [sections, loading]);

  if (loading) {
    return <p className="compact-empty">Loading best MLB plays…</p>;
  }

  if (!mapped.some((section) => section.picks.length)) {
    return (
      <p className="compact-empty">
        No ranked MLB plays yet. Use Manual Analyzer or refresh live lines when APIs are connected.
      </p>
    );
  }

  return (
    <div className="compact-tab-panel">
      {mapped.map((section) =>
        section.picks.length ? (
          <section key={section.id} className="compact-section">
            <div className="compact-section__head">
              <h2>{section.title}</h2>
              {section.eyebrow ? <p>{section.eyebrow}</p> : null}
            </div>
            <div className="compact-card-list">
              {section.picks.map((prop, index) =>
                section.useRow ? (
                  <BestPlayRowCard key={prop.id || `${section.id}-${index}`} prop={prop} rank={index + 1} onOpen={onOpen} />
                ) : (
                  <CompactPropCard
                    key={prop.id || `${section.id}-${index}`}
                    prop={prop}
                    rank={index + 1}
                    onOpen={onOpen}
                    onSave={onSave}
                    qualifyReason={prop.analyticsReason || prop.whyThisPick}
                  />
                )
              )}
            </div>
          </section>
        ) : null
      )}
    </div>
  );
}

export default memo(BestPlaysTab);
