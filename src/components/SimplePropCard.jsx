import { memo } from "react";
import { formatNumber } from "../utils/formatters.js";

/** Minimal guaranteed-visible prop card — no lazy loading or qualification gating. */
function SimplePropCard({ prop, className = "accepted-prop-card", onOpen }) {
  if (!prop) return null;

  const player = prop.playerName || prop.player || "Unknown player";
  const market = prop.market || prop.statType || prop.propType || "—";
  const pick = prop.pick || prop.bestPick || prop.pickDirection || prop.side || "—";
  const line = prop.line != null ? formatNumber(prop.line) : "—";
  const confidence = Math.round(Number(prop.confidenceScore ?? prop.confidence ?? 0));

  return (
    <div
      className={className}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(prop) : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(prop);
              }
            }
          : undefined
      }
    >
      <div className="prop-card-player">{player}</div>
      <div className="prop-card-market">{market}</div>
      <div className="prop-card-pick">{pick}</div>
      <div className="prop-card-line">Line: {line}</div>
      <div className="prop-card-confidence">Confidence: {confidence}%</div>
    </div>
  );
}

export default memo(SimplePropCard);
