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
import { highestProbabilityLabel, isConfidenceAvailable } from "../utils/conservativeProjection.js";

function BestPlayRowCard({ prop, onOpen, rank }) {
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
  const confRaw = enriched.confidenceScore ?? enriched.confidence;
  const confLabel = isConfidenceAvailable(enriched)
    ? Number.isFinite(Number(confRaw))
      ? `${Math.round(Number(confRaw))}%`
      : "—"
    : "Unavailable";
  const edgePct = Number(enriched.edgePercent);
  const edgeLabel = Number.isFinite(edgePct) ? `${edgePct > 0 ? "+" : ""}${Math.round(edgePct)}%` : "—";
  const pickLabel = highestProbabilityLabel(enriched);
  const statusLabel = enriched.pickTierLabel || enriched.bettingLabel || pickLabel;
  const projection = resolveProjectionValue(enriched);
  const projectionLabel = projection != null && projection > 0 ? formatNumber(projection) : "—";
  const lean = enriched.lean || sideLabel;

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(enriched);
  }

  return (
    <article
      className="best-play-row-card"
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
        <PlayerImage prop={enriched} />
        <div style={styles.bestPlayRowMeta}>
          <div style={styles.bestPlayRowTopLine}>
            {rank != null ? <span style={styles.bestPlayRowRank}>#{rank}</span> : null}
            <h3 style={styles.bestPlayRowPlayer}>{playerName}</h3>
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
          </div>
          <p style={styles.bestPlayRowSubline}>
            {propType} · Line {line}
          </p>
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
              Edge <strong>{edgeLabel}</strong>
            </span>
            <span>
              Status <strong>{statusLabel}</strong>
            </span>
          </div>
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
