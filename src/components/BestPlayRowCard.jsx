import { memo } from "react";
import PlayerImage from "./PlayerImage.jsx";
import { styles } from "../theme/styles.js";
import { formatNumber, formatSignedNumber } from "../utils/formatters.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";
import {
  formatPlatformSideLabel,
  recommendationPalette,
  resolvePickSide,
} from "../utils/pickRecommendation.js";
import { displayFullMarketLabel } from "../utils/propLabels.js";
import { resolveProjectionValue } from "../utils/projectionQuality.js";
import {
  buildHighestProbabilityQualifyReason,
  formatHighestProbabilitySource,
} from "../utils/highestProbabilityPlays.js";

function BestPlayRowCard({ prop, onOpen, rank }) {
  const enriched = withPlayerImageUrl(prop || {});
  const side = resolvePickSide(enriched);
  const sidePalette = recommendationPalette(side);
  const platform = formatHighestProbabilitySource(enriched);
  const playerName = enriched.playerName || enriched.player || "Unknown";
  const propType = enriched.propType || enriched.statType || enriched.market || displayFullMarketLabel(enriched);
  const line = formatNumber(enriched.line);
  const sideLabel = side === "WATCH" ? "PASS" : formatPlatformSideLabel(enriched);
  const edge = enriched.edge ?? null;
  const edgeLabel = Number.isFinite(Number(edge)) && Number(edge) >= 0.5 ? formatSignedNumber(edge) : "—";
  const confidence = enriched.confidenceScore ?? enriched.confidence;
  const confLabel = Number.isFinite(Number(confidence)) && Number(confidence) >= 65 ? `${Math.round(Number(confidence))}%` : "—";
  const projection = resolveProjectionValue(enriched);
  const projectionLabel = projection != null && projection > 0 ? formatNumber(projection) : "—";
  const qualifyReason = buildHighestProbabilityQualifyReason(enriched);

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
            {propType} · Line {line} · Lean {sideLabel} · Proj {projectionLabel}
          </p>
          {qualifyReason ? (
            <p style={{ ...styles.bestPlayRowSubline, color: "#94a3b8", marginTop: 2 }}>{qualifyReason}</p>
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
        <span style={styles.bestPlayMetric} title="Confidence">
          {confLabel}
        </span>
        <span style={styles.bestPlayMetric} title="Edge">
          {edgeLabel !== "—" ? `+${edgeLabel}` : "—"}
        </span>
      </div>
    </article>
  );
}

export default memo(BestPlayRowCard);
