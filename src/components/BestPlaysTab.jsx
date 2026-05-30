import { memo, useMemo } from "react";
import BestPlayHeroCard from "./BestPlayHeroCard.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import { compareTopPickScore } from "../utils/bestPlayRankingScore.js";
import { VERIFIED_DISPLAY_MAX } from "../utils/verifiedTierSystem.js";

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
    return [...(verifiedSection?.picks || [])]
      .sort(compareTopPickScore)
      .slice(0, VERIFIED_DISPLAY_MAX);
  }, [verifiedSection]);

  const heroPlay = verifiedPicks[0] || null;
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

      {heroPlay ? <BestPlayHeroCard prop={heroPlay} onOpen={onOpen} /> : null}

      <section className="compact-section">
        <div className="compact-section__head">
          <h2>{verifiedSection?.title || "Top Verified Plays"}</h2>
          <p>
            {verifiedSection?.eyebrow ||
              `Top ${VERIFIED_DISPLAY_MAX} by probability, confidence, playability, and edge`}
          </p>
        </div>
        {verifiedPicks.length ? (
          <div className="compact-card-list">
            {verifiedPicks.map((prop, index) => (
              <BestPlayRowCard
                key={prop.id || `${prop.playerName}-${prop.statType}-${prop.line}-${index}`}
                prop={prop}
                rank={index + 1}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : (
          <p className="compact-empty">No verified plays passed thresholds.</p>
        )}
      </section>
    </div>
  );
}

export default memo(BestPlaysTab);
