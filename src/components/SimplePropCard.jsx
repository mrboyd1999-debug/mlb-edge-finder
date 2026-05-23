import { memo } from "react";
import { formatNumber } from "../utils/formatters.js";
import { normalizePropForCard } from "../utils/normalizePropForCard.js";

/** Minimal guaranteed-visible prop card — no lazy loading or qualification gating. */
function SimplePropCard({ prop, className = "accepted-prop-card", onOpen, index = 0 }) {
  if (!prop) return null;

  const card = prop.player && prop.market ? prop : normalizePropForCard(prop, index);
  const line = card.line != null && card.line !== "—" ? formatNumber(card.line) : "—";

  return (
    <div
      className={className}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(card._raw || prop) : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(card._raw || prop);
              }
            }
          : undefined
      }
    >
      <div className="prop-card-player">{card.player}</div>
      <div className="prop-card-market">{card.market}</div>
      <div className="prop-card-pick">{card.pick}</div>
      <div className="prop-card-line">Line: {line}</div>
      <div className="prop-card-confidence">Confidence: {Math.round(card.confidence)}%</div>
      {Number.isFinite(card.edge) ? <div className="prop-card-edge">Edge: +{formatNumber(card.edge)}</div> : null}
      {card.source ? <div className="prop-card-source">Source: {card.source}</div> : null}
    </div>
  );
}

export default memo(SimplePropCard);
