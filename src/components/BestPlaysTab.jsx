import { memo, useMemo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import BestPlayHeroCard from "./BestPlayHeroCard.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import { compareVerifiedPlaysRank, compareBestPlaysRank, passesHeroOverallPlayGate } from "../utils/bestPlayRankingScore.js";
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

function BestPlaysTab({
  sections = [],
  loading = false,
  loadingStage = "",
  loadError = "",
  onOpen,
  filterDiagnostics = null,
  renderSourceAudit = null,
  cacheStatus = "",
}) {
  const topBestPlaysSection = useMemo(() => findSection(sections, "top-10-best-plays"), [sections]);
  const verifiedSection = useMemo(() => findSection(sections, "verified-plays"), [sections]);

  const topBestPlays = useMemo(() => {
    return safeArray(topBestPlaysSection?.picks).sort(compareBestPlaysRank).slice(0, 10);
  }, [topBestPlaysSection]);

  const verifiedPicks = useMemo(() => {
    return safeArray(verifiedSection?.picks)
      .sort(compareVerifiedPlaysRank)
      .slice(0, VERIFIED_DISPLAY_MAX);
  }, [verifiedSection]);

  const heroPlay = useMemo(() => {
    return topBestPlays.find(passesHeroOverallPlayGate) || verifiedPicks.find(passesHeroOverallPlayGate) || null;
  }, [topBestPlays, verifiedPicks]);
  const failureReason = loadError || filterDiagnostics?.error || "";
  const blockStaleRender = shouldBlockVerifiedPlayRender(renderSourceAudit);

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
      {renderSourceAudit?.dataIntegrityMismatch && renderSourceAudit?.integrityWarning ? (
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

      <section className="compact-section">
        <div className="compact-section__head">
          <h2>{topBestPlaysSection?.title || "Top 10 Best Plays"}</h2>
          <p>
            {topBestPlaysSection?.eyebrow ||
              "Top 10 sorted by probability, confidence, then projection edge"}
          </p>
        </div>
        {topBestPlays.length ? (
          <div className="compact-card-list">
            {topBestPlays.map((prop, index) => (
              <SectionErrorBoundary
                key={prop?.id || `${prop?.playerName}-${prop?.statType}-${prop?.line}-${index}`}
                name={`Best Play #${index + 1}`}
              >
                <BestPlayRowCard
                  prop={prop}
                  rank={index + 1}
                  onOpen={onOpen}
                  cacheStatus={cacheStatus}
                />
              </SectionErrorBoundary>
            ))}
          </div>
        ) : (
          <p className="compact-empty">
            {topBestPlaysSection?.emptyMessage || NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE}
          </p>
        )}
      </section>

      <section className="compact-section">
        <div className="compact-section__head">
          <h2>{verifiedSection?.title || "Top Verified Plays"}</h2>
          <p>
            {verifiedSection?.eyebrow ||
              `Top ${VERIFIED_DISPLAY_MAX} sorted by playability, confidence, probability, then edge`}
          </p>
        </div>
        {verifiedPicks.length ? (
          <div className="compact-card-list">
            {verifiedPicks.map((prop, index) => (
              <SectionErrorBoundary
                key={prop?.id || `${prop?.playerName}-${prop?.statType}-${prop?.line}-${index}`}
                name={`Verified Play #${index + 1}`}
              >
                <BestPlayRowCard
                  prop={prop}
                  rank={index + 1}
                  onOpen={onOpen}
                  cacheStatus={cacheStatus}
                />
              </SectionErrorBoundary>
            ))}
          </div>
        ) : (
          <p className="compact-empty">
            {verifiedSection?.emptyMessage || NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE}
          </p>
        )}
      </section>
        </>
      )}
    </div>
  );
}

export default memo(BestPlaysTab);
