import { memo, useMemo } from "react";
import BestPlayRowCard from "./BestPlayRowCard.jsx";
import PlayerImage from "./PlayerImage.jsx";
import { groupPicksByPlayer } from "../utils/playerPropGroups.js";
import { passesVerifiedBestPlaysFilter } from "../utils/bestPlaysPipelineDebug.js";
import { PICK_TIER_VERIFIED } from "../utils/conservativeProjection.js";

function BestPlaysTab({ sections = [], loading = false, onOpen, filterDiagnostics = null }) {
  const { playerGroups, debugBanner } = useMemo(() => {
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

    const verifiedPicks = sectionPicks.filter(
      (prop) =>
        passesVerifiedBestPlaysFilter(prop) &&
        prop.pickTierLabel === PICK_TIER_VERIFIED &&
        !prop.displayResearchOnly
    );
    return { playerGroups: groupPicksByPlayer(verifiedPicks), debugBanner: banner };
  }, [sections, filterDiagnostics]);

  if (loading) {
    return <p className="compact-empty">Loading MLB projection candidates…</p>;
  }

  const totalPicks = playerGroups.reduce((sum, group) => sum + group.props.length, 0);

  return (
    <div className="compact-tab-panel">
      {debugBanner ? (
        <p className="compact-form-notice" style={{ marginBottom: 12 }}>
          {debugBanner}
        </p>
      ) : null}
      {!totalPicks ? (
        <p className="compact-empty">No verified plays yet. Check MLB Props for research candidates.</p>
      ) : (
        <section className="compact-section">
          <div className="compact-section__head">
            <h2>Verified Plays</h2>
            <p>Verified Play tier only. Research candidates are on the MLB Props tab.</p>
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
