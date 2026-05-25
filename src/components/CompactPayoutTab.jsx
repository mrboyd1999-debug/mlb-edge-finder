import { memo } from "react";
import CompactPropCard from "./CompactPropCard.jsx";

function CompactPayoutTab({
  role = "goblin",
  picks = [],
  loading = false,
  onOpen,
  onSave,
  emptyMessage = "No picks available.",
}) {
  const isGoblin = role === "goblin";
  const title = isGoblin ? "Goblin Picks" : "Demon Picks";
  const subtitle = isGoblin
    ? "Lower payout · safer lines — confidence reflects the easier line, not the demon line."
    : "Higher payout · harder lines — confidence reflects the tougher line separately from goblin.";

  if (loading) {
    return <p className="compact-empty">Loading {title.toLowerCase()}…</p>;
  }

  if (!picks.length) {
    return <p className="compact-empty">{emptyMessage}</p>;
  }

  return (
    <div className="compact-tab-panel">
      <section className="compact-section">
        <div className="compact-section__head">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="compact-card-list">
          {picks.slice(0, 6).map((prop, index) => (
            <CompactPropCard
              key={prop.id || `${role}-${index}`}
              prop={prop}
              rank={index + 1}
              onOpen={onOpen}
              onSave={onSave}
              qualifyReason={
                prop.analyticsReason ||
                prop.whyThisPick ||
                (isGoblin
                  ? "Safer goblin line with lower variance profile."
                  : "Harder demon line with higher payout potential.")
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export default memo(CompactPayoutTab);
