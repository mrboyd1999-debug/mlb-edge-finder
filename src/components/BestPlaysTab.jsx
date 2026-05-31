import { memo, useMemo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import BestPlayHeroCard from "./BestPlayHeroCard.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import PerformanceTracker from "./PerformanceTracker.jsx";
import BestPlayFilterDiagnostics from "./BestPlayFilterDiagnostics.jsx";
import { compareVerifiedPlaysRank, compareBestPlaysRank, applyBestPlayRankConstraints } from "../utils/bestPlayRankingScore.js";
import {
  VERIFIED_DISPLAY_MAX,
  NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE,
} from "../utils/verifiedTierSystem.js";
import { NO_LIVE_VERIFIED_PROPS_MESSAGE, shouldBlockVerifiedPlayRender } from "../utils/renderDataSourceAudit.js";
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
        <p className="compact-empty">{section.emptyMessage || NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE}</p>
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
}) {
  const topBestPlaysSection = useMemo(() => findSection(sections, "top-10-best-plays"), [sections]);
  const verifiedSection = useMemo(() => findSection(sections, "verified-plays"), [sections]);
  const safestSection = useMemo(() => findSection(sections, "top-5-safest"), [sections]);
  const highestEdgeSection = useMemo(() => findSection(sections, "top-5-highest-edge"), [sections]);
  const valueUndersSection = useMemo(() => findSection(sections, "top-5-value-unders"), [sections]);
  const valueOversSection = useMemo(() => findSection(sections, "top-5-value-overs"), [sections]);

  const topBestPlays = useMemo(() => {
    return applyBestPlayRankConstraints(safeArray(topBestPlaysSection?.picks), { limit: 10 });
  }, [topBestPlaysSection]);

  const verifiedPicks = useMemo(() => {
    return safeArray(verifiedSection?.picks)
      .sort(compareVerifiedPlaysRank)
      .slice(0, VERIFIED_DISPLAY_MAX);
  }, [verifiedSection]);

  const heroPlay = useMemo(() => overallPlay, [overallPlay]);
  const failureReason = loadError || filterDiagnostics?.error || "";
  const blockStaleRender = shouldBlockVerifiedPlayRender(renderSourceAudit);
  const liveProviderActive = Number(renderSourceAudit?.liveProviderCount ?? 0) > 0;
  const showIntegrityWarning =
    renderSourceAudit?.dataIntegrityMismatch &&
    renderSourceAudit?.integrityWarning &&
    !liveProviderActive;

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
      {showIntegrityWarning ? (
        <p className="compact-form-notice prop-pipeline-counters__failure" role="alert">
          {renderSourceAudit.integrityWarning}
        </p>
      ) : null}

      {blockStaleRender ? (
        <p className="compact-empty">{NO_LIVE_VERIFIED_PROPS_MESSAGE}</p>
      ) : (
        <>
          {failureReason && !verifiedPicks.length && !topBestPlays.length ? (
            <p className="compact-form-notice">{failureReason}</p>
          ) : null}

          {heroPlay ? (
            <SectionErrorBoundary name="Hero Card">
              <BestPlayHeroCard prop={heroPlay} onOpen={onOpen} cacheStatus={cacheStatus} />
            </SectionErrorBoundary>
          ) : null}

          <BestPlayFilterDiagnostics filterDiagnostics={filterDiagnostics} />

          <BestPlaysSection
            section={topBestPlaysSection}
            onOpen={onOpen}
            cacheStatus={cacheStatus}
            sortFn={compareBestPlaysRank}
            limit={10}
          />

          <BestPlaysSection section={safestSection} onOpen={onOpen} cacheStatus={cacheStatus} limit={5} />
          <BestPlaysSection section={valueUndersSection} onOpen={onOpen} cacheStatus={cacheStatus} limit={5} />
          <BestPlaysSection section={highestEdgeSection} onOpen={onOpen} cacheStatus={cacheStatus} limit={5} />
          <BestPlaysSection section={valueOversSection} onOpen={onOpen} cacheStatus={cacheStatus} limit={5} />

          <PerformanceTracker dashboard={performanceTracker} />

          <BestPlaysSection
            section={verifiedSection}
            onOpen={onOpen}
            cacheStatus={cacheStatus}
            sortFn={compareVerifiedPlaysRank}
            limit={VERIFIED_DISPLAY_MAX}
          />
        </>
      )}
    </div>
  );
}

export default memo(BestPlaysTab);
