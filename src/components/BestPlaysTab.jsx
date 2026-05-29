import { memo, useMemo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import PlayerImage from "./PlayerImage.jsx";
import PropPipelineCounters from "./PropPipelineCounters.jsx";
import VerificationDashboard from "./VerificationDashboard.jsx";
import { groupPicksByPlayer } from "../utils/playerPropGroups.js";
import { NO_TIER_A_PLAYS_MESSAGE } from "../utils/verifiedTierSystem.js";

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
  const { topVerifiedSection, verifiedSection, researchSection, probabilitySection, edgeSection } =
    useMemo(() => {
      return {
        topVerifiedSection: findSection(sections, "top-verified-plays"),
        verifiedSection: findSection(sections, "verified-plays"),
        researchSection: findSection(sections, "research-plays"),
        probabilitySection: findSection(sections, "highest-probability"),
        edgeSection: findSection(sections, "highest-edge"),
      };
    }, [sections]);

  const highestProbabilityPicks = probabilitySection?.picks || [];
  const topVerifiedPicks = topVerifiedSection?.picks || [];
  const verifiedGroups = groupPicksByPlayer(verifiedSection?.picks || []);
  const researchGroups = groupPicksByPlayer(researchSection?.picks || []);
  const edgeGroups = groupPicksByPlayer(edgeSection?.picks || []);
  const totalPicks =
    highestProbabilityPicks.length +
    topVerifiedPicks.length +
    verifiedGroups.reduce((sum, group) => sum + group.props.length, 0) +
    researchGroups.reduce((sum, group) => sum + group.props.length, 0) +
    edgeGroups.reduce((sum, group) => sum + group.props.length, 0);

  const projectedCount =
    filterDiagnostics?.verificationDashboard?.projected ??
    filterDiagnostics?.pipelineCounts?.displayPool ??
    filterDiagnostics?.pipelineCounts?.withProjections ??
    0;

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
      {failureReason && !totalPicks && projectedCount === 0 ? (
        <p className="compact-form-notice">{failureReason}</p>
      ) : null}

      {probabilitySection ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{probabilitySection?.title || "Highest Probability Pick"}</h2>
            <p>{probabilitySection?.eyebrow || "Top Tier A play by composite score"}</p>
          </div>
          {highestProbabilityPicks.length ? (
            renderRankedPlays(highestProbabilityPicks, onOpen)
          ) : (
            <p className="compact-empty">{probabilitySection?.emptyMessage || NO_TIER_A_PLAYS_MESSAGE}</p>
          )}
        </section>
      ) : null}

      {topVerifiedPicks.length ? (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>{topVerifiedSection?.title || "Top 5 Verified Plays"}</h2>
            <p>{topVerifiedSection?.eyebrow || "Sorted by top pick score descending"}</p>
          </div>
          {renderRankedPlays(topVerifiedPicks, onOpen)}
        </section>
      ) : null}

      <section className="compact-section">
        <div className="compact-section__head">
          <h2>{verifiedSection?.title || "Verified Plays"}</h2>
          <p>{verifiedSection?.eyebrow || "Tier A/B/C — sorted by top pick score descending"}</p>
        </div>
        {renderPlayerGroups(verifiedGroups, onOpen)}
      </section>

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

      {!totalPicks && projectedCount === 0 ? (
        <p className="compact-empty">Waiting for projected props to load.</p>
      ) : null}
    </div>
  );
}

export default memo(BestPlaysTab);
