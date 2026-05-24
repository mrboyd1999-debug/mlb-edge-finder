import { memo } from "react";
import PlayerImage from "./PlayerImage.jsx";
import { styles } from "../theme/styles.js";
import { formatNumber, formatSignedNumber } from "../utils/formatters.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";
import {
  formatPlatformSideLabel,
  normalizeSourceLabel,
  platformBadgePalette,
  recommendationPalette,
  resolvePickSide,
} from "../utils/pickRecommendation.js";
import { displayFullMarketLabel } from "../utils/propLabels.js";
import { enrichPropWithSideEvaluation } from "../utils/sideEvaluationEngine.js";
import { resolveProjectionSourceLabel } from "../utils/projectionQuality.js";

function BestPlayRowCard({ prop, onOpen, rank }) {
  const enriched = withPlayerImageUrl(enrichPropWithSideEvaluation(prop || {}));
  const side = resolvePickSide(enriched);
  const sidePalette = recommendationPalette(side);
  const platform = normalizeSourceLabel(enriched);
  const platformPalette = platformBadgePalette(platform);
  const playerName = enriched.playerName || enriched.player || "Unknown";
  const market = displayFullMarketLabel(enriched);
  const propType = enriched.propType || enriched.statType || enriched.market || market;
  const line = formatNumber(enriched.line);
  const sideLabel = formatPlatformSideLabel(enriched);
  const evaluation = enriched.sideEvaluation || {};
  const edge = evaluation.edge ?? enriched.edge ?? null;
  const edgeLabel = edge != null && Number(edge) !== 0 ? formatSignedNumber(edge) : "—";
  const confidence = evaluation.confidence ?? enriched.confidenceScore ?? enriched.confidence;
  const confidenceLabel =
    enriched.displayResearchOnly || enriched.projectionLabel === "No projection data available"
      ? "Research Only"
      : enriched.confidenceTier || enriched.bettingLabel || "Research Only";
  const projectionSource = enriched.projectionSourceLabel || resolveProjectionSourceLabel(enriched);
  const reason =
    evaluation.reason ||
    enriched.reason ||
    enriched.analyticsReason ||
    enriched.premiumWhySummary ||
    enriched.whyThisPick?.compact ||
    "";

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
                border: `1px solid ${platformPalette.border}`,
                background: platformPalette.bg,
                color: platformPalette.color,
              }}
            >
              {platformPalette.label}
            </span>
          </div>
          <p style={styles.bestPlayRowSubline}>
            {platformPalette.label} · {propType} · Line {line}
          </p>
          <p style={styles.bestPlayRowReason}>{reason || "Model-ranked MLB play."}</p>
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
        <span style={styles.bestPlayMetric}>
          Conf {confidence != null ? `${Math.round(confidence)}%` : "—"} · {confidenceLabel}
        </span>
        <span style={styles.bestPlayMetric}>Edge {edgeLabel}</span>
        <span style={styles.bestPlayMetric}>Proj {projectionSource}</span>
      </div>
    </article>
  );
}

export default memo(BestPlayRowCard);
