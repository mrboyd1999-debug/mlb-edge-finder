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
import { formatEdgeDisplay } from "../utils/conservativeProjection.js";
import { validatePickDirectionBeforeRender } from "../utils/pickDirectionAudit.js";
import { resolveRecommendedSide, resolveFinalTier } from "../utils/boardQuality.js";

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
  cardVariant = "default",
}) {
  const enriched = withPlayerImageUrl(prop || {});

  useEffect(() => {
    validatePickDirectionBeforeRender(prop, "BestPlayRowCard");
  }, [prop]);

  const side = resolvePickSide(enriched);
  const sidePalette = recommendationPalette(side);
  const playerName = enriched.playerName || enriched.player || "Unknown";
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
  const tierLabel = `Tier ${resolveFinalTier(enriched)}`;
  const displayConfidenceScore = enriched.displayConfidenceScore ?? enriched.confidenceScore ?? enriched.confidence;
  const confidenceLabel = Number.isFinite(Number(displayConfidenceScore))
    ? `${Math.round(Number(displayConfidenceScore))}%`
    : "—";
  const edgeLabels = enriched.rawEdgeLabel
    ? { rawEdgeLabel: enriched.rawEdgeLabel, displayEdgeLabel: enriched.displayEdgeLabel }
    : formatEdgeDisplay(enriched);
  const projection = resolveProjectionValue(enriched);
  const projectionLabel = projection != null && projection > 0 ? formatNumber(projection) : "—";
  const isValueUnder = cardVariant === "valueUnder";

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(enriched);
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
              Tier <strong>{tierLabel}</strong>
            </span>
            <span>
              {isValueUnder ? "Side" : "Side"} <strong>{isValueUnder ? leanSideLabel : sideLabel}</strong>
            </span>
            <span>
              Projection <strong>{projectionLabel}</strong>
            </span>
            <span>
              Edge <strong>{edgeLabels?.displayEdgeLabel ?? "—"}</strong>
            </span>
            <span>
              Probability <strong>{probLabel}</strong>
            </span>
            <span>
              Confidence <strong>{confidenceLabel}</strong>
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
