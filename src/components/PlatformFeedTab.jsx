import { memo } from "react";
import CompactPropCard from "./CompactPropCard.jsx";
import { isPropSaved } from "../utils/savedPicksStorage.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";

function PlatformFeedTab({
  platformLabel = "Feed",
  picks = [],
  loading = false,
  onOpen,
  onSave,
  cacheStatus = "",
  savedPicks = [],
}) {
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
            prop={withPlayerImageUrl(prop)}
            rank={index + 1}
            onOpen={onOpen}
            onSave={onSave}
            isSaved={isPropSaved(prop, savedPicks)}
            cacheStatus={cacheStatus}
            qualifyReason={prop.projectionUnavailable ? "Live line — projection pending" : prop.cardDescription || prop.qualificationReason || ""}
          />
        ))}
      </div>
    </section>
  );
}

export default memo(PlatformFeedTab);
