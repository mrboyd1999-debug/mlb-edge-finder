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
    const debugMode = filterDiagnostics?.debugMode;

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
          ? `Pipeline: ${counts.rawProps ?? 0} raw · ${counts.normalized ?? 0} normalized · ${counts.withProjections ?? 0} with projections · ${counts.filtered ?? 0} filtered · ${sectionPicks.length} shown`
          : null,
        reasonText ? `Invalid: ${reasonText}` : null,
        debugMode ? "Debug mode: showing sample props even when below normal thresholds." : null,
      ]
        .filter(Boolean)
        .join(" | ");
    }

    return { picks: sectionPicks, debugBanner: banner };
  }, [sections, filterDiagnostics]);

  if (loading) {
    return <p className="compact-empty">Loading highest probability props…</p>;
  }

  return (
    <div className="compact-tab-panel">
      {debugBanner ? (
        <p className="compact-form-notice" style={{ marginBottom: 12 }}>
          {debugBanner}
        </p>
      ) : null}
      {!picks.length ? (
        <p className="compact-empty">
          No renderable MLB props in the current sample. Check Developer Debug pipeline counts — feed props may be
          missing projections or player matches.
        </p>
      ) : (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>Highest Probability Props</h2>
            <p>Debug view — ranked props with pipeline visibility (edge filtering temporarily disabled)</p>
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
