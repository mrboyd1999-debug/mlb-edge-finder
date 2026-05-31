import { memo, useMemo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import BestPlayFilterDiagnostics from "./BestPlayFilterDiagnostics.jsx";
import TierAuditPanel from "./TierAuditPanel.jsx";
import { NO_BEST_PLAYS_STANDARDS_MESSAGE } from "../utils/mlbBoardPipeline.js";
import { safeArray } from "../utils/safeStats.js";
import { liveBoardLoadingMessage } from "../utils/liveBoardLoading.js";
import { getUniquePlayerTopPlays } from "../utils/ranking.js";

function findSection(sections, id) {
  return (sections || []).find((row) => row.id === id) || null;
}

function BestPlaysTab({
  sections = [],
  loading = false,
  loadingStage = "",
  loadError = "",
  onOpen,
  filterDiagnostics = null,
  showDebugPanels = false,
}) {
  const topBestPlaysSection = useMemo(() => findSection(sections, "top-10-best-plays"), [sections]);
  const morePlaysSection = useMemo(() => findSection(sections, "more-plays"), [sections]);

  const topBestPlays = useMemo(
    () => getUniquePlayerTopPlays(safeArray(topBestPlaysSection?.picks), 3),
    [topBestPlaysSection]
  );
  const morePlays = useMemo(
    () => getUniquePlayerTopPlays(safeArray(morePlaysSection?.picks), 10),
    [morePlaysSection]
  );

  const fallbackNotice = topBestPlaysSection?.fallbackNotice || "";
  const tierDebug = filterDiagnostics?.bestPlayFilterAudit?.tierDebugSummary || filterDiagnostics?.tierDebugSummary;

  if (loading) {
    return (
      <div className="compact-tab-panel">
        <p className="compact-empty">
          Loading MLB verified plays…
          {loadingStage ? ` (${liveBoardLoadingMessage(loadingStage)})` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="compact-tab-panel">
      {loadError ? <p className="compact-form-notice">{loadError}</p> : null}

      <section className="compact-section">
        <div className="compact-section__head">
          <h2>Best Plays</h2>
          {fallbackNotice ? <p className="compact-form-notice">{fallbackNotice}</p> : null}
        </div>

        {showDebugPanels ? (
          <BestPlayFilterDiagnostics filterDiagnostics={filterDiagnostics} showExtended={showDebugPanels} />
        ) : null}

        {topBestPlays.length ? (
          <div className="compact-card-list">
            {topBestPlays.map((prop, index) => (
              <SectionErrorBoundary
                key={prop?.id || `${prop?.playerName}-${prop?.statType}-${prop?.line}-${index}`}
                name={`Best Plays #${index + 1}`}
              >
                <BestPlayRowCard
                  prop={prop}
                  rank={index + 1}
                  rankLabel={prop.bestPlayRankLabel}
                  onOpen={onOpen}
                />
              </SectionErrorBoundary>
            ))}
          </div>
        ) : (
          <p className="compact-empty">
            {topBestPlaysSection?.emptyMessage || NO_BEST_PLAYS_STANDARDS_MESSAGE}
          </p>
        )}
      </section>

      {morePlays.length ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{morePlaysSection?.title || "More Plays"}</h2>
            {morePlaysSection?.eyebrow ? (
              <p className="compact-section__eyebrow">{morePlaysSection.eyebrow}</p>
            ) : null}
          </div>
          <div className="compact-card-list">
            {morePlays.map((prop, index) => (
              <SectionErrorBoundary
                key={prop?.id || `${prop?.playerName}-${prop?.statType}-${prop?.line}-more-${index}`}
                name={`More Plays #${index + 1}`}
              >
                <BestPlayRowCard
                  prop={prop}
                  rank={prop.bestPlayRank ?? index + 4}
                  rankLabel={prop.bestPlayRankLabel}
                  compact
                  onOpen={onOpen}
                />
              </SectionErrorBoundary>
            ))}
          </div>
        </section>
      ) : null}

      {showDebugPanels ? (
        <div className="debug-diagnostics-stack">
          {tierDebug ? (
            <p className="compact-form-notice">
              Tier A {tierDebug.tierA ?? 0} · Tier B {tierDebug.tierB ?? 0} · Tier C {tierDebug.tierC ?? 0}
            </p>
          ) : null}
          <TierAuditPanel auditRows={filterDiagnostics?.tierAuditBatch} limit={12} />
        </div>
      ) : null}
    </div>
  );
}

export default memo(BestPlaysTab);
