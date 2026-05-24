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
import { displayFullMarketLabel, displaySport } from "../utils/propLabels.js";
import { readPropMultiplier, readPropProbability } from "../utils/bestPlayRanking.js";

function BestPlayRowCard({ prop, onOpen, rank }) {
  const enriched = withPlayerImageUrl(prop || {});
  const side = resolvePickSide(enriched);
  const sidePalette = recommendationPalette(side);
  const platform = normalizeSourceLabel(enriched);
  const platformPalette = platformBadgePalette(platform);
  const playerName = enriched.playerName || enriched.player || "Unknown";
  const sport = displaySport(enriched) || "MLB";
  const market = displayFullMarketLabel(enriched);
  const line = formatNumber(enriched.line);
  const sideLabel = formatPlatformSideLabel(enriched);
  const multiplier = readPropMultiplier(enriched);
  const probability = readPropProbability(enriched);
  const edge = Number(enriched.edge ?? enriched.projectionEdge);
  const edgeLabel = Number.isFinite(edge) ? formatSignedNumber(edge) : "—";
  const reason =
    enriched.reason ||
    enriched.analyticsReason ||
    enriched.premiumWhySummary ||
    enriched.whyThisPick?.compact ||
    enriched.confidenceExplanation ||
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
            {sport} · {market} · Line {line}
          </p>
          <p style={styles.bestPlayRowReason}>{reason || "Model-ranked best play."}</p>
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
        <span style={styles.bestPlayMetric}>Payout {multiplier != null ? `${multiplier.toFixed(2)}x` : "—"}</span>
        <span style={styles.bestPlayMetric}>Prob {probability != null ? `${probability}%` : "—"}</span>
        <span style={styles.bestPlayMetric}>Edge {edgeLabel}</span>
      </div>
    </article>
  );
}

export default memo(BestPlayRowCard);
