import { memo, useState } from "react";
import PlayerImage from "./PlayerImage.jsx";
import DataQualityBadge from "./DataQualityBadge.jsx";
import { formatLeanSide, formatNumber, shortReason } from "../utils/formatters.js";
import { confidenceTier, displayMarketLabel, displaySport } from "../utils/propLabels.js";
import { lineMovementArrow, lineSourceBadgeStyle, resultStatusBadge, sportsbookCardTag } from "../utils/cardSignals.js";
import { dataBadgeStyle, styles, tierStyle } from "../theme/styles.js";
import { isReadyToBet } from "../services/pickScoring.js";
import { dynamicAcceptanceTier, getVolatilityLabel } from "../services/propQualityGates.js";
import { formatDateTime } from "../utils/formatters.js";
import { riskAccentStyle } from "../utils/displayPropScoring.js";

const DYNAMIC_TIER_STYLE = {
  SAFE: { border: "#22c55e", background: "#052e16", color: "#bbf7d0" },
  PLAYABLE: { border: "#0ea5e9", background: "#082f49", color: "#bae6fd" },
  VALUE: { border: "#a855f7", background: "#3b0764", color: "#e9d5ff" },
  RESEARCH: { border: "#475569", background: "#1e293b", color: "#cbd5e1" },
};

function dynamicTierBadgeStyle(tierKey) {
  const colors = DYNAMIC_TIER_STYLE[tierKey] || DYNAMIC_TIER_STYLE.RESEARCH;
  return {
    fontSize: "10px",
    fontWeight: 800,
    padding: "2px 6px",
    borderRadius: "6px",
    border: `1px solid ${colors.border}`,
    background: colors.background,
    color: colors.color,
    letterSpacing: "0.04em",
  };
}

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

function PlayerPropCard({ prop, onOpen, rank, compact = true, topPick = false, cardStyle, savedResult }) {
  const [expanded, setExpanded] = useState(false);
  const tier = confidenceTier(prop);
  const lean = formatLeanSide(prop.bestPick || prop.side || "Watch");
  const ready = Boolean(prop.isQualificationAccepted) || isReadyToBet(prop);
  const bettingLabel =
    prop.bettingLabel ||
    (ready ? "Ready to Bet" : prop.displayTier === "near" || prop.recommendationStatus === "near" ? "Near Miss" : "Watchlist");
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
  const volatilityLabel = getVolatilityLabel(prop);
  const dynamicTier = prop.dynamicAcceptanceTier || dynamicAcceptanceTier(prop);
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag || "";
  const bookLine = prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine;
  const lastUpdated = prop.updatedAt || prop.lastFetchAt || prop.cacheMetadata?.verifiedAt || "";
  const cacheLabel = prop.cacheVerified || prop.lineSourceBadge === "CACHED" ? "cached verified" : "";
  const sportsbookEdgeNum = Number(prop.sportsbookEdge ?? 0);
  const sportsbookEdgeLabel = prop.sportsbookEdgeLabel || "";
  const sportsbookBooksCount = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);

  // Player stat expansion fields — already populated by enrichment pipeline.
  const last5Avg = prop.last5Average ?? prop.profile?.last5Average ?? null;
  const last10Avg = prop.last10Average ?? prop.profile?.last10Average ?? null;
  const hitRatePct = (() => {
    const rate = prop.recentHitRate ?? prop.last5HitRate ?? prop.last10HitRate ?? prop.profile?.recentHitRate;
    if (!Number.isFinite(Number(rate))) return null;
    return Math.round(Number(rate) * 100);
  })();
  const opponentRank = prop.opponentRank ?? prop.profile?.opponentRank ?? null;
  const opponentAllowed = prop.opponentAllowed ?? prop.profile?.opponentAllowed ?? null;
  const homeAwaySplit = prop.homeAwaySplit || prop.profile?.homeAwaySplit || (prop.isHome === true ? "Home" : prop.isHome === false ? "Away" : "");
  const recentTrend = prop.formNote || prop.profile?.formNote || prop.recentTrend || prop.strikeoutTrend || "";
  const openingLine = prop.lineMovement?.openingLine ?? null;
  const currentLineSnap = prop.lineMovement?.currentLine ?? prop.line ?? null;
  const confDisplay =
    prop.calibratedConfidence != null && prop.calibratedConfidence !== prop.confidenceScore
      ? prop.calibratedConfidence
      : prop.confidenceScore ?? prop.confidence ?? null;
  const edgeDisplay = Number.isFinite(Number(prop.edge)) ? formatNumber(prop.edge) : "—";
  const riskShort = (() => {
    const text = String(prop.riskLevel || "").toUpperCase();
    if (text.includes("LOW")) return "LOW";
    if (text.includes("HIGH")) return "HIGH";
    if (text.includes("MED") || text.includes("MOD")) return "MED";
    return text.slice(0, 6) || "—";
  })();
  const showDynamicTier = dynamicTier && String(dynamicTier).toUpperCase() !== "RESEARCH";
  const riskAccent = riskAccentStyle(prop.riskLevel);

  return (
    <article
      className={topPick ? "prop-card-top-pick" : undefined}
      style={{ ...styles.card, ...(compact ? styles.cardMobileTight : null), ...riskAccent, ...cardStyle }}
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
              <p className="prop-card-platform" style={styles.platform}>
                {prop.platform} · {displaySport(prop)}
              </p>
              <h3 className="prop-card-player-name" style={styles.playerName}>{prop.playerName}</h3>
              {!compact && (
                <p style={styles.gameLine}>
                  {prop.team || "—"} vs {prop.opponent || "—"}
                </p>
              )}
            </div>
            <div style={styles.cardBadgeColumn}>
              {verifiedBadge ? <span style={lineSourceBadgeStyle("VERIFIED")}>VERIFIED</span> : null}
              <span style={bettingLabelStyle(statusLabel)}>{compact ? statusLabel : bettingLabel}</span>
              {prop.needsReview ? <span style={bettingLabelStyle("Near Miss")}>Needs review</span> : null}
              {showDynamicTier ? <span style={dynamicTierBadgeStyle(dynamicTier)}>{dynamicTier}</span> : null}
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
      <div className="prop-card-meta-row prop-card-meta-primary" style={styles.compactMetaRow}>
        <span className="prop-card-stat-highlight" style={styles.compactMetaItem}>
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
        <span className="prop-card-conf-highlight" style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Conf</span>
          <strong style={styles.metaValueStrong}>
            {confDisplay != null ? `${confDisplay}%` : "—"}
          </strong>
        </span>
        <span style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Lean</span>
          <strong style={styles.metaValueStrong}>{lean}</strong>
        </span>
        {topPick ? (
          <p className="prop-meta-top-pick-inline">
            CONF {confDisplay != null ? `${confDisplay}%` : "—"} • EDGE {edgeDisplay} • RISK {riskShort}
          </p>
        ) : null}
        <span className="prop-meta-secondary" style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Proj</span>
          <strong style={styles.metaValueStrong}>
            {prop.projectedValue != null
              ? formatNumber(prop.projectedValue)
              : prop.projection != null
                ? formatNumber(prop.projection)
                : "—"}
          </strong>
        </span>
        <span className={`prop-meta-conf-edge-risk${topPick ? " prop-meta-top-pick-hide" : ""}`} style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Edge</span>
          <strong style={styles.metaValueStrong}>{edgeDisplay}</strong>
        </span>
        <span className={`prop-meta-conf-edge-risk${topPick ? " prop-meta-top-pick-hide" : ""}`} style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Risk</span>
          <strong>{riskShort}</strong>
        </span>
        <span className="prop-meta-secondary" style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>EV</span>
          <strong>{Number.isFinite(Number(prop.expectedValueScore)) ? Math.round(Number(prop.expectedValueScore)) : "—"}</strong>
        </span>
        <span className="prop-meta-secondary" style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>Vol</span>
          <strong>
            {volatilityLabel}
            {Number.isFinite(Number(prop.volatility)) ? ` (${formatNumber(prop.volatility)})` : ""}
          </strong>
        </span>
        <span className="prop-meta-secondary" style={styles.compactMetaItem}>
          <span style={styles.metaLabel}>DQ</span>
          <strong>{Number.isFinite(Number(prop.dataQualityScore)) ? Math.max(22, Math.round(Number(prop.dataQualityScore))) : "—"}</strong>
        </span>
        {bookLine != null && Number.isFinite(sportsbookEdgeNum) && sportsbookEdgeNum !== 0 ? (
          <span
            className="prop-meta-secondary"
            style={styles.compactMetaItem}
            title={sportsbookEdgeLabel || `Sportsbook consensus ${formatNumber(bookLine)}`}
          >
            <span style={styles.metaLabel}>SB Edge</span>
            <strong
              style={{
                ...styles.metaValueStrong,
                color: sportsbookEdgeNum > 0 ? "#86efac" : "#fca5a5",
              }}
            >
              {sportsbookEdgeNum > 0 ? "+" : ""}
              {formatNumber(sportsbookEdgeNum)}
            </strong>
          </span>
        ) : null}
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
          className="prop-card-inline-details"
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
              {prop.confidenceExplanation ||
                `Projection ${prop.projectedValue != null ? formatNumber(prop.projectedValue) : prop.projection != null ? formatNumber(prop.projection) : "—"} vs line ${formatNumber(prop.line)} (${edgeDisplay} edge)`}
            </p>
            <p style={styles.compactFlags}>
              Source {prop.platform || prop.source || "—"} · {prop.status === "cached" || prop.lineSourceBadge === "CACHED" ? "Cached" : "Live"}
              {lastUpdated ? ` · Updated ${formatDateTime(lastUpdated)}` : ""}
            </p>
            {sportsbookEdgeLabel ? (
              <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: sportsbookEdgeNum > 0 ? "#86efac" : "#fca5a5" }}>
                Sportsbook Edge: {sportsbookEdgeLabel}
                {sportsbookBooksCount > 0 ? ` · ${sportsbookBooksCount} book${sportsbookBooksCount === 1 ? "" : "s"}` : ""}
              </p>
            ) : null}
            {last5Avg != null || hitRatePct != null || opponentRank != null || opponentAllowed != null || homeAwaySplit || recentTrend ? (
              <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#cbd5e1" }}>
                {last5Avg != null ? `Last 5: ${formatNumber(last5Avg)}` : null}
                {last5Avg != null && (last10Avg != null || hitRatePct != null) ? " · " : ""}
                {last10Avg != null ? `Last 10: ${formatNumber(last10Avg)}` : null}
                {(last5Avg != null || last10Avg != null) && hitRatePct != null ? " · " : ""}
                {hitRatePct != null ? `Hit ${hitRatePct}%` : null}
                {(last5Avg != null || last10Avg != null || hitRatePct != null) && (opponentRank != null || opponentAllowed != null) ? " · " : ""}
                {opponentRank != null ? `Opp rank #${opponentRank}` : null}
                {opponentRank != null && opponentAllowed != null ? " · " : ""}
                {opponentAllowed != null ? `Opp allowed ${formatNumber(opponentAllowed)}` : null}
                {(last5Avg != null || hitRatePct != null || opponentRank != null || opponentAllowed != null) && (homeAwaySplit || recentTrend) ? " · " : ""}
                {homeAwaySplit ? homeAwaySplit : null}
                {homeAwaySplit && recentTrend ? " · " : ""}
                {recentTrend ? recentTrend : null}
              </p>
            ) : null}
            {Number.isFinite(Number(openingLine)) && Number.isFinite(Number(currentLineSnap)) && Number(openingLine) !== Number(currentLineSnap) ? (
              <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#94a3b8" }}>
                Line history: open {formatNumber(openingLine)} → now {formatNumber(currentLineSnap)}
                {movementTag ? ` (${movementTag})` : ""}
              </p>
            ) : null}
            {Array.isArray(prop.confidenceBoostLabels) && prop.confidenceBoostLabels.length ? (
              <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#86efac" }}>
                Why: {prop.confidenceBoostLabels.slice(0, 3).join(" · ")}
              </p>
            ) : null}
            {Array.isArray(prop.confidencePenaltyLabels) && prop.confidencePenaltyLabels.length ? (
              <p style={{ ...styles.compactFlags, margin: "2px 0 0", color: "#fca5a5" }}>
                Caution: {prop.confidencePenaltyLabels.slice(0, 2).join(" · ")}
              </p>
            ) : null}
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
      <div className="prop-card-why-link" style={styles.whyLink}>Why this pick?</div>
    </article>
  );
}

export default memo(PlayerPropCard);
