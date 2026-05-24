import { memo } from "react";
import PlayerImage from "./PlayerImage.jsx";
import { styles } from "../theme/styles.js";
import { displayFullMarketLabel, displaySport } from "../utils/propLabels.js";
import { formatDateTime, formatNumber, formatSignedNumber, shortReason } from "../utils/formatters.js";
import {
  formatDfsSide,
  formatRiskLevel,
  normalizeSourceLabel,
  platformBadgePalette,
  resolvePickSide,
  riskLevelPalette,
} from "../utils/pickRecommendation.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";

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

function StatRow({ label, value, highlight = false }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="mlb-outlook-stat-row" style={{ display: "flex", justifyContent: "space-between", gap: "8px", padding: "4px 0" }}>
      <span style={{ color: "#64748b", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ color: highlight ? "#f8fafc" : "#cbd5e1", fontSize: "13px", fontWeight: highlight ? 800 : 600, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function MlbPickCard({ prop, onOpen, rank, cardStyle, streakAction = false }) {
  const enriched = withPlayerImageUrl(prop || {});
  const side = resolvePickSide(enriched);
  const dfsSide = formatDfsSide(side);
  const playerName = enriched.playerName || enriched.player || "Unknown Player";
  const platform = normalizeSourceLabel(enriched);
  const platformPalette = platformBadgePalette(platform);
  const riskLevel = formatRiskLevel(enriched);
  const riskPalette = riskLevelPalette(riskLevel);
  const sport = displaySport(enriched) || "MLB";
  const propType = displayFullMarketLabel(enriched);
  const line = formatNumber(enriched.line);
  const lineLabel = line !== "-" ? `${dfsSide} ${line}` : "—";
  const projection = formatNumber(enriched.projection ?? enriched.projectedValue);
  const conf = enriched.confidenceScore ?? enriched.confidence;
  const edge = Number(enriched.edge ?? enriched.projectionEdge);
  const edgeLabel = Number.isFinite(edge) ? formatSignedNumber(edge) : "—";
  const reason =
    enriched.premiumWhySummary ||
    enriched.whyThisPick?.compact ||
    enriched.confidenceExplanation ||
    shortReason(enriched);
  const generatedAt =
    enriched.updatedAt ||
    enriched.lastFetchAt ||
    enriched.generatedAt ||
    enriched.startTime ||
    null;
  const payoutBadge =
    enriched.payoutBadge ||
    (enriched.isGoblinPick ? "GOBLIN / SAFER LINE" : enriched.isDemonPick ? "DEMON / HIGHER PAYOUT" : "");
  const matchup = [enriched.team, enriched.opponent ? `vs ${enriched.opponent}` : ""].filter(Boolean).join(" ");
  const fallback = enriched.isFallbackMlbPick || enriched.fallbackLabel;

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(enriched);
  }

  return (
    <article
      className="mlb-pick-card mlb-outlook-card"
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
            </div>
            <h3 className="mlb-pick-player-name" style={{ ...styles.playerName, margin: 0, fontSize: "16px" }}>
              {playerName}
            </h3>
            {matchup ? (
              <p className="mlb-outlook-matchup" style={{ margin: "4px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                {matchup}
              </p>
            ) : null}
            <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#64748b", fontWeight: 700 }}>{sport}</p>
          </div>
        </div>
        <Badge label={riskLevel} palette={riskPalette} />
      </header>

      <div className="mlb-outlook-divider" style={{ height: 1, background: "#1e293b", margin: "10px 0" }} />

      <div className="mlb-outlook-body">
        <StatRow label="Prop Type" value={propType} highlight />
        <StatRow label="Line" value={lineLabel} highlight />
        <StatRow label="Best Pick" value={dfsSide} highlight />
        <StatRow label="Model Projection" value={projection !== "-" ? projection : null} />
        <StatRow label="Confidence" value={conf != null ? `${Math.round(Number(conf))}%` : null} highlight />
        <StatRow label="Edge" value={edgeLabel !== "-" ? edgeLabel : null} />
      </div>

      {payoutBadge ? (
        <div
          className="mlb-outlook-payout-badge"
          style={{
            marginTop: "10px",
            padding: "6px 10px",
            borderRadius: "6px",
            fontWeight: 800,
            fontSize: "10px",
            letterSpacing: "0.06em",
            textAlign: "center",
            background: enriched.isDemonPick ? "#431407" : "#14532d",
            color: enriched.isDemonPick ? "#fdba74" : "#86efac",
            border: `1px solid ${enriched.isDemonPick ? "#f97316" : "#22c55e"}`,
          }}
        >
          {payoutBadge}
        </div>
      ) : null}

      {streakAction ? (
        <div
          style={{
            marginTop: "8px",
            padding: "8px",
            borderRadius: "6px",
            border: "2px solid #22c55e",
            background: "#052e16",
            color: "#dcfce7",
            fontWeight: 900,
            fontSize: "13px",
            textAlign: "center",
            letterSpacing: "0.05em",
          }}
        >
          {side === "OVER" ? "TAKE OVER" : side === "UNDER" ? "TAKE UNDER" : "WATCH"}
        </div>
      ) : null}

      {reason ? (
        <p className="mlb-outlook-reason" style={{ margin: "10px 0 0", fontSize: "12px", lineHeight: 1.45, color: "#94a3b8" }}>
          {reason}
        </p>
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
