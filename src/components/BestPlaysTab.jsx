import { memo, useMemo } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import { EMERGENCY_FALLBACK_NOTICE } from "../utils/emergencyMlbBoard.js";
import { safeArray } from "../utils/safeStats.js";
import { liveBoardLoadingMessage } from "../utils/liveBoardLoading.js";

const MAIN_SECTION_IDS = ["top-10-best-plays", "top-goblins", "top-demons", "four-man-builder"];

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
  boardStatusNotice = "",
}) {
  const mainSections = useMemo(
    () =>
      MAIN_SECTION_IDS.map((id) => findSection(sections, id)).filter(Boolean),
    [sections]
  );

  const fallbackNotice =
    boardStatusNotice ||
    mainSections.find((section) => section.fallbackNotice)?.fallbackNotice ||
    (filterDiagnostics?.verifiedCount === 0 && filterDiagnostics?.poolCount > 0
      ? EMERGENCY_FALLBACK_NOTICE
      : "");

  if (loading) {
    return (
      <div className="compact-tab-panel">
        <p className="compact-empty">
          Loading MLB plays…
          {loadingStage ? ` (${liveBoardLoadingMessage(loadingStage)})` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="compact-tab-panel">
      {loadError ? <p className="compact-form-notice">{loadError}</p> : null}
      {fallbackNotice ? <p className="compact-form-notice">{fallbackNotice}</p> : null}

      {mainSections.map((section) => {
        const picks = safeArray(section.picks);
        return (
          <section className="compact-section" key={section.id}>
            <div className="compact-section__head">
              <h2>{section.title}</h2>
              {section.eyebrow ? <p className="compact-section__eyebrow">{section.eyebrow}</p> : null}
            </div>
            {picks.length ? (
              <div className="compact-card-list">
                {picks.map((prop, index) => (
                  <SectionErrorBoundary
                    key={prop?.id || `${section.id}-${prop?.playerName}-${prop?.statType}-${prop?.line}-${index}`}
                    name={`${section.title} #${index + 1}`}
                  >
                    <BestPlayRowCard
                      prop={prop}
                      rank={prop.topMlbPlayRank ?? index + 1}
                      rankLabel={prop.bestPlayRankLabel || prop.emergencyTierLabel}
                      compact={section.id !== "top-10-best-plays"}
                      onOpen={onOpen}
                    />
                  </SectionErrorBoundary>
                ))}
              </div>
            ) : (
              <p className="compact-empty">{section.emptyMessage || "No plays in this section."}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default memo(BestPlaysTab);
