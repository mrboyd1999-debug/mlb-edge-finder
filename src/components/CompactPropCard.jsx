import { memo, useState } from "react";
import { formatNumber, formatSignedNumber } from "../utils/formatters.js";
import { displayMarketLabel } from "../utils/propLabels.js";
import { formatRecommendationLabel, recommendationPalette, resolvePickSide } from "../utils/pickRecommendation.js";

function riskPalette(level = "") {
  const key = String(level || "").toLowerCase();
  if (key === "low") return { bg: "#14532d", color: "#bbf7d0", border: "#22c55e" };
  if (key === "high") return { bg: "#450a0a", color: "#fecaca", border: "#ef4444" };
  return { bg: "#422006", color: "#fde68a", border: "#ca8a04" };
}

function payoutMeta(prop = {}) {
  if (prop.isGoblinPick || prop.payoutRole === "goblin" || prop.oddsType === "goblin") {
    return { label: "Goblin", sub: "Lower payout · safer line", tone: "goblin" };
  }
  if (prop.isDemonPick || prop.payoutRole === "demon" || prop.oddsType === "demon") {
    return { label: "Demon", sub: "Higher payout · harder line", tone: "demon" };
  }
  return null;
}

function CompactPropCard({
  prop,
  onOpen,
  onSave,
  onDelete,
  rank,
  defaultExpanded = false,
  showSave = true,
  qualifyReason = "",
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!prop) return null;

  const side = resolvePickSide(prop);
  const sidePalette = recommendationPalette(side);
  const sideLabel = side === "WATCH" ? "PASS" : formatRecommendationLabel(side);
  const market = displayMarketLabel(prop) || prop.statType || prop.market || "Prop";
  const line = Number.isFinite(Number(prop.line)) ? formatNumber(prop.line) : "—";
  const projection = Number.isFinite(Number(prop.projection ?? prop.projectedValue))
    ? formatNumber(prop.projection ?? prop.projectedValue)
    : "—";
  const edge = Number(prop.edge);
  const edgeLabel = Number.isFinite(edge) ? formatSignedNumber(edge) : "—";
  const conf = Number(prop.confidenceScore ?? prop.confidence);
  const confLabel = Number.isFinite(conf) ? `${Math.round(conf)}%` : "—";
  const risk = prop.riskLevel || "Medium";
  const riskStyle = riskPalette(risk);
  const payout = payoutMeta(prop);
  const explanation =
    qualifyReason ||
    prop.whyThisPick ||
    prop.qualificationReason ||
    prop.analyticsReason ||
    prop.statusMessage ||
    "";
  const fallbackNote = prop.projectionUnavailable
    ? "Projection unavailable"
    : prop.isFallbackProjection || prop.projectionSource === "manual-fallback"
      ? prop.projectionLabel || "Projection unavailable — using manual fallback formula"
      : null;

  function toggle(event) {
    event?.stopPropagation?.();
    setExpanded((open) => !open);
  }

  function openDetail(event) {
    event?.stopPropagation?.();
    onOpen?.(prop);
  }

  return (
    <article
      className={`compact-prop-card${payout ? ` compact-prop-card--${payout.tone}` : ""}`}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle(event);
        }
      }}
    >
      <div className="compact-prop-card__head">
        <div className="compact-prop-card__title-row">
          {rank != null ? <span className="compact-prop-card__rank">#{rank}</span> : null}
          <strong className="compact-prop-card__player">{prop.playerName || prop.player}</strong>
          {payout ? <span className={`compact-prop-card__payout compact-prop-card__payout--${payout.tone}`}>{payout.label}</span> : null}
        </div>
        <p className="compact-prop-card__market">{market} · Line {line}</p>
      </div>

      <div className="compact-prop-card__metrics">
        <span
          className="compact-prop-card__side"
          style={{
            borderColor: sidePalette.border,
            background: sidePalette.bannerBg,
            color: sidePalette.bannerText,
          }}
        >
          {sideLabel}
        </span>
        <span className="compact-prop-card__metric">
          <small>Conf</small>
          {confLabel}
        </span>
        <span className="compact-prop-card__metric">
          <small>Edge</small>
          {edgeLabel}
        </span>
      </div>

      {expanded ? (
        <div className="compact-prop-card__body" onClick={(event) => event.stopPropagation()}>
          {fallbackNote ? <p className="compact-prop-card__fallback">{fallbackNote}</p> : null}
          {payout ? <p className="compact-prop-card__qualify">{payout.sub}</p> : null}
          <div className="compact-prop-card__grid">
            <span>Projection</span>
            <strong>{projection}</strong>
            <span>Risk</span>
            <strong
              style={{
                display: "inline-block",
                padding: "1px 6px",
                borderRadius: 4,
                border: `1px solid ${riskStyle.border}`,
                background: riskStyle.bg,
                color: riskStyle.color,
                fontSize: 11,
              }}
            >
              {risk}
            </strong>
          </div>
          {explanation ? <p className="compact-prop-card__explain">{explanation}</p> : null}
          <div className="compact-prop-card__actions">
            {onOpen ? (
              <button type="button" className="compact-prop-card__btn" onClick={openDetail}>
                Full detail
              </button>
            ) : null}
            {showSave && onSave ? (
              <button type="button" className="compact-prop-card__btn compact-prop-card__btn--primary" onClick={() => onSave(prop)}>
                Save Pick
              </button>
            ) : null}
            {onDelete ? (
              <button type="button" className="compact-prop-card__btn compact-prop-card__btn--danger" onClick={() => onDelete(prop)}>
                Delete
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="compact-prop-card__hint">Tap for projection & explanation</p>
      )}
    </article>
  );
}

export default memo(CompactPropCard);
