import { memo, useMemo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import BestPlayFilterDiagnostics from "./BestPlayFilterDiagnostics.jsx";
import TierAuditPanel from "./TierAuditPanel.jsx";
import { NO_VERIFIED_PLAYS_MESSAGE } from "../utils/mlbBoardPipeline.js";
import { safeArray } from "../utils/safeStats.js";
import { liveBoardLoadingMessage } from "../utils/liveBoardLoading.js";

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

  const topBestPlays = useMemo(() => safeArray(topBestPlaysSection?.picks).slice(0, 10), [topBestPlaysSection]);

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

        {topBestPlays.length ? (
          <div className="compact-card-list">
            {topBestPlays.map((prop, index) => (
              <SectionErrorBoundary
                key={prop?.id || `${prop?.playerName}-${prop?.statType}-${prop?.line}-${index}`}
                name={`Best Plays #${index + 1}`}
              >
                <BestPlayRowCard prop={prop} rank={index + 1} onOpen={onOpen} />
              </SectionErrorBoundary>
            ))}
          </div>
        ) : (
          <p className="compact-empty">
            {topBestPlaysSection?.emptyMessage || NO_VERIFIED_PLAYS_MESSAGE}
          </p>
        )}
      </section>

      {showDebugPanels ? (
        <div className="debug-diagnostics-stack">
          {tierDebug ? (
            <p className="compact-form-notice">
              Tier A {tierDebug.tierA ?? 0} · Tier B {tierDebug.tierB ?? 0} · Tier C {tierDebug.tierC ?? 0}
            </p>
          ) : null}
          <BestPlayFilterDiagnostics filterDiagnostics={filterDiagnostics} />
          <TierAuditPanel auditRows={filterDiagnostics?.tierAuditBatch} limit={12} />
        </div>
      ) : null}
    </div>
  );
}

export default memo(BestPlaysTab);
