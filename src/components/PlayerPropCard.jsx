import { memo, useState } from "react";
import PlayerImage from "./PlayerImage.jsx";
import DataQualityBadge from "./DataQualityBadge.jsx";
import { formatLeanSide, formatNumber, shortReason } from "../utils/formatters.js";
import { confidenceTier, displayMarketLabel, displaySport } from "../utils/propLabels.js";
import { lineMovementArrow, lineSourceBadgeStyle, resultStatusBadge, sportsbookCardTag } from "../utils/cardSignals.js";
import { dataBadgeStyle, styles, tierStyle } from "../theme/styles.js";
import { isReadyToBet } from "../services/pickScoring.js";

function bettingLabelStyle(label) {
  const key = String(label || "").toLowerCase();
  if (key.includes("near")) {
    return {
      fontSize: "10px",
      fontWeight: 800,
      padding: "2px 6px",
      borderRadius: "6px",
      border: "1px solid #ca8a04",
      background: "#422006",
      color: "#fef08a",
    };
  }
  if (key.includes("ready")) {
    return {
      fontSize: "10px",
      fontWeight: 800,
      padding: "2px 6px",
      borderRadius: "6px",
      border: "1px solid #16a34a",
      background: "#14532d",
      color: "#dcfce7",
    };
  }
  return {
    fontSize: "10px",
    fontWeight: 800,
    padding: "2px 6px",
    borderRadius: "6px",
    border: "1px solid #475569",
    background: "#1e293b",
    color: "#cbd5e1",
  };
}

function PlayerPropCard({ prop, onOpen, rank, compact = true, cardStyle, savedResult }) {
  const [expanded, setExpanded] = useState(false);
  const tier = confidenceTier(prop);
  const lean = formatLeanSide(prop.bestPick || prop.side || "Watch");
  const ready = isReadyToBet(prop);
  const bettingLabel =
    prop.bettingLabel ||
    (ready ? "Ready to Bet" : prop.displayTier === "near" || prop.recommendationStatus === "near" ? "Near Qualification" : "Research only");
  const isWatch = !ready && (prop.recommendationStatus === "watchlist" || prop.recommendationStatus === "research" || prop.recommendationStatus === "near");
  const movementLabel = lineMovementArrow(prop);
  const bookTag = sportsbookCardTag(prop);
  const resultBadge = savedResult ? resultStatusBadge(savedResult) : null;
  const sourceBadge = prop.lineSourceBadge || prop.modelSignal?.lineSourceBadge || "";
  const verifiedBadge = prop.verifiedBadge || (prop.sportsbookVerified ? "VERIFIED" : "");
  const statusLabel = ready ? "Ready" : "Research";
  const statSourceBadges = (prop.statEnrichmentSources || prop.dataSources || prop.modelSignal?.statEnrichmentSources || [])
    .filter(Boolean)
    .slice(0, 3);
  const lowReasons = prop.lowConfidenceReasons || [];

  return (
    <article
      style={{ ...styles.card, ...(compact ? styles.cardMobileTight : null), ...cardStyle }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(prop)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.(prop);
        }
      }}
    >
      <div style={styles.compactCardTop}>
        {rank != null && <span style={styles.rankBadge}>#{rank}</span>}
        {resultBadge && (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 800,
              padding: "2px 6px",
              borderRadius: "6px",
              border: `1px solid ${resultBadge.border}`,
              background: resultBadge.color,
              color: resultBadge.text,
              alignSelf: "flex-start",
            }}
            title={`Saved result: ${savedResult}`}
          >
            {resultBadge.label}
          </span>
        )}
        <PlayerImage prop={prop} />
        <div style={styles.cardInfo}>
          <div style={styles.cardTitleRow}>
            <div style={{ minWidth: 0 }}>
              <p style={styles.platform}>
                {prop.platform} · {displaySport(prop)}
              </p>
              <h3 style={styles.playerName}>{prop.playerName}</h3>
              {!compact && (
                <p style={styles.gameLine}>
                  {prop.team || "—"} vs {prop.opponent || "—"}
                </p>
              )}
            </div>
            <div style={styles.cardBadgeColumn}>
              {verifiedBadge ? <span style={lineSourceBadgeStyle("VERIFIED")}>VERIFIED</span> : null}
              <span style={bettingLabelStyle(statusLabel)}>{compact ? statusLabel : bettingLabel}</span>
              {!compact && sourceBadge ? <span style={lineSourceBadgeStyle(sourceBadge)}>{String(sourceBadge).toUpperCase()}</span> : null}
              {!compact && prop.timeBadge?.label ? (
                <span style={dataBadgeStyle(prop.timeBadge.tone || "partial")}>{prop.timeBadge.label}</span>
              ) : null}
              {!compact && prop.statsMissingBadge?.label ? (
                <span style={dataBadgeStyle(prop.statsMissingBadge.tone || "weak")}>{prop.statsMissingBadge.label}</span>
              ) : null}
              {!compact && prop.researchMissingBadge?.label && prop.researchMissingBadge.label !== prop.statsMissingBadge?.label ? (
                <span style={dataBadgeStyle(prop.researchMissingBadge.tone || "weak")}>{prop.researchMissingBadge.label}</span>
              ) : null}
              {!compact ? <DataQualityBadge prop={prop} /> : null}
              {!compact ? <span style={tierStyle(isWatch ? "Risky" : tier)}>{isWatch ? "Watch" : tier}</span> : null}
            </div>
          </div>
        </div>
      </div>
      <div style={styles.compactMetaRow}>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Prop</span>
          <strong>{displayMarketLabel(prop)}</strong>
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Line</span>
          <strong>
            {formatNumber(prop.line)}
            {movementLabel ? <span style={{ marginLeft: "4px", color: "#7dd3fc", fontSize: "11px" }}>{movementLabel}</span> : null}
          </strong>
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Lean</span>
          <strong style={styles.metaValueStrong}>{lean}</strong>
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Proj</span>
          <strong style={styles.metaValueStrong}>
            {prop.projectedValue != null
              ? formatNumber(prop.projectedValue)
              : prop.projection != null
                ? formatNumber(prop.projection)
                : "—"}
          </strong>
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Edge</span>
          <strong style={styles.metaValueStrong}>
            {Number.isFinite(Number(prop.edge)) && Number(prop.edge) > 0 ? formatNumber(prop.edge) : "—"}
          </strong>
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Conf</span>
          <strong style={styles.metaValueStrong}>
            {prop.calibratedConfidence != null && prop.calibratedConfidence !== prop.confidenceScore
              ? `${prop.calibratedConfidence}%`
              : `${prop.confidenceScore ?? prop.confidence ?? "—"}%`}
          </strong>
          {prop.calibratedConfidence != null && prop.calibratedConfidence !== prop.confidenceScore ? (
            <span style={{ ...styles.compactFlags, marginLeft: 4 }}> raw {prop.confidenceScore}%</span>
          ) : null}
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Risk</span>
          <strong>{prop.riskLevel || "—"}</strong>
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>EV</span>
          <strong>{Number.isFinite(Number(prop.expectedValueScore)) ? Math.round(Number(prop.expectedValueScore)) : "—"}</strong>
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Vol</span>
          <strong>
            {Number.isFinite(Number(prop.volatilityScore))
              ? Math.round(Number(prop.volatilityScore))
              : Number.isFinite(Number(prop.volatility))
                ? formatNumber(prop.volatility)
                : "—"}
          </strong>
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>DQ</span>
          <strong>{Number.isFinite(Number(prop.dataQualityScore)) ? Math.max(22, Math.round(Number(prop.dataQualityScore))) : "—"}</strong>
        </span>
        {!compact && prop.edgeScore != null && (
          <span style={styles.compactMetaItem}>
            <span style={styles.metaLabel}>Edge</span>
            <strong>{prop.edgeScore}</strong>
          </span>
        )}
      </div>
      {!compact && statSourceBadges.length > 0 ? (
        <p style={{ ...styles.compactFlags, margin: "4px 0 0", color: "#bae6fd" }}>
          Stats: {statSourceBadges.join(" · ")}
        </p>
      ) : null}
      {!compact && bookTag ? <p style={{ ...styles.compactFlags, margin: "4px 0 0", color: "#86efac" }}>{bookTag}</p> : null}
      {compact ? (
        <details
          style={styles.cardInlineDetails}
          open={expanded}
          onClick={(event) => event.stopPropagation()}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary style={styles.cardInlineSummary} onClick={(event) => event.stopPropagation()}>
            Details
          </summary>
          <div style={styles.cardInlineBody}>
            <p style={styles.compactFlags}>
              Book {prop.sportsbookLine != null ? formatNumber(prop.sportsbookLine) : "—"} · Proj{" "}
              {prop.projectedValue != null ? formatNumber(prop.projectedValue) : "—"} · Edge{" "}
              {Number(prop.edge) > 0 ? formatNumber(prop.edge) : "—"} · Conf {prop.confidenceScore ?? "—"}% · Risk{" "}
              {prop.riskLevel || "—"} · EV {Number.isFinite(Number(prop.expectedValueScore)) ? Math.round(Number(prop.expectedValueScore)) : "—"} · Vol{" "}
              {Number.isFinite(Number(prop.volatilityScore)) ? Math.round(Number(prop.volatilityScore)) : "—"}
            </p>
            <p style={styles.compactFlags}>{shortReason(prop)}</p>
            {prop.qualificationReason ? (
              <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#86efac" }}>{prop.qualificationReason}</p>
            ) : null}
            {prop.elitePickExplanation?.compact ? (
              <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#fde68a" }}>
                {prop.elitePickExplanation.headline}: {prop.elitePickExplanation.compact}
              </p>
            ) : null}
            {bookTag ? <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#86efac" }}>{bookTag}</p> : null}
            {!ready && lowReasons.length > 0 ? (
              <ul style={{ ...styles.explanationList, margin: "4px 0 0", paddingLeft: "16px" }}>
                {lowReasons.slice(0, 2).map((reason) => (
                  <li key={reason} style={{ fontSize: "10px", color: "#94a3b8" }}>
                    {reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ) : (
        <>
          <p style={{ ...styles.compactFlags, margin: "4px 0 0" }}>{shortReason(prop)}</p>
          {!ready && lowReasons.length > 0 && (
            <div style={{ marginTop: "6px" }}>
              <p style={{ ...styles.compactFlags, margin: 0, color: "#fcd34d", fontWeight: 700 }}>Why confidence is low</p>
              <ul style={{ ...styles.explanationList, margin: "4px 0 0", paddingLeft: "16px" }}>
                {lowReasons.slice(0, 3).map((reason) => (
                  <li key={reason} style={{ fontSize: "11px", color: "#94a3b8" }}>
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div style={styles.whyLink}>Why this pick?</div>
    </article>
  );
}

export default memo(PlayerPropCard);
