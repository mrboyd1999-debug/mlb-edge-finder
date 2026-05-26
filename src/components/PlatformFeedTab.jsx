import { memo } from "react";
import CompactPropCard from "./CompactPropCard.jsx";

function PlatformFeedTab({ platformLabel = "Feed", picks = [], loading = false, onOpen, onSave }) {
  if (loading && !picks.length) {
    return <p className="compact-tab-empty">Loading {platformLabel} props…</p>;
  }
  if (!picks.length) {
    return <p className="compact-tab-empty">No live {platformLabel} MLB props right now. Refresh to reload.</p>;
  }

  return (
    <section className="compact-tab-panel platform-feed-tab">
      <p className="platform-feed-tab__meta">{picks.length} live {platformLabel} props</p>
      <div className="compact-prop-grid">
        {picks.map((prop, index) => (
          <CompactPropCard
            key={prop.id || `${prop.playerName}-${prop.statType}-${prop.line}-${index}`}
            prop={prop}
            rank={index + 1}
            onOpen={onOpen}
            onSave={onSave}
            qualifyReason={prop.projectionUnavailable ? "Live line — projection pending" : prop.qualificationReason || ""}
          />
        ))}
      </div>
    </section>
  );
}

export default memo(PlatformFeedTab);
