import { memo, useEffect } from "react";
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
import { formatHighestProbabilitySource } from "../utils/highestProbabilityPlays.js";
import { formatEdgeDisplay } from "../utils/conservativeProjection.js";
import { formatBestPlayProjectionSource } from "../utils/bestPlayExplanation.js";
import {
  formatHitRatePercent,
  validatePickDirectionBeforeRender,
} from "../utils/pickDirectionAudit.js";

function BestPlayRowCard({ prop, onOpen, rank, grouped = false }) {
  const enriched = withPlayerImageUrl(prop || {});

  useEffect(() => {
    validatePickDirectionBeforeRender(prop, "BestPlayRowCard");
  }, [prop]);

  const side = resolvePickSide(enriched);
  const sidePalette = recommendationPalette(side);
  const platform = formatHighestProbabilitySource(enriched);
  const playerName = enriched.playerName || enriched.player || "Unknown";
  const propType = enriched.propType || enriched.statType || enriched.market || displayFullMarketLabel(enriched);
  const line = formatNumber(enriched.line);
  const sideLabel = side === "WATCH" ? "PASS" : formatPlatformSideLabel(enriched);
  const probability = enriched.probabilityScore ?? enriched.verifiedProbability;
  const probLabel = Number.isFinite(Number(probability)) ? `${Math.round(Number(probability))}%` : "—";
  const confLabel =
    enriched.displayConfidenceScore != null
      ? `${enriched.displayConfidenceScore}%`
      : enriched.confidenceScore != null
        ? `${Math.round(Number(enriched.confidenceScore))}%`
        : "Unavailable";
  const edgeLabels = enriched.rawEdgeLabel
    ? { rawEdgeLabel: enriched.rawEdgeLabel, displayEdgeLabel: enriched.displayEdgeLabel }
    : formatEdgeDisplay(enriched);
  const statusLabel = enriched.pickTierLabel || enriched.bettingLabel || "Research Candidate";
  const tierLabel = enriched.verifiedTier ? `Tier ${enriched.verifiedTier}` : statusLabel;
  const rankingScore = enriched.topPickScore ?? enriched.verifiedRankingScore ?? enriched.weightedBestPlayScore;
  const rankingLabel = Number.isFinite(Number(rankingScore)) ? Number(rankingScore).toFixed(1) : "—";
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
    hitRates?.last5 != null ? hitRates.last5 / 100 : enriched.last5HitRate
  );
  const last10HitRate = formatHitRatePercent(
    hitRates?.last10 != null ? hitRates.last10 / 100 : enriched.last10HitRate ?? enriched.recentHitRate
  );
  const seasonHitRate = formatHitRatePercent(
    hitRates?.season != null ? hitRates.season / 100 : enriched.seasonHitRate
  );
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
  const reason = explanation?.reason || enriched.qualifyReason || enriched.whyThisPick || "";

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(enriched);
  }

  return (
    <article
      className={`best-play-row-card${grouped ? " best-play-row-card--grouped" : ""}`}
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
            {!grouped ? (
              <span
                style={{
                  ...styles.bestPlayPlatformBadge,
                  border: "1px solid #334155",
                  background: "#1e293b",
                  color: "#cbd5e1",
                }}
              >
                {platform}
              </span>
            ) : (
              <p style={{ ...styles.bestPlayRowSubline, margin: 0, fontWeight: 700 }}>{propType}</p>
            )}
          </div>
          {grouped ? (
            <p style={styles.bestPlayRowSubline}>Line {line}</p>
          ) : (
            <p style={styles.bestPlayRowSubline}>
              {propType} · Line {line}
            </p>
          )}
          <div className="prop-card-core-metrics" style={{ marginTop: 4 }}>
            <span>
              Proj <strong>{projectionLabel}</strong>
            </span>
            <span>
              Lean <strong>{lean}</strong>
            </span>
            <span>
              Prob <strong>{probLabel}</strong>
            </span>
            <span>
              Conf <strong>{confLabel}</strong>
            </span>
            <span>
              Edge <strong>{edgeLabels.displayEdgeLabel}</strong>
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
          {isVerifiedPlay ? (
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
            <div className="probability-audit" aria-label="Probability audit">
              <p className="probability-audit__title">Probability inputs</p>
              <p style={{ ...styles.bestPlayRowSubline, color: "#cbd5e1", marginTop: 2, fontSize: 11 }}>
                Last 10: <strong>{probabilityAudit.last10HitRate}</strong>
                {" · "}
                Season: <strong>{probabilityAudit.seasonHitRate}</strong>
                {" · "}
                Proj vs Line: <strong>{probabilityAudit.projectionVsLine}</strong>
                {" · "}
                Opponent: <strong>{probabilityAudit.opponentAdjustment}</strong>
                {" · "}
                Park: <strong>{probabilityAudit.parkAdjustment}</strong>
              </p>
              {probabilityAudit.finalProbability != null ? (
                <p style={{ ...styles.bestPlayRowSubline, color: "#e2e8f0", marginTop: 2, fontSize: 11 }}>
                  {probabilityAudit.explanationLines?.map((line, index) => (
                    <span key={line}>
                      {index ? " · " : ""}
                      {line}
                    </span>
                  ))}
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
          {rankingReason ? (
            <p style={{ ...styles.bestPlayRowSubline, color: "#e2e8f0", marginTop: 4, fontSize: 11 }}>
              {rankingReason}
            </p>
          ) : null}
          {reason && reason !== rankingReason ? (
            <p style={{ ...styles.bestPlayRowSubline, color: "#e2e8f0", marginTop: 4, fontSize: 11 }}>
              Reason: {reason}
            </p>
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
          {sideLabel}
        </div>
        <button type="button" className="prop-card-why-link" style={styles.whyLink} onClick={openDetails}>
          View Details
        </button>
      </div>
    </article>
  );
}

export default memo(BestPlayRowCard);
