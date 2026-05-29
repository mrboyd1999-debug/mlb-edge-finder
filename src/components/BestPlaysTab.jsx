import { memo, useMemo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import PlayerImage from "./PlayerImage.jsx";
import PropPipelineCounters from "./PropPipelineCounters.jsx";
import VerificationDashboard from "./VerificationDashboard.jsx";
import { groupPicksByPlayer } from "../utils/playerPropGroups.js";
import { passesVerifiedBestPlaysFilter } from "../utils/bestPlaysPipelineDebug.js";
import { PICK_TIER_VERIFIED } from "../utils/conservativeProjection.js";

function BestPlaysTab({
  sections = [],
  loading = false,
  loadingStage = "",
  pipelineDiagnostics = null,
  loadError = "",
  onOpen,
  filterDiagnostics = null,
}) {
  const usedVerifiedFallback = Boolean(filterDiagnostics?.usedVerifiedFallback);

  const { playerGroups, debugBanner, sectionTitle, sectionSubtitle } = useMemo(() => {
    const section =
      (sections || []).find((row) => row.id === "highest-probability") ||
      (sections || []).find((row) => row.id === "best-plays") ||
      (sections || [])[0];
    const sectionPicks = section?.picks || [];
    const counts = filterDiagnostics?.pipelineCounts;
    const invalidReasons = filterDiagnostics?.invalidReasons;

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
          ? `Pipeline: ${counts.rawProps ?? 0} raw · ${counts.normalized ?? 0} normalized · ${counts.withProjections ?? 0} with projections · ${counts.filtered ?? 0} verified · ${sectionPicks.length} shown`
          : null,
        reasonText ? `Rejected: ${reasonText}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    }

    const displayPicks = usedVerifiedFallback
      ? sectionPicks
      : sectionPicks.filter(
          (prop) =>
            passesVerifiedBestPlaysFilter(prop) &&
            prop.pickTierLabel === PICK_TIER_VERIFIED &&
            !prop.displayResearchOnly
        );

    return {
      playerGroups: groupPicksByPlayer(displayPicks),
      debugBanner: banner,
      sectionTitle: section?.title || (usedVerifiedFallback ? "Top Projected Props" : "Verified Plays"),
      sectionSubtitle:
        section?.eyebrow ||
        (usedVerifiedFallback
          ? "Verified pool empty — showing top projected props by confidence and edge"
          : "Verified Play tier only. Research candidates are on the MLB Props tab."),
    };
  }, [sections, filterDiagnostics, usedVerifiedFallback]);

  const failureReason =
    pipelineDiagnostics?.failureReason || loadError || filterDiagnostics?.error || "";

  if (loading) {
    return (
      <div className="compact-tab-panel">
        <p className="compact-empty">
          Loading MLB projection candidates…{loadingStage ? ` (${loadingStage})` : ""}
        </p>
        {failureReason ? <p className="compact-form-notice">{failureReason}</p> : null}
        <PropPipelineCounters counts={pipelineDiagnostics} compact />
        <VerificationDashboard dashboard={filterDiagnostics?.verificationDashboard} />
      </div>
    );
  }

  const totalPicks = playerGroups.reduce((sum, group) => sum + group.props.length, 0);

  return (
    <div className="compact-tab-panel">
      <PropPipelineCounters counts={pipelineDiagnostics} compact />
      <VerificationDashboard dashboard={filterDiagnostics?.verificationDashboard} />
      {debugBanner ? (
        <p className="compact-form-notice" style={{ marginBottom: 12 }}>
          {debugBanner}
        </p>
      ) : null}
      {failureReason && !totalPicks ? <p className="compact-form-notice">{failureReason}</p> : null}
      {!totalPicks ? (
        <p className="compact-empty">No verified plays yet. Check MLB Props for research candidates.</p>
      ) : (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{sectionTitle}</h2>
            <p>{sectionSubtitle}</p>
          </div>
          <div className="compact-card-list player-prop-group-list">
            {playerGroups.map((group) => (
              <div key={group.playerName} className="player-prop-group">
                <header className="player-prop-group__head">
                  <PlayerImage prop={group.props[0]} />
                  <div>
                    <h3 className="player-prop-group__name">{group.playerName}</h3>
                    <p className="player-prop-group__count">
                      {group.props.length} prop{group.props.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </header>
                <ul className="player-prop-group__props">
                  {group.props.map((prop, index) => (
                    <li key={prop.id || `${group.playerName}-${index}`}>
                      <BestPlayRowCard prop={prop} onOpen={onOpen} grouped />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default memo(BestPlaysTab);
