import { memo } from "react";
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

function BestPlayRowCard({ prop, onOpen, rank, grouped = false }) {
  const enriched = withPlayerImageUrl(prop || {});
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
  const rankingScore = enriched.verifiedRankingScore ?? enriched.weightedBestPlayScore;
  const rankingLabel = Number.isFinite(Number(rankingScore)) ? Number(rankingScore).toFixed(1) : "—";
  const projection = resolveProjectionValue(enriched);
  const projectionLabel = projection != null && projection > 0 ? formatNumber(projection) : "—";
  const lean = enriched.lean || sideLabel;
  const explanation = enriched.verifiedPlayExplanation;
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
              Rank <strong>{rankingLabel}</strong>
            </span>
            <span>
              Status <strong>{tierLabel}</strong>
            </span>
          </div>
          <p style={{ ...styles.bestPlayRowSubline, color: "#94a3b8", marginTop: 4, fontSize: 11 }}>
            Projection Source: <strong>{projectionSource}</strong>
          </p>
          {statsLine ? (
            <p style={{ ...styles.bestPlayRowSubline, color: "#cbd5e1", marginTop: 4, fontSize: 11 }}>
              {statsLine}
            </p>
          ) : null}
          {reason ? (
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
