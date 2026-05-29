import { memo, useMemo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import PlayerImage from "./PlayerImage.jsx";
import PropPipelineCounters from "./PropPipelineCounters.jsx";
import VerificationDashboard from "./VerificationDashboard.jsx";
import { groupPicksByPlayer } from "../utils/playerPropGroups.js";

function renderPlayerGroups(groups = [], onOpen) {
  if (!groups.length) return null;
  return (
    <div className="compact-card-list player-prop-group-list">
      {groups.map((group) => (
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
  );
}

function BestPlaysTab({
  sections = [],
  loading = false,
  loadingStage = "",
  pipelineDiagnostics = null,
  loadError = "",
  onOpen,
  filterDiagnostics = null,
}) {
  const { verifiedSection, researchSection, fallbackSection, debugBanner } = useMemo(() => {
    const verified =
      (sections || []).find((row) => row.id === "verified-plays") ||
      (sections || []).find((row) => row.id === "highest-probability");
    const research = (sections || []).find((row) => row.id === "research-plays");
    const fallback = (sections || []).find((row) => row.id === "highest-probability");
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
          ? `Pipeline: ${counts.rawProps ?? 0} raw · ${counts.normalized ?? 0} normalized · ${counts.withProjections ?? 0} with projections · ${counts.filtered ?? 0} verified · ${counts.researchPool ?? 0} research`
          : null,
        reasonText ? `Rejected: ${reasonText}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    }

    return {
      verifiedSection: verified,
      researchSection: research,
      fallbackSection: fallback,
      debugBanner: banner,
    };
  }, [sections, filterDiagnostics]);

  const verifiedGroups = groupPicksByPlayer(verifiedSection?.picks || []);
  const researchGroups = groupPicksByPlayer(researchSection?.picks || []);
  const fallbackGroups = groupPicksByPlayer(fallbackSection?.picks || []);
  const totalPicks =
    verifiedGroups.reduce((sum, group) => sum + group.props.length, 0) +
    researchGroups.reduce((sum, group) => sum + group.props.length, 0) +
    fallbackGroups.reduce((sum, group) => sum + group.props.length, 0);

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

      {verifiedGroups.length ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{verifiedSection?.title || "Verified Plays"}</h2>
            <p>{verifiedSection?.eyebrow || "High-confidence props with complete matchup context"}</p>
          </div>
          {renderPlayerGroups(verifiedGroups, onOpen)}
        </section>
      ) : null}

      {researchGroups.length ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{researchSection?.title || "Research Plays"}</h2>
            <p>
              {researchSection?.eyebrow ||
                "Quality projections with low matchup confidence — probability ≥ 58%, confidence ≥ 55"}
            </p>
          </div>
          {renderPlayerGroups(researchGroups, onOpen)}
        </section>
      ) : null}

      {!verifiedGroups.length && !researchGroups.length && fallbackGroups.length ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{fallbackSection?.title || "Top Projected Props"}</h2>
            <p>{fallbackSection?.eyebrow || "Weighted top plays by probability, edge, and confidence"}</p>
          </div>
          {renderPlayerGroups(fallbackGroups, onOpen)}
        </section>
      ) : null}

      {!totalPicks ? (
        <p className="compact-empty">No verified plays yet. Check MLB Props for research candidates.</p>
      ) : null}
    </div>
  );
}

export default memo(BestPlaysTab);
