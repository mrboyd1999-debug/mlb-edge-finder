import { memo, useMemo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import BestPlayHeroCard from "./BestPlayHeroCard.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import PerformanceTracker from "./PerformanceTracker.jsx";
import BestPlayFilterDiagnostics from "./BestPlayFilterDiagnostics.jsx";
import TierAuditPanel from "./TierAuditPanel.jsx";
import { compareBestPlaysRank, applyBestPlayRankConstraints } from "../utils/bestPlayRankingScore.js";
import { NO_VERIFIED_PLAYS_MESSAGE } from "../utils/mlbBoardPipeline.js";
import { safeArray } from "../utils/safeStats.js";
import { liveBoardLoadingMessage } from "../utils/liveBoardLoading.js";

function findSection(sections, id) {
  return (sections || []).find((row) => row.id === id) || null;
}

function BestPlaysSection({ section, onOpen, cacheStatus = "", sortFn = null, limit = null }) {
  const picks = useMemo(() => {
    const rows = safeArray(section?.picks);
    const sorted = sortFn ? [...rows].sort(sortFn) : rows;
    return limit != null ? sorted.slice(0, limit) : sorted;
  }, [section, sortFn, limit]);

  if (!section) return null;

  return (
    <section className="compact-section">
      <div className="compact-section__head">
        <h2>{section.title}</h2>
        {section.eyebrow ? <p>{section.eyebrow}</p> : null}
        {section.fallbackNotice ? <p className="compact-form-notice">{section.fallbackNotice}</p> : null}
      </div>
      {picks.length ? (
        <div className="compact-card-list">
          {picks.map((prop, index) => (
            <SectionErrorBoundary
              key={prop?.id || `${prop?.playerName}-${prop?.statType}-${prop?.line}-${index}`}
              name={`${section.title} #${index + 1}`}
            >
              <BestPlayRowCard
                prop={prop}
                rank={index + 1}
                onOpen={onOpen}
                cacheStatus={cacheStatus}
                cardVariant={section.cardVariant || "default"}
              />
            </SectionErrorBoundary>
          ))}
        </div>
      ) : (
        <p className="compact-empty">{section.emptyMessage || NO_VERIFIED_PLAYS_MESSAGE}</p>
      )}
    </section>
  );
}

function BestPlaysTab({
  sections = [],
  overallPlay = null,
  loading = false,
  loadingStage = "",
  loadError = "",
  onOpen,
  filterDiagnostics = null,
  renderSourceAudit = null,
  cacheStatus = "",
  performanceTracker = null,
  showDebugPanels = false,
}) {
  const topBestPlaysSection = useMemo(() => findSection(sections, "top-10-best-plays"), [sections]);
  const safestSection = useMemo(() => findSection(sections, "top-5-safest"), [sections]);
  const valueUndersSection = useMemo(() => findSection(sections, "top-5-value-unders"), [sections]);
  const valueOversSection = useMemo(() => findSection(sections, "top-5-value-overs"), [sections]);

  const topBestPlays = useMemo(() => {
    return applyBestPlayRankConstraints(safeArray(topBestPlaysSection?.picks), { limit: 10 });
  }, [topBestPlaysSection]);

  const heroPlay = useMemo(() => overallPlay, [overallPlay]);

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
      {heroPlay ? (
        <SectionErrorBoundary name="Hero Card">
          <BestPlayHeroCard prop={heroPlay} onOpen={onOpen} cacheStatus={cacheStatus} />
        </SectionErrorBoundary>
      ) : null}

      {showDebugPanels && filterDiagnostics?.bestPlayFilterAudit ? (
        <p className="compact-form-notice">
          Tier pool A {filterDiagnostics.bestPlayFilterAudit.tierA ?? 0} · B{" "}
          {filterDiagnostics.bestPlayFilterAudit.tierB ?? 0} · C{" "}
          {filterDiagnostics.bestPlayFilterAudit.tierC ?? 0}
          {" · "}
          Shown A {filterDiagnostics.bestPlayFilterAudit.tierADisplayed ?? 0} · B{" "}
          {filterDiagnostics.bestPlayFilterAudit.tierBDisplayed ?? 0} · C{" "}
          {filterDiagnostics.bestPlayFilterAudit.tierCDisplayed ?? 0}
        </p>
      ) : null}

      {showDebugPanels ? <BestPlayFilterDiagnostics filterDiagnostics={filterDiagnostics} /> : null}
      {showDebugPanels ? <TierAuditPanel auditRows={filterDiagnostics?.tierAuditBatch} limit={12} /> : null}

      <BestPlaysSection
        section={{
          ...(topBestPlaysSection || { title: "Best Plays", picks: [] }),
          emptyMessage: topBestPlays.length ? "" : NO_VERIFIED_PLAYS_MESSAGE,
        }}
        onOpen={onOpen}
        cacheStatus={cacheStatus}
        sortFn={compareBestPlaysRank}
        limit={10}
      />

      <BestPlaysSection
        section={{
          ...(safestSection || { title: "Safest Plays", picks: [] }),
          emptyMessage: safestSection?.picks?.length ? "" : NO_VERIFIED_PLAYS_MESSAGE,
        }}
        onOpen={onOpen}
        cacheStatus={cacheStatus}
        limit={5}
      />
      <BestPlaysSection
        section={{
          ...(valueUndersSection || { title: "Value Unders", picks: [] }),
          emptyMessage: valueUndersSection?.picks?.length ? "" : NO_VERIFIED_PLAYS_MESSAGE,
        }}
        onOpen={onOpen}
        cacheStatus={cacheStatus}
        limit={5}
      />
      <BestPlaysSection
        section={{
          ...(valueOversSection || { title: "Value Overs", picks: [] }),
          emptyMessage: valueOversSection?.picks?.length ? "" : NO_VERIFIED_PLAYS_MESSAGE,
        }}
        onOpen={onOpen}
        cacheStatus={cacheStatus}
        limit={5}
      />

      <PerformanceTracker dashboard={performanceTracker} />
    </div>
  );
}

export default memo(BestPlaysTab);
