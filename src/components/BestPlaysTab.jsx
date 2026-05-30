import { memo, useMemo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import BestPlayHeroCard from "./BestPlayHeroCard.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import { compareVerifiedPlaysRank, passesHeroOverallPlayGate } from "../utils/bestPlayRankingScore.js";
import {
  VERIFIED_DISPLAY_MAX,
  NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE,
} from "../utils/verifiedTierSystem.js";
import { safeArray } from "../utils/safeStats.js";

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
}) {
  const verifiedSection = useMemo(() => findSection(sections, "verified-plays"), [sections]);

  const verifiedPicks = useMemo(() => {
    return safeArray(verifiedSection?.picks)
      .sort(compareVerifiedPlaysRank)
      .slice(0, VERIFIED_DISPLAY_MAX);
  }, [verifiedSection]);

  const heroPlay = useMemo(() => {
    return verifiedPicks.find(passesHeroOverallPlayGate) || null;
  }, [verifiedPicks]);
  const failureReason = loadError || filterDiagnostics?.error || "";

  if (loading) {
    return (
      <div className="compact-tab-panel">
        <p className="compact-empty">
          Loading MLB verified plays…{loadingStage ? ` (${loadingStage})` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="compact-tab-panel">
      {failureReason && !verifiedPicks.length ? (
        <p className="compact-form-notice">{failureReason}</p>
      ) : null}

      {heroPlay ? (
        <SectionErrorBoundary name="Hero Card">
          <BestPlayHeroCard prop={heroPlay} onOpen={onOpen} />
        </SectionErrorBoundary>
      ) : null}

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
    </div>
  );
}

export default memo(BestPlaysTab);
