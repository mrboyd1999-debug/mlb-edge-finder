import { memo } from "react";
import PlayerImage from "./PlayerImage.jsx";
import DataSourceTag from "./DataSourceTag.jsx";
import { styles } from "../theme/styles.js";
import { formatNumber } from "../utils/formatters.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";
import { formatPlatformSideLabel, recommendationPalette, resolvePickSide } from "../utils/pickRecommendation.js";
import { displayFullMarketLabel } from "../utils/propLabels.js";
import { resolveProjectionValue } from "../utils/projectionQuality.js";

function BestPlayHeroCard({ prop, onOpen, cacheStatus = "" }) {
  if (!prop) return null;

  const enriched = withPlayerImageUrl(prop);
  const side = resolvePickSide(enriched);
  const sidePalette = recommendationPalette(side);
  const playerName = enriched.playerName || enriched.player || "Unknown";
  const propType = enriched.propType || enriched.statType || enriched.market || displayFullMarketLabel(enriched);
  const line = formatNumber(enriched.line);
  const projection = resolveProjectionValue(enriched);
  const projectionLabel = projection != null && projection > 0 ? formatNumber(projection) : "—";
  const probability = enriched.probabilityScore ?? enriched.verifiedProbability ?? 0;
  const probLabel = Number.isFinite(Number(probability)) ? `${Math.round(Number(probability))}%` : "—";
  const confLabel =
    enriched.displayConfidenceScore != null
      ? `${Math.round(Number(enriched.displayConfidenceScore))}%`
      : enriched.confidenceScore != null
        ? `${Math.round(Number(enriched.confidenceScore))}%`
        : "—";
  const sideLabel = side === "WATCH" ? "PASS" : formatPlatformSideLabel(enriched);
  const outlierFlag =
    enriched.projectionOutlierFlag ||
    enriched.projectionSanityAudit?.outlierWarning ||
    enriched.projectionMismatchFlag ||
    "";
  const reason =
    enriched.verifiedPlayExplanation?.reason ||
    enriched.qualifyReason ||
    enriched.whyThisPick ||
    enriched.rankingReason ||
    enriched.marketContext ||
    "Top combined score across probability, confidence, playability, and edge.";

  function openDetails() {
    onOpen?.(enriched);
  }

  return (
    <article
      className="best-play-hero-card"
      style={styles.bestPlayHeroCard}
      role="button"
      tabIndex={0}
      onClick={openDetails}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetails();
        }
      }}
    >
      <p className="best-play-hero-card__eyebrow">
        #1 Overall Play{outlierFlag ? ` · ${outlierFlag}` : ""}
      </p>
      <DataSourceTag prop={enriched} cacheStatus={cacheStatus} compact />
      <div className="best-play-hero-card__head">
        <PlayerImage prop={enriched} />
        <div>
          <h2 className="best-play-hero-card__player">{playerName}</h2>
          <p className="best-play-hero-card__prop">
            {propType} · Line {line} · Proj {projectionLabel}
          </p>
        </div>
        <span className="best-play-hero-card__side" style={sidePalette}>
          {sideLabel}
        </span>
      </div>
      <div className="best-play-hero-card__metrics">
        <div>
          <span className="best-play-hero-card__metric-label">Probability</span>
          <strong>{probLabel}</strong>
        </div>
        <div>
          <span className="best-play-hero-card__metric-label">Confidence</span>
          <strong>{confLabel}</strong>
        </div>
        <div>
          <span className="best-play-hero-card__metric-label">Recommended Side</span>
          <strong>{sideLabel}</strong>
        </div>
      </div>
      <p className="best-play-hero-card__reason">{reason}</p>
    </article>
  );
}

export default memo(BestPlayHeroCard);
