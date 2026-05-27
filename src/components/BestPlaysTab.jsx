import { memo, useMemo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";

function BestPlaysTab({ sections = [], loading = false, onOpen, filterDiagnostics = null }) {
  const { picks, debugBanner } = useMemo(() => {
    const section =
      (sections || []).find((row) => row.id === "highest-probability") ||
      (sections || []).find((row) => row.id === "best-plays") ||
      (sections || [])[0];
    const sectionPicks = section?.picks || [];
    const counts = filterDiagnostics?.pipelineCounts;
    const invalidReasons = filterDiagnostics?.invalidReasons;

    let banner = null;
    if (counts || invalidReasons) {
      const reasonText = invalidReasons
        ? Object.entries(invalidReasons)
            .slice(0, 6)
            .map(([reason, count]) => `${reason}: ${count}`)
            .join(" · ")
        : "";
      banner = [
        counts
          ? `Pipeline: ${counts.rawProps ?? 0} raw · ${counts.normalized ?? 0} normalized · ${counts.withProjections ?? 0} with projections · ${counts.filtered ?? 0} verified · ${sectionPicks.length} shown`
          : null,
        reasonText ? `Rejected: ${reasonText}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    }

    return { picks: sectionPicks, debugBanner: banner };
  }, [sections, filterDiagnostics]);

  if (loading) {
    return <p className="compact-empty">Loading MLB projection candidates…</p>;
  }

  return (
    <div className="compact-tab-panel">
      {debugBanner ? (
        <p className="compact-form-notice" style={{ marginBottom: 12 }}>
          {debugBanner}
        </p>
      ) : null}
      {!picks.length ? (
        <p className="compact-empty">No verified MLB props available yet.</p>
      ) : (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>MLB Projection Candidates</h2>
            <p>Verified MLB props with real projections, edge, and confidence above threshold.</p>
          </div>
          <div className="compact-card-list">
            {picks.map((prop, index) => (
              <BestPlayRowCard key={prop.id || `hp-${index}`} prop={prop} rank={index + 1} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default memo(BestPlaysTab);
