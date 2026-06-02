import { memo } from "react";
import PlayerImage from "./PlayerImage.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { styles } from "../theme/styles.js";
import { displayFullMarketLabel, displaySport } from "../utils/propLabels.js";
import { formatDateTime, formatNumber, formatSignedNumber } from "../utils/formatters.js";
import {
  formatDfsSide,
  formatRiskLevel,
  normalizeSourceLabel,
  platformBadgePalette,
  recommendationPalette,
  resolvePickSide,
  riskLevelPalette,
} from "../utils/pickRecommendation.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";
import {
  CONFIDENCE_TOOLTIP,
  confidenceBandDisplay,
  confidenceBandPalette,
  resolveBandScore,
} from "../utils/mlbConfidenceEngine.js";
import { buildAnalyticsReason } from "../utils/propReasonEngine.js";

function Badge({ label, palette }) {
  if (!label) return null;
  return (
    <span
      className="mlb-outlook-badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: "999px",
        fontSize: "10px",
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.color,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function SideBanner({ side, streakAction = false }) {
  const palette = recommendationPalette(side);
  const label = side === "OVER" ? (streakAction ? "TAKE OVER" : "OVER") : side === "UNDER" ? (streakAction ? "TAKE UNDER" : "UNDER") : "WATCH";
  return (
    <div
      className="mlb-outlook-side-banner"
      style={{
        marginTop: "7px",
        padding: "10px 12px",
        borderRadius: "8px",
        border: `2px solid ${palette.border}`,
        background: palette.bannerBg,
        color: palette.bannerText,
        fontWeight: 900,
        fontSize: streakAction ? "16px" : "15px",
        letterSpacing: "0.08em",
        textAlign: "center",
      }}
    >
      {label}
    </div>
  );
}

function MlbPickCard({ prop, onOpen, rank, cardStyle, streakAction = false }) {
  const enriched = withPlayerImageUrl(prop || {});
  const side = resolvePickSide(enriched);
  const dfsSide = formatDfsSide(side, enriched);
  const playerName = enriched.playerName || enriched.player || "Unknown Player";
  const platform = streakAction ? "Underdog" : normalizeSourceLabel(enriched);
  const platformPalette = platformBadgePalette(platform);
  const riskLevel = formatRiskLevel(enriched);
  const riskPalette = riskLevelPalette(riskLevel);
  const sport = displaySport(enriched) || "MLB";
  const propType = displayFullMarketLabel(enriched);
  const line = formatNumber(enriched.line);
  const lineLabel = line !== "-" ? `${dfsSide} ${line}` : "—";
  const projection = formatNumber(enriched.projection ?? enriched.projectedValue);
  const conf = enriched.confidenceScore ?? enriched.confidence;
  const confRounded = conf != null ? Math.round(Number(conf)) : null;
  const bandScore = resolveBandScore(enriched);
  const confBand = bandScore != null ? confidenceBandDisplay(bandScore) : null;
  const confPalette = bandScore != null ? confidenceBandPalette(bandScore) : null;
  const edge = Number(enriched.edge ?? enriched.projectionEdge);
  const edgeLabel = Number.isFinite(edge) ? formatSignedNumber(edge) : "—";
  const reason =
    enriched.analyticsReason ||
    enriched.premiumWhySummary ||
    enriched.whyThisPick?.compact ||
    buildAnalyticsReason(enriched) ||
    enriched.confidenceExplanation ||
    "";
  const generatedAt =
    enriched.updatedAt ||
    enriched.lastFetchAt ||
    enriched.generatedAt ||
    enriched.startTime ||
    null;
  const isGoblin = enriched.isGoblinPick;
  const isDemon = enriched.isDemonPick;
  const payoutBadge =
    enriched.payoutBadge ||
    enriched.featuredLabel ||
    (isGoblin ? "GOBLIN / SAFER LINE" : isDemon ? "DEMON / HIGHER PAYOUT" : "");
  const payoutStyle = isDemon
    ? { bg: "#3b0764", border: "#e879f9", color: "#f5d0fe" }
    : isGoblin
      ? { bg: "#083344", border: "#22d3ee", color: "#cffafe" }
      : null;
  const fallback = enriched.isFallbackMlbPick || enriched.fallbackLabel;

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(enriched);
  }

  return (
    <article
      className={`mlb-pick-card mlb-outlook-card${streakAction ? " mlb-streak-card" : ""}${isGoblin ? " mlb-goblin-card" : ""}${isDemon ? " mlb-demon-card" : ""}`}
      style={{ ...styles.mlbOutlookCard, ...cardStyle }}
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
      <header className="mlb-outlook-header" style={styles.mlbOutlookHeader}>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", flex: 1, minWidth: 0 }}>
          <PlayerImage prop={enriched} large />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginBottom: "6px" }}>
              <Badge label={platformPalette.label} palette={platformPalette} />
              {rank != null ? <span style={styles.rankBadge}>#{rank}</span> : null}
              {confBand ? <Badge label={confBand} palette={confPalette} /> : null}
            </div>
            <h3 className="mlb-pick-player-name" style={{ ...styles.playerName, margin: 0, fontSize: "17px" }}>
              {playerName}
            </h3>
            {(enriched.team || enriched.opponent) ? (
              <p className="mlb-outlook-matchup" style={{ margin: "4px 0 0", fontSize: "12px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                {enriched.team ? <TeamLogo team={enriched.team} size={16} /> : null}
                <span>{[enriched.team, enriched.opponent ? `vs ${enriched.opponent}` : ""].filter(Boolean).join(" ")}</span>
                {enriched.opponent ? <TeamLogo team={enriched.opponent} size={16} /> : null}
              </p>
            ) : null}
            <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#64748b", fontWeight: 700 }}>{sport}</p>
          </div>
        </div>
        <Badge label={riskLevel} palette={riskPalette} />
      </header>

      <SideBanner side={side} streakAction={streakAction} />

      <div className="mlb-outlook-hero-line" style={{ marginTop: "7px", textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {propType}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: "28px", fontWeight: 900, color: "#f8fafc", lineHeight: 1.1 }}>
          {lineLabel}
        </p>
      </div>

      <div className="mlb-outlook-metrics" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "8px" }}>
        <div style={{ padding: "8px", borderRadius: "8px", background: "#111827", border: "1px solid #1e293b" }}>
          <p style={{ margin: 0, fontSize: "10px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Confidence</p>
          <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 900, color: "#f8fafc" }}>
            {confRounded != null ? `${confRounded}%` : "—"}
          </p>
          <p
            title={CONFIDENCE_TOOLTIP}
            style={{ margin: "4px 0 0", fontSize: "10px", color: "#64748b", cursor: "help", textDecoration: "underline dotted" }}
          >
            How scored?
          </p>
        </div>
        <div style={{ padding: "8px", borderRadius: "8px", background: "#111827", border: "1px solid #1e293b" }}>
          <p style={{ margin: 0, fontSize: "10px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Edge</p>
          <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 900, color: edge > 0 ? "#86efac" : "#cbd5e1" }}>
            {edgeLabel}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "10px", color: "#64748b" }}>Proj {projection}</p>
        </div>
      </div>

      {payoutBadge && payoutStyle ? (
        <div
          className="mlb-outlook-payout-badge"
          style={{
            marginTop: "7px",
            padding: "7px 10px",
            borderRadius: "8px",
            fontWeight: 800,
            fontSize: "10px",
            letterSpacing: "0.06em",
            textAlign: "center",
            background: payoutStyle.bg,
            color: payoutStyle.color,
            border: `1px solid ${payoutStyle.border}`,
          }}
        >
          {payoutBadge}
        </div>
      ) : payoutBadge ? (
        <div style={{ marginTop: "10px", fontSize: "11px", fontWeight: 800, color: "#93c5fd", textAlign: "center" }}>{payoutBadge}</div>
      ) : null}

      {reason ? (
        <div style={{ marginTop: "8px", padding: "8px 10px", borderRadius: "8px", background: "#0b1220", border: "1px solid #1e293b" }}>
          <p style={{ margin: 0, fontSize: "10px", color: "#64748b", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Why this pick
          </p>
          <p className="mlb-outlook-reason" style={{ margin: "6px 0 0", fontSize: "12px", lineHeight: 1.45, color: "#cbd5e1" }}>
            {reason}
          </p>
        </div>
      ) : null}

      {generatedAt ? (
        <p className="mlb-outlook-generated" style={{ margin: "8px 0 0", fontSize: "10px", color: "#64748b" }}>
          Generated {formatDateTime(generatedAt)}
        </p>
      ) : null}

      {fallback ? (
        <p style={{ margin: "6px 0 0", fontSize: "10px", color: "#fde68a" }}>{enriched.fallbackLabel || "Fallback MLB pick"}</p>
      ) : null}
    </article>
  );
}

export default memo(MlbPickCard);
