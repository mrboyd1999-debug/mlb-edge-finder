import { memo } from "react";
import PlayerImage from "./PlayerImage.jsx";
import DataQualityBadge from "./DataQualityBadge.jsx";
import { formatLeanSide, formatNumber, shortReason } from "../utils/formatters.js";
import { confidenceTier, displayMarketLabel, displaySport } from "../utils/propLabels.js";
import { lineMovementArrow, lineSourceBadgeStyle, resultStatusBadge, sportsbookCardTag } from "../utils/cardSignals.js";
import { dataBadgeStyle, styles, tierStyle } from "../theme/styles.js";
import { isReadyToBet } from "../services/pickScoring.js";
import { dynamicAcceptanceTier, getVolatilityLabel } from "../services/propQualityGates.js";
import { riskAccentStyle } from "../utils/displayPropScoring.js";
import { isManualAnalyzerProp } from "../utils/manualPropBuilder.js";
import {
  AWAITING_PROJECTION_STATUS,
  hasValidProjection,
  leanBadgeStyle,
  manualMetricFadeStyle,
  manualRiskBadgeStyle,
  manualWeakPickStyle,
  NO_VERIFIED_PLAY_STATUS,
  normalizeManualPick,
  payoutBadgeStyle,
  payoutDisplayLabel,
  projectionVsLineLabel,
  riskShortLabel,
  strongPlayBadgeStyle,
} from "../utils/manualPropScoring.js";

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

function noVerifiedPlayBadgeStyle() {
  return { border: "1px solid #475569", background: "#1e293b", color: "#94a3b8" };
}

function PlayerPropCard({ prop, onOpen, rank, compact = true, topPick = false, cardStyle, savedResult }) {
  const isManual = isManualAnalyzerProp(prop);
  const hasProjection = hasValidProjection(prop);
  const noVerifiedPlay = isManual && (!hasProjection || prop.projectionUnavailable);
  const tier = confidenceTier(prop);
  const pickSide = noVerifiedPlay ? "" : normalizeManualPick(prop.bestPick || prop.side || prop.pick);
  const lean = noVerifiedPlay
    ? null
    : pickSide === "over"
      ? "Over"
      : pickSide === "under"
        ? "Under"
        : formatLeanSide(prop.bestPick || prop.side || "Watch");
  const weakPick = isManual && (noVerifiedPlay || prop.noEdge || prop.isWeakManualPick);
  const metricFade = noVerifiedPlay ? {} : manualMetricFadeStyle(prop.edge);
  const payoutLabel = payoutDisplayLabel(prop);
  const projVsLine = projectionVsLineLabel(prop);
  const researchOnly = Boolean(prop.displayResearchOnly) || /research only/i.test(String(prop.bettingLabel || ""));
  const playable = Boolean(prop.isDisplayPlayable) && !researchOnly;
  const ready = playable && (Boolean(prop.isQualificationAccepted) || isReadyToBet(prop));
  const bettingLabel =
    researchOnly
      ? "Research only"
      : prop.bettingLabel ||
        (ready ? "Ready to Bet" : prop.displayTier === "near" || prop.recommendationStatus === "near" ? "Near Miss" : "Watchlist");
  const isWatch = !ready && !researchOnly && (prop.recommendationStatus === "watchlist" || prop.recommendationStatus === "research" || prop.recommendationStatus === "near");
  const movementLabel = lineMovementArrow(prop);
  const bookTag = sportsbookCardTag(prop);
  const resultBadge = savedResult ? resultStatusBadge(savedResult) : null;
  const sourceBadge = prop.lineSourceBadge || prop.modelSignal?.lineSourceBadge || "";
  const verifiedBadge = prop.verifiedBadge || (prop.sportsbookVerified ? "VERIFIED" : "");
  const statusLabel = researchOnly
    ? "Research only"
    : prop.playTag === "Strong Play"
      ? "Strong Play"
      : prop.bettingLabel ||
        (ready ? "Ready to Bet" : prop.displayTier === "near" || prop.recommendationStatus === "near" ? "Near Miss" : "Watchlist");
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
    noVerifiedPlay
      ? null
      : prop.calibratedConfidence != null && prop.calibratedConfidence !== prop.confidenceScore
        ? prop.calibratedConfidence
        : prop.confidenceScore ?? prop.confidence ?? null;
  const confDisplayPositive = confDisplay != null && Number(confDisplay) > 0 ? confDisplay : null;
  const edgeDisplay =
    noVerifiedPlay || !Number.isFinite(Number(prop.edge)) || Number(prop.edge) <= 0
      ? null
      : formatNumber(prop.edge);
  const hitChanceDisplay = noVerifiedPlay
    ? null
    : Number.isFinite(Number(prop.impliedHitChance))
      ? `${Math.round(Number(prop.impliedHitChance))}%`
      : null;
  const projectionDisplay = noVerifiedPlay
    ? null
    : prop.projectedValue != null
      ? formatNumber(prop.projectedValue)
      : prop.projection != null
        ? formatNumber(prop.projection)
        : null;
  const volatilityDisplay = noVerifiedPlay ? null : prop.volatilityLabel || null;
  const riskShort = noVerifiedPlay ? null : riskShortLabel(prop.riskLevel);
  const showDynamicTier = dynamicTier && String(dynamicTier).toUpperCase() !== "RESEARCH";
  const riskAccent = riskAccentStyle(prop.riskLevel);
  const fallbackBadge = prop.displayFallback || prop.fallbackLabel;

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(prop);
  }

  return (
    <article
      className={
        topPick
          ? "prop-card-top-pick"
          : isManual
            ? `prop-card-compact prop-card-manual${weakPick ? " prop-card-manual-weak" : ""}`
            : "prop-card-compact"
      }
      style={{
        ...styles.card,
        ...(compact ? styles.cardMobileTight : null),
        ...(isManual ? manualWeakPickStyle(prop.edge) : riskAccent),
        ...cardStyle,
      }}
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
              {verifiedBadge && !isManual ? <span style={lineSourceBadgeStyle("VERIFIED")}>VERIFIED</span> : null}
              {fallbackBadge ? <span style={bettingLabelStyle("Near Miss")}>Fallback</span> : null}
              {!isManual ? <span style={bettingLabelStyle(statusLabel)}>{compact ? statusLabel : bettingLabel}</span> : null}
              {isManual && prop.playTag === "Strong Play" ? (
                <span style={{ ...styles.scoreBadge, ...strongPlayBadgeStyle(), fontSize: "9px" }}>Strong Play</span>
              ) : null}
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
        {compact ? (
          isManual ? (
            noVerifiedPlay ? (
              <>
                <span className="prop-card-stat-highlight prop-card-prop-line-row" style={{ ...styles.compactMetaItem, flex: "1 1 100%" }}>
                  <strong>
                    {displayMarketLabel(prop)} · Line {formatNumber(prop.line)}
                    {prop.source || prop.platform ? ` · ${prop.source || prop.platform}` : ""}
                  </strong>
                </span>
                <div className="prop-card-primary-metrics" style={styles.manualPrimaryMetricsRow}>
                  <span style={{ ...styles.scoreBadge, ...noVerifiedPlayBadgeStyle() }}>
                    {prop.displayStatus || NO_VERIFIED_PLAY_STATUS}
                  </span>
                </div>
                <p className="prop-card-volatility-secondary" style={{ ...styles.manualVolatilityLine, marginTop: "2px", color: "#94a3b8" }}>
                  {prop.statusMessage || AWAITING_PROJECTION_STATUS}
                </p>
                {projVsLine ? (
                  <p className="prop-card-volatility-secondary" style={{ ...styles.manualVolatilityLine, color: "#64748b" }}>
                    {projVsLine}
                  </p>
                ) : null}
              </>
            ) : (
            <>
              <span className="prop-card-stat-highlight prop-card-prop-line-row" style={{ ...styles.compactMetaItem, flex: "1 1 100%" }}>
                <strong>
                  {displayMarketLabel(prop)} · Line {formatNumber(prop.line)}
                  {prop.source || prop.platform ? ` · ${prop.source || prop.platform}` : ""}
                </strong>
              </span>
              <div className="prop-card-primary-metrics" style={styles.manualPrimaryMetricsRow}>
                {projectionDisplay ? (
                  <span style={{ ...styles.scoreBadge, ...metricFade, borderColor: "#475569", color: "#cbd5e1", background: "#111827" }}>
                    PROJ {projectionDisplay}
                  </span>
                ) : null}
                {edgeDisplay != null ? (
                  <span
                    style={{
                      ...styles.scoreBadge,
                      ...metricFade,
                      borderColor: "#1d4ed8",
                      color: "#93c5fd",
                      background: "#1e3a8a",
                    }}
                  >
                    EDGE +{edgeDisplay}
                  </span>
                ) : null}
                {confDisplayPositive != null ? (
                  <span style={{ ...styles.scoreBadge, ...metricFade, borderColor: "#166534", color: "#86efac", background: "#052e16" }}>
                    CONF {confDisplayPositive}%
                  </span>
                ) : null}
                {hitChanceDisplay ? (
                  <span style={{ ...styles.scoreBadge, ...metricFade, borderColor: "#155e75", color: "#a5f3fc", background: "#083344" }}>
                    HIT {hitChanceDisplay}
                  </span>
                ) : null}
              </div>
              <div className="prop-card-badge-row" style={styles.badgeRow}>
                {lean === "Over" || lean === "Under" ? (
                  <span style={{ ...styles.scoreBadge, ...leanBadgeStyle(lean) }}>{lean.toUpperCase()}</span>
                ) : null}
                <span style={{ ...styles.scoreBadge, ...payoutBadgeStyle(prop) }}>{payoutLabel}</span>
              </div>
              {prop.whyThisPick || prop.qualificationReason ? (
                <p className="prop-card-volatility-secondary" style={{ ...styles.manualVolatilityLine, marginTop: "2px" }}>
                  {prop.whyThisPick || prop.qualificationReason}
                </p>
              ) : projVsLine ? (
                <p className="prop-card-volatility-secondary" style={styles.manualVolatilityLine}>
                  {projVsLine}
                </p>
              ) : null}
            </>
            )
          ) : (
          <>
            <span className="prop-card-stat-highlight prop-card-prop-line-row" style={{ ...styles.compactMetaItem, flex: "1 1 100%" }}>
              <strong>
                {displayMarketLabel(prop)} · Line {formatNumber(prop.line)}
                {movementLabel ? <span style={{ marginLeft: "4px", color: "#7dd3fc", fontSize: "10px" }}>{movementLabel}</span> : null}
              </strong>
            </span>
            <div className="prop-card-badge-row" style={styles.badgeRow}>
              {confDisplay != null ? (
                <span style={{ ...styles.scoreBadge, borderColor: "#166534", color: "#86efac" }}>
                  CONF {confDisplay}%
                </span>
              ) : null}
              {edgeDisplay != null ? (
                <span
                  style={{
                    ...styles.scoreBadge,
                    borderColor: Number(prop.edge) >= 0 ? "#1d4ed8" : "#991b1b",
                    color: Number(prop.edge) >= 0 ? "#93c5fd" : "#fca5a5",
                  }}
                >
                  EDGE {Number(prop.edge) > 0 ? "+" : ""}{edgeDisplay}
                </span>
              ) : null}
              {lean === "Over" || lean === "Under" ? (
                <span style={{ ...styles.scoreBadge, ...leanBadgeStyle(lean) }}>
                  {lean.toUpperCase()}
                </span>
              ) : null}
              {hitChanceDisplay ? (
                <span style={{ ...styles.scoreBadge, borderColor: "#155e75", color: "#a5f3fc" }}>
                  HIT {hitChanceDisplay}
                </span>
              ) : null}
              {riskShort ? (
                <span style={{ ...styles.scoreBadge, ...manualRiskBadgeStyle(prop.riskLevel) }}>
                  RISK {riskShort}
                </span>
              ) : null}
              {(prop.positiveFlags || prop.smartFlags?.positive || []).slice(0, 1).map((flag) => (
                <span key={flag} style={{ ...styles.scoreBadge, borderColor: "#166534", color: "#86efac" }}>{flag}</span>
              ))}
            </div>
          </>
          )
        ) : (
          <>
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
              <span style={styles.metaLabel}>Side</span>
              <strong style={styles.metaValueStrong}>{lean}</strong>
            </span>
          </>
        )}
        {topPick && !compact && confDisplay != null ? (
          <p className="prop-meta-top-pick-inline">
            CONF {confDisplay}% {edgeDisplay != null ? `• EDGE ${edgeDisplay}` : ""} {riskShort ? `• RISK ${riskShort}` : ""}
          </p>
        ) : null}
        {!compact ? (
          <>
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
          </>
        ) : null}
        {!compact ? (
          <>
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
          </>
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
      {!compact ? (
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
      ) : null}
      {compact ? (
        <button type="button" className="prop-card-why-link" style={styles.whyLink} onClick={openDetails}>
          Tap for details
        </button>
      ) : (
        <div className="prop-card-why-link" style={styles.whyLink}>Why this pick?</div>
      )}
    </article>
  );
}

export default memo(PlayerPropCard);
