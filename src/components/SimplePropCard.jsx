import { memo } from "react";
import { formatNumber } from "../utils/formatters.js";
import { displayMarketLabel } from "../utils/propLabels.js";
import { normalizePropForCard } from "../utils/normalizePropForCard.js";
import { formatRecommendationLabel, recommendationPalette, resolvePickSide } from "../utils/pickRecommendation.js";

/** Minimal guaranteed-visible prop card — no lazy loading or qualification gating. */
function SimplePropCard({ prop, className = "accepted-prop-card", onOpen, index = 0 }) {
  if (!prop) return null;

  const card = prop.player && prop.market ? prop : normalizePropForCard(prop, index);
  const line = card.line != null && card.line !== "—" ? formatNumber(card.line) : "—";
  const side = resolvePickSide(prop._raw || prop);
  const palette = recommendationPalette(side);
  const market = displayMarketLabel(prop._raw || prop) || card.market;
  const conf = Math.round(Number(prop.confidenceScore ?? prop.confidence ?? card.confidence ?? 50));

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
      style={{
        padding: "10px 12px",
        borderRadius: "8px",
        border: "1px solid #334155",
        background: "#0f172a",
      }}
    >
      <div className="prop-card-player" style={{ fontWeight: 800, fontSize: "16px" }}>{card.player || prop.playerName || prop.player}</div>
      <div
        className="prop-card-recommendation"
        style={{
          margin: "8px 0",
          padding: "6px 10px",
          borderRadius: "6px",
          border: `2px solid ${palette.border}`,
          background: palette.bannerBg,
          color: palette.bannerText,
          fontWeight: 900,
          textAlign: "center",
        }}
      >
        {formatRecommendationLabel(side)}
      </div>
      <div className="prop-card-market">Prop: {market}</div>
      <div className="prop-card-line">Line: {line}</div>
      <div className="prop-card-confidence">Confidence: {conf}%</div>
      {card.source ? <div className="prop-card-source">Source: {card.source}</div> : null}
    </div>
  );
}

export default memo(SimplePropCard);
