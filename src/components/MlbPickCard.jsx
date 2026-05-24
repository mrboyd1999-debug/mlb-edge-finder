import { memo } from "react";
import { styles } from "../theme/styles.js";
import { displayMarketLabel } from "../utils/propLabels.js";
import { formatNumber, shortReason } from "../utils/formatters.js";
import {
  formatRecommendationLabel,
  formatRiskShort,
  normalizeSourceLabel,
  recommendationPalette,
  resolvePickSide,
} from "../utils/pickRecommendation.js";
import { isSafeModeEnabled } from "../utils/safeMode.js";
import SimplePropCard from "./SimplePropCard.jsx";

function RecommendationBanner({ side, streakAction = false }) {
  const palette = recommendationPalette(side);
  const label = formatRecommendationLabel(side, { streak: streakAction });
  return (
    <div
      className="mlb-pick-recommendation"
      style={{
        padding: "8px 12px",
        borderRadius: "8px",
        border: `2px solid ${palette.border}`,
        background: palette.bannerBg,
        color: palette.bannerText,
        fontWeight: 900,
        fontSize: streakAction ? "15px" : "14px",
        letterSpacing: "0.06em",
        textAlign: "center",
        lineHeight: 1.2,
      }}
      aria-label={`Recommendation: ${label}`}
    >
      {streakAction ? label : `RECOMMENDATION: ${label}`}
    </div>
  );
}

function MetaLine({ label, value, strong = false }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <p style={{ margin: "2px 0", fontSize: "13px", color: "#cbd5e1", lineHeight: 1.35 }}>
      <span style={{ color: "#64748b", fontWeight: 700, fontSize: "11px", textTransform: "uppercase" }}>
        {label}:{" "}
      </span>
      <span style={strong ? { fontWeight: 800, color: "#f8fafc" } : undefined}>{value}</span>
    </p>
  );
}

function MlbPickCard({
  prop,
  onOpen,
  rank,
  cardStyle,
  streakAction = false,
}) {
  if (isSafeModeEnabled()) {
    return (
      <SimplePropCard
        prop={prop}
        index={rank || 0}
        onOpen={onOpen}
        className="mlb-pick-card mlb-pick-card-simple"
      />
    );
  }

  const side = resolvePickSide(prop);
  const playerName = prop.playerName || prop.player || "Unknown";
  const market = displayMarketLabel(prop);
  const line = formatNumber(prop.line);
  const source = normalizeSourceLabel(prop);
  const conf = prop.confidenceScore ?? prop.confidence;
  const risk = formatRiskShort(prop);
  const teamLine = [prop.team, prop.opponent ? `vs ${prop.opponent}` : ""].filter(Boolean).join(" ");
  const reason = shortReason(prop);
  const fallback = prop.isFallbackMlbPick || prop.fallbackLabel;

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(prop);
  }

  return (
    <article
      className="mlb-pick-card"
      style={{ ...styles.card, ...styles.cardMobileTight, ...cardStyle }}
      role="button"
      tabIndex={0}
      onClick={openDetails}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetails(e);
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "8px" }}>
        {rank != null ? <span style={styles.rankBadge}>#{rank}</span> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            className="mlb-pick-player-name"
            style={{ ...styles.playerName, margin: 0, fontSize: "17px", lineHeight: 1.15 }}
          >
            {playerName}
          </h3>
          {teamLine ? (
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#94a3b8" }}>{teamLine}</p>
          ) : null}
        </div>
      </div>

      <RecommendationBanner side={side} streakAction={streakAction} />

      <div style={{ marginTop: "10px", display: "grid", gap: "2px" }}>
        <MetaLine label="Prop" value={market} strong />
        <MetaLine label="Line" value={line} strong />
        <MetaLine label="Source" value={source} />
        <MetaLine label="Confidence" value={conf != null ? `${conf}%` : null} />
        <MetaLine label="Risk" value={risk} />
      </div>

      {reason ? (
        <p style={{ ...styles.compactFlags, margin: "8px 0 0", color: "#94a3b8", fontSize: "12px" }}>{reason}</p>
      ) : null}

      {fallback ? (
        <p style={{ ...styles.compactFlags, margin: "4px 0 0", color: "#fde68a", fontSize: "11px" }}>
          {prop.fallbackLabel || "Fallback MLB pick"}
        </p>
      ) : null}

      <button type="button" className="prop-card-why-link" style={{ ...styles.whyLink, marginTop: "8px" }} onClick={openDetails}>
        Details
      </button>
    </article>
  );
}

export default memo(MlbPickCard);
