import { memo, useMemo, useState } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import BestPlayFilterDiagnostics from "./BestPlayFilterDiagnostics.jsx";
import TierAuditPanel from "./TierAuditPanel.jsx";
import { NO_BEST_PLAYS_STANDARDS_MESSAGE } from "../utils/mlbBoardPipeline.js";
import { safeArray } from "../utils/safeStats.js";
import { liveBoardLoadingMessage } from "../utils/liveBoardLoading.js";
import { getUniquePlayerTopPlays } from "../utils/ranking.js";
import { resolvePayoutCategory, PAYOUT_DEMON, PAYOUT_GOBLIN, PAYOUT_STANDARD } from "../utils/payoutCategory.js";

function filterPlaysByPayout(plays = [], payoutFilter = "all") {
  if (payoutFilter === "all") return plays;
  const target =
    payoutFilter === "goblin"
      ? PAYOUT_GOBLIN
      : payoutFilter === "standard"
        ? PAYOUT_STANDARD
        : payoutFilter === "demon"
          ? PAYOUT_DEMON
          : null;
  if (!target) return plays;
  return plays.filter((prop) => resolvePayoutCategory(prop) === target);
}

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
  staleDataActive = false,
  showStaleCache = false,
  onShowStaleCache,
  boardUpdatedAt = "",
}) {
  const [payoutFilter, setPayoutFilter] = useState("all");
  const topBestPlaysSection = useMemo(() => findSection(sections, "top-10-best-plays"), [sections]);
  const morePlaysSection = useMemo(() => findSection(sections, "more-plays"), [sections]);

  const topBestPlays = useMemo(
    () => filterPlaysByPayout(getUniquePlayerTopPlays(safeArray(topBestPlaysSection?.picks), 3), payoutFilter),
    [topBestPlaysSection, payoutFilter]
  );
  const morePlays = useMemo(
    () => filterPlaysByPayout(getUniquePlayerTopPlays(safeArray(morePlaysSection?.picks), 10), payoutFilter),
    [morePlaysSection, payoutFilter]
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

  if (staleDataActive && !showStaleCache) {
    return (
      <div className="compact-tab-panel">
        <section className="compact-section">
          <h2>Best Plays</h2>
          <p className="compact-form-notice">
            Board data is stale{boardUpdatedAt ? ` (${boardUpdatedAt})` : ""}. Click Refresh to load today&apos;s lines,
            or view the cached board below.
          </p>
          <button type="button" className="compact-form-button" onClick={onShowStaleCache}>
            Show stale cache
          </button>
        </section>
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

        <div className="payout-filter-row" role="tablist" aria-label="Payout category filter">
          {[
            { id: "all", label: "All" },
            { id: "goblin", label: "Goblins" },
            { id: "standard", label: "Standard" },
            { id: "demon", label: "Demons" },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={payoutFilter === option.id}
              className={`payout-filter-btn${payoutFilter === option.id ? " payout-filter-btn--active" : ""}`}
              onClick={() => setPayoutFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
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
