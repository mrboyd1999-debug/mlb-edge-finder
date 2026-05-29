import { memo, useMemo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import PlayerImage from "./PlayerImage.jsx";
import PropPipelineCounters from "./PropPipelineCounters.jsx";
import VerificationDashboard from "./VerificationDashboard.jsx";
import { groupPicksByPlayer } from "../utils/playerPropGroups.js";

function renderRankedPlays(picks = [], onOpen) {
  if (!picks.length) return null;
  return (
    <div className="compact-card-list">
      {picks.map((prop, index) => (
        <BestPlayRowCard
          key={prop.id || `${prop.playerName}-${prop.statType}-${prop.line}-${index}`}
          prop={prop}
          rank={prop.topVerifiedRank ?? index + 1}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

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

function findSection(sections, id) {
  return (sections || []).find((row) => row.id === id) || null;
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
  const { topVerifiedSection, verifiedSection, researchSection, probabilitySection, edgeSection, debugBanner } =
    useMemo(() => {
      const topVerified = findSection(sections, "top-verified-plays");
      const verified = findSection(sections, "verified-plays");
      const research = findSection(sections, "research-plays");
      const probability = findSection(sections, "highest-probability");
      const edge = findSection(sections, "highest-edge");
      const counts = filterDiagnostics?.pipelineCounts;
      const invalidReasons = filterDiagnostics?.invalidReasons;
      const audit = filterDiagnostics?.verificationAudit;

      let banner = null;
      if (counts || invalidReasons || audit) {
        const reasonText = invalidReasons
          ? Object.entries(invalidReasons)
              .slice(0, 6)
              .map(([reason, count]) => `${reason}: ${count}`)
              .join(" · ")
          : "";
        const auditText = audit
          ? Object.entries(audit)
              .filter(([, count]) => Number(count) > 0)
              .map(([key, count]) => `${key}: ${count}`)
              .join(" · ")
          : "";
        banner = [
          counts
            ? `Pipeline: ${counts.rawProps ?? 0} raw · ${counts.normalized ?? 0} normalized · ${counts.withProjections ?? 0} projected · ${counts.filtered ?? 0} verified · ${counts.researchPool ?? 0} research`
            : null,
          auditText ? `Audit: ${auditText}` : null,
          reasonText ? `Rejected: ${reasonText}` : null,
        ]
          .filter(Boolean)
          .join(" | ");
      }

      return {
        topVerifiedSection: topVerified,
        verifiedSection: verified,
        researchSection: research,
        probabilitySection: probability,
        edgeSection: edge,
        debugBanner: banner,
      };
    }, [sections, filterDiagnostics]);

  const topVerifiedPicks = topVerifiedSection?.picks || [];
  const verifiedGroups = groupPicksByPlayer(verifiedSection?.picks || []);
  const researchGroups = groupPicksByPlayer(researchSection?.picks || []);
  const probabilityGroups = groupPicksByPlayer(probabilitySection?.picks || []);
  const edgeGroups = groupPicksByPlayer(edgeSection?.picks || []);
  const totalPicks =
    topVerifiedPicks.length +
    verifiedGroups.reduce((sum, group) => sum + group.props.length, 0) +
    researchGroups.reduce((sum, group) => sum + group.props.length, 0) +
    probabilityGroups.reduce((sum, group) => sum + group.props.length, 0) +
    edgeGroups.reduce((sum, group) => sum + group.props.length, 0);

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

      {topVerifiedPicks.length ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{topVerifiedSection?.title || "Top 5 Verified Plays"}</h2>
            <p>{topVerifiedSection?.eyebrow || "Ranked by probability, confidence, and edge"}</p>
          </div>
          {renderRankedPlays(topVerifiedPicks, onOpen)}
        </section>
      ) : null}

      <section className="compact-section">
        <div className="compact-section__head">
          <h2>{verifiedSection?.title || "Verified Plays"}</h2>
          <p>{verifiedSection?.eyebrow || "Tier A/B/C — sorted by ranking score"}</p>
        </div>
        {renderPlayerGroups(verifiedGroups, onOpen)}
      </section>

      {probabilityGroups.length ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{probabilitySection?.title || "Top 5 Highest Probability"}</h2>
            <p>{probabilitySection?.eyebrow || "Best projected probability from today's prop pool"}</p>
          </div>
          {renderPlayerGroups(probabilityGroups, onOpen)}
        </section>
      ) : null}

      {edgeGroups.length ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{edgeSection?.title || "Top 5 Highest Edge"}</h2>
            <p>{edgeSection?.eyebrow || "Largest projection vs line separation"}</p>
          </div>
          {renderPlayerGroups(edgeGroups, onOpen)}
        </section>
      ) : null}

      {researchGroups.length ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{researchSection?.title || "Research Plays"}</h2>
            <p>
              {researchSection?.eyebrow ||
                "Missing matchup or incomplete supporting data — review before betting"}
            </p>
          </div>
          {renderPlayerGroups(researchGroups, onOpen)}
        </section>
      ) : null}

      {!totalPicks ? (
        <p className="compact-empty">Waiting for projected props to load.</p>
      ) : null}
    </div>
  );
}

export default memo(BestPlaysTab);
