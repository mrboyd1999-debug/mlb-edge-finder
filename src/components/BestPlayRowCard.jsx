import { memo, useEffect, useState } from "react";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import PlayerImage from "./PlayerImage.jsx";
import { styles } from "../theme/styles.js";
import { formatNumber } from "../utils/formatters.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";
import {
  formatPlatformSideLabel,
  recommendationPalette,
  resolvePickSide,
} from "../utils/pickRecommendation.js";
import { displayFullMarketLabel } from "../utils/propLabels.js";
import { resolveProjectionValue } from "../utils/projectionQuality.js";
import { formatEdgeDisplay } from "../utils/conservativeProjection.js";
import { formatBestPlayProjectionSource } from "../utils/bestPlayExplanation.js";
import {
  formatHitRatePercent,
  validatePickDirectionBeforeRender,
} from "../utils/pickDirectionAudit.js";
import { resolveRecommendedSide } from "../utils/boardQuality.js";
import { resolveSeasonHitRateBundle } from "../utils/seasonHitRate.js";
import ProjectionSanityAuditPanel from "./ProjectionSanityAuditPanel.jsx";
import DataSourceTag from "./DataSourceTag.jsx";
import { safeArray, safeFixed } from "../utils/safeStats.js";

function resolveLeanSideLabel(prop = {}, recommendedSide = "PASS") {
  if (recommendedSide === "UNDER") return "Lower";
  if (recommendedSide === "OVER") return "Higher";
  const lean = String(prop.lean || "").toLowerCase();
  if (/lower|less|under/.test(lean)) return "Lower";
  if (/higher|more|over/.test(lean)) return "Higher";
  return "Pass";
}

function BestPlayRowCard({
  prop,
  onOpen,
  rank,
  grouped = false,
  cacheStatus = "",
  cardVariant = "default",
}) {
  const [auditOpen, setAuditOpen] = useState(false);
  const enriched = withPlayerImageUrl(prop || {});

  useEffect(() => {
    validatePickDirectionBeforeRender(prop, "BestPlayRowCard");
  }, [prop]);

  const side = resolvePickSide(enriched);
  const sidePalette = recommendationPalette(side);
  const playerName = enriched.playerName || enriched.player || "Unknown";
  const teamLabel = enriched.team || enriched.teamAbbr || "—";
  const propType = enriched.propType || enriched.statType || enriched.market || displayFullMarketLabel(enriched);
  const line = formatNumber(enriched.line);
  const recommendedSide = resolveRecommendedSide(enriched);
  const leanSideLabel = resolveLeanSideLabel(enriched, recommendedSide);
  const sideLabel =
    recommendedSide === "PASS"
      ? side === "WATCH"
        ? "PASS"
        : formatPlatformSideLabel(enriched)
      : recommendedSide;
  const probability = enriched.probabilityScore ?? enriched.verifiedProbability ?? 0;
  const probLabel = Number.isFinite(Number(probability)) ? `${Math.round(Number(probability))}%` : "—";
  const confidenceTier = enriched.confidenceTierLabel || (enriched.confidenceTier ? `Tier ${enriched.confidenceTier}` : "—");
  const displayConfidenceScore = enriched.displayConfidenceScore ?? enriched.confidenceScore ?? enriched.confidence;
  const confidenceLabel = Number.isFinite(Number(displayConfidenceScore))
    ? `${Math.round(Number(displayConfidenceScore))}%`
    : "—";
  const edgeLabels = enriched.rawEdgeLabel
    ? { rawEdgeLabel: enriched.rawEdgeLabel, displayEdgeLabel: enriched.displayEdgeLabel }
    : formatEdgeDisplay(enriched);
  const statusLabel = enriched.pickTierLabel || enriched.bettingLabel || "Research Candidate";
  const tierLabel = enriched.verifiedTier ? `Tier ${enriched.verifiedTier}` : statusLabel;
  const rankingScore = enriched.topPickScore ?? enriched.verifiedRankingScore ?? enriched.weightedBestPlayScore;
  const rankingLabel = Number.isFinite(Number(rankingScore)) ? safeFixed(rankingScore, 1) : "—";
  const playabilityLabel = Number.isFinite(Number(enriched.playabilityScore))
    ? `${Math.round(Number(enriched.playabilityScore))}`
    : "—";
  const rankingReason = enriched.rankingReason || enriched.topPickRankingReason || "";
  const projection = resolveProjectionValue(enriched);
  const projectionLabel = projection != null && projection > 0 ? formatNumber(projection) : "—";
  const lean = enriched.lean || "Pass";
  const explanation = enriched.verifiedPlayExplanation;
  const hitRates = enriched.hitRateSnapshot || explanation?.hitRates;
  const last5HitRate = formatHitRatePercent(
    hitRates?.last5 != null ? hitRates.last5 / 100 : enriched.last5HitRate ?? 0
  );
  const last10HitRate = formatHitRatePercent(
    hitRates?.last10 != null
      ? hitRates.last10 / 100
      : enriched.last10HitRate ?? enriched.recentHitRate ?? 0
  );
  const seasonBundle = resolveSeasonHitRateBundle(enriched);
  const seasonHitRate = seasonBundle.displayLabel;
  const isVerifiedPlay = Boolean(
    enriched.verified || enriched.verifiedTier || enriched.pickTierLabel === "Verified Play"
  );
  const probabilityAudit = enriched.probabilityAudit || explanation?.probabilityAudit;
  const edgeValidation = enriched.edgeValidation;
  const matchupAudit = enriched.matchupAudit;
  const projectionSource =
    explanation?.projectionSource ||
    enriched.projectionSourceLabel ||
    formatBestPlayProjectionSource(enriched);
  const statsLine = explanation?.statsLine || "";
  const projectionSanityAudit = enriched.projectionSanityAudit;
  const projectionFormulaAudit = enriched.projectionFormulaAudit;
  const playabilityBreakdown = enriched.playabilityBreakdown ?? enriched.playabilityAudit;
  const projectionValidation =
    enriched.projectionValidation || enriched.projectionSanityAudit?.marketValidation || null;
  const projectionOutlierWarning =
    enriched.projectionOutlierWarning ||
    projectionValidation?.outlierWarning ||
    enriched.projectionSanityAudit?.outlierWarning ||
    "";
  const projectionValidationConfidence =
    enriched.projectionValidationConfidence ||
    projectionValidation?.projectionConfidence ||
    enriched.projectionSanityAudit?.projectionValidationConfidence;
  const projectionRisk =
    enriched.projectionRisk ||
    projectionValidation?.projectionRisk ||
    enriched.projectionSanityAudit?.projectionRisk;
  const filterReason = enriched.bestPlayFilterReason || enriched.bestPlayExclusionReason || "";
  const reason =
    explanation?.reason ||
    enriched.qualifyReason ||
    enriched.whyThisPick ||
    enriched.marketContext ||
    rankingReason ||
    "";
  const hasAuditDetails = Boolean(
    probabilityAudit ||
      edgeValidation ||
      matchupAudit ||
      statsLine ||
      rankingReason ||
      projectionSanityAudit?.supported ||
      projectionFormulaAudit ||
      playabilityBreakdown ||
      isVerifiedPlay
  );
  const isValueUnder = cardVariant === "valueUnder";

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(enriched);
  }

  function toggleAudit(event) {
    event?.stopPropagation?.();
    setAuditOpen((open) => !open);
  }

  return (
    <article
      className={`best-play-row-card best-play-row-card--compact${grouped ? " best-play-row-card--grouped" : ""}${
        isValueUnder ? " best-play-row-card--value-under" : ""
      }`}
      style={styles.bestPlayRowCard}
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
      <div className="best-play-row-left" style={styles.bestPlayRowLeft}>
        {!grouped ? <PlayerImage prop={enriched} /> : null}
        <div style={styles.bestPlayRowMeta}>
          <div className="best-play-row-top-line">
            {rank != null ? <span style={styles.bestPlayRowRank}>#{rank}</span> : null}
            {!grouped ? <h3 style={styles.bestPlayRowPlayer}>{playerName}</h3> : null}
            {!grouped ? <span className="best-play-row-team">{teamLabel}</span> : null}
            {!grouped ? <DataSourceTag prop={enriched} cacheStatus={cacheStatus} compact /> : null}
          </div>
          {grouped ? (
            <p style={styles.bestPlayRowSubline}>Line {line}</p>
          ) : (
            <p style={styles.bestPlayRowSubline}>
              {propType} · Line {line}
            </p>
          )}
          <div className="prop-card-core-metrics prop-card-core-metrics--mobile" style={{ marginTop: 4 }}>
            <span>
              Projection <strong>{projectionLabel}</strong>
            </span>
            <span>
              {isValueUnder ? "Side" : "Higher/Lower"} <strong>{leanSideLabel}</strong>
            </span>
            <span>
              Confidence <strong>{confidenceLabel}</strong>
            </span>
            <span>
              Probability <strong>{probLabel}</strong>
            </span>
            <span>
              Tier <strong>{confidenceTier}</strong>
            </span>
          </div>
          {isValueUnder && reason ? (
            <p className="best-play-row-reason" style={{ ...styles.bestPlayRowSubline, marginTop: 4, fontSize: 11 }}>
              Reason: <strong>{reason}</strong>
            </p>
          ) : null}
          {filterReason ? (
            <p className="best-play-row-filter-reason" style={{ ...styles.bestPlayRowSubline, marginTop: 4, fontSize: 11 }}>
              {filterReason}
            </p>
          ) : null}
          {projectionOutlierWarning ? (
            <p
              className="best-play-row-outlier-warning"
              style={{ ...styles.bestPlayRowSubline, marginTop: 4, fontSize: 11, color: "#fbbf24" }}
            >
              {projectionOutlierWarning}
              {projectionValidationConfidence ? ` · Confidence ${projectionValidationConfidence}` : ""}
              {projectionRisk ? ` · Risk ${projectionRisk}` : ""}
            </p>
          ) : null}
          {hasAuditDetails ? (
            <div className="best-play-audit-toggle-wrap">
              <button
                type="button"
                className="best-play-audit-toggle"
                aria-expanded={auditOpen}
                onClick={toggleAudit}
              >
                {auditOpen ? "Hide Audit" : "Show Audit"}
              </button>
            </div>
          ) : null}
          {auditOpen ? (
            <div className="best-play-audit-panel" onClick={(event) => event.stopPropagation()}>
              <div className="prop-card-core-metrics prop-card-core-metrics--audit">
                <span>
                  Edge <strong>{edgeLabels?.displayEdgeLabel ?? "—"}</strong>
                </span>
                <span>
                  Lean <strong>{lean}</strong>
                </span>
                <span>
                  Play <strong>{playabilityLabel}</strong>
                </span>
                <span>
                  Score <strong>{rankingLabel}</strong>
                </span>
                <span>
                  Status <strong>{tierLabel}</strong>
                </span>
              </div>
              <p style={{ ...styles.bestPlayRowSubline, color: "#94a3b8", marginTop: 4, fontSize: 11 }}>
                Projection Source: <strong>{projectionSource}</strong>
              </p>
              {projectionSanityAudit?.supported ? (
                <SectionErrorBoundary name="Projection Sanity">
                  <ProjectionSanityAuditPanel audit={projectionSanityAudit} compact />
                </SectionErrorBoundary>
              ) : null}
              {projectionFormulaAudit ? (
                <p style={{ ...styles.bestPlayRowSubline, color: "#94a3b8", marginTop: 4, fontSize: 10 }}>
                  Formula: {projectionFormulaAudit.formulaPath || projectionFormulaAudit.formula || "—"}
                  {projectionFormulaAudit.projectionFormulaErrorReason
                    ? ` · ${projectionFormulaAudit.projectionFormulaErrorReason}`
                    : ""}
                </p>
              ) : null}
              {playabilityBreakdown ? (
                <p style={{ ...styles.bestPlayRowSubline, color: "#94a3b8", marginTop: 4, fontSize: 10 }}>
                  Playability {playabilityLabel} · Confidence {playabilityBreakdown.confidence ?? "—"} · Reliability{" "}
                  {playabilityBreakdown.reliabilityComponent ?? playabilityBreakdown.projectionComponent ?? "—"} ·
                  Completeness {playabilityBreakdown.completenessComponent ?? playabilityBreakdown.historicalComponent ?? "—"}
                </p>
              ) : null}
              {isVerifiedPlay && !projectionSanityAudit?.supported ? (
                <div className="hit-rate-viz" aria-label="Hit rate snapshot">
                  <span>
                    Last 5: <strong>{last5HitRate}</strong>
                  </span>
                  <span>
                    Last 10: <strong>{last10HitRate}</strong>
                  </span>
                  <span>
                    Season: <strong>{seasonHitRate}</strong>
                  </span>
                </div>
              ) : null}
              {probabilityAudit ? (
                <div className="probability-audit" aria-label="Probability breakdown">
                  <p className="probability-audit__title">Probability Breakdown</p>
                  {probabilityAudit.historicalDataWarning ? (
                    <p className="probability-audit__warning">{probabilityAudit.historicalDataWarning}</p>
                  ) : null}
                  <p style={{ ...styles.bestPlayRowSubline, color: "#cbd5e1", marginTop: 2, fontSize: 11 }}>
                    Recent: <strong>{probabilityAudit.recentHitRate ?? probabilityAudit.last10HitRate ?? hitRates?.last10Label ?? last10HitRate}</strong>
                    {" · "}
                    Season: <strong>{seasonHitRate !== "0%" ? seasonHitRate : hitRates?.seasonLabel ?? seasonHitRate}</strong>
                    {" · "}
                    Edge: <strong>{probabilityAudit.projectionEdge ?? probabilityAudit.edgeContribution ?? "—"}</strong>
                    {" · "}
                    Confidence: <strong>{probabilityAudit.confidence ?? confidenceLabel}</strong>
                    {" · "}
                    Playability: <strong>{probabilityAudit.playability ?? playabilityLabel}</strong>
                  </p>
                  {probabilityAudit.rawProbability != null || probabilityAudit.calibratedProbability != null ? (
                    <p style={{ ...styles.bestPlayRowSubline, color: "#94a3b8", marginTop: 2, fontSize: 10 }}>
                      Raw: <strong>{probabilityAudit.rawProbability != null ? `${probabilityAudit.rawProbability}%` : "—"}</strong>
                      {" · "}
                      Calibrated:{" "}
                      <strong>
                        {probabilityAudit.calibratedProbability != null
                          ? `${probabilityAudit.calibratedProbability}%`
                          : probabilityAudit.finalProbability != null
                            ? `${Math.round(Number(probabilityAudit.finalProbability))}%`
                            : "—"}
                      </strong>
                      {probabilityAudit.probabilityTier ? (
                        <>
                          {" · "}
                          Tier: <strong>{probabilityAudit.probabilityTier}</strong>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {probabilityAudit.finalProbability != null ? (
                    <p style={{ ...styles.bestPlayRowSubline, color: "#e2e8f0", marginTop: 2, fontSize: 11 }}>
                      Final Probability: <strong>{Math.round(Number(probabilityAudit.finalProbability))}%</strong>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {edgeValidation ? (
                <p style={{ ...styles.bestPlayRowSubline, color: "#94a3b8", marginTop: 4, fontSize: 10 }}>
                  {edgeValidation.formula} → {edgeValidation.substitution}
                  {edgeValidation.unusuallyLarge ? " · Large edge — verify line scale." : ""}
                </p>
              ) : null}
              {matchupAudit ? (
                <p style={{ ...styles.bestPlayRowSubline, color: "#94a3b8", marginTop: 4, fontSize: 10 }}>
                  Matchup: {matchupAudit.team} vs {matchupAudit.opponent} · Pitcher {matchupAudit.pitcher} · Venue{" "}
                  {matchupAudit.venue} · Score {matchupAudit.matchupScore ?? "—"}
                </p>
              ) : null}
              {statsLine ? (
                <p style={{ ...styles.bestPlayRowSubline, color: "#cbd5e1", marginTop: 4, fontSize: 11 }}>
                  {statsLine}
                </p>
              ) : null}
              {!isValueUnder && rankingReason ? (
                <p style={{ ...styles.bestPlayRowSubline, color: "#e2e8f0", marginTop: 4, fontSize: 11 }}>
                  {rankingReason}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="best-play-row-metrics" style={styles.bestPlayRowMetrics}>
        <div
          style={{
            ...styles.bestPlaySideBadge,
            border: `1px solid ${sidePalette.border}`,
            background: sidePalette.bannerBg,
            color: sidePalette.bannerText,
          }}
        >
          {isValueUnder ? leanSideLabel : sideLabel}
        </div>
        <button type="button" className="prop-card-why-link" style={styles.whyLink} onClick={openDetails}>
          Details
        </button>
      </div>
    </article>
  );
}

export default memo(BestPlayRowCard);
