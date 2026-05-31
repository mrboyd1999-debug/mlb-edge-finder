import { memo, useEffect } from "react";
import PlayerImage from "./PlayerImage.jsx";
import { styles } from "../theme/styles.js";
import { formatNumber } from "../utils/formatters.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";
import {
  formatPlatformSideLabel,
  resolvePickSide,
} from "../utils/pickRecommendation.js";
import { displayFullMarketLabel } from "../utils/propLabels.js";
import { resolveProjectionValue } from "../utils/projectionQuality.js";
import { formatEdgeDisplay } from "../utils/conservativeProjection.js";
import { validatePickDirectionBeforeRender } from "../utils/pickDirectionAudit.js";
import { resolveRecommendedSide, resolveTierDisplayLabel } from "../utils/boardQuality.js";
import { resolveNormalizedConfidence, resolveNormalizedProbability } from "../utils/propDisplayFields.js";
import ProviderLabel from "./ProviderLabel.jsx";

function resolveLeanSideLabel(prop = {}, recommendedSide = "PASS") {
  if (recommendedSide === "UNDER") return "Lower";
  if (recommendedSide === "OVER") return "Higher";
  const lean = String(prop.lean || "").toLowerCase();
  if (/lower|less|under/.test(lean)) return "Lower";
  if (/higher|more|over/.test(lean)) return "Higher";
  return "Pass";
}

function formatMatchup(prop = {}) {
  const raw = String(prop.matchup || "").trim();
  if (raw) return raw.replace(/\s+vs\.?\s+/gi, " @ ");
  const team = prop.team || prop.playerTeam || "";
  const opponent = prop.opponent || prop.opponentTeam || "";
  if (team && opponent) return `${team} @ ${opponent}`;
  return team || opponent || "";
}

function resolveTierLabel(prop = {}) {
  const tier = String(prop.finalTier || prop.tier || "").toUpperCase();
  if (tier === "A") return "Elite";
  if (tier === "B") return "Best Play";
  if (tier === "C") return "Research";
  return prop.playCategoryLabel || resolveTierDisplayLabel(prop) || "Play";
}

function BestPlayRowCard({ prop, onOpen, rank, rankLabel, compact = false }) {
  const enriched = withPlayerImageUrl(prop || {});

  useEffect(() => {
    validatePickDirectionBeforeRender(prop, "BestPlayRowCard");
  }, [prop]);

  const recommendedSide = resolveRecommendedSide(enriched);
  const leanSideLabel = resolveLeanSideLabel(enriched, recommendedSide);
  const side = resolvePickSide(enriched);
  const sideLabel =
    recommendedSide === "PASS"
      ? side === "WATCH"
        ? "PASS"
        : formatPlatformSideLabel(enriched)
      : recommendedSide === "OVER"
        ? "Higher"
        : recommendedSide === "UNDER"
          ? "Lower"
          : recommendedSide;
  const playerName = enriched.playerName || enriched.player || "Unknown";
  const market = enriched.propType || enriched.statType || enriched.market || displayFullMarketLabel(enriched);
  const matchup = formatMatchup(enriched);
  const confidenceValue = resolveNormalizedConfidence(enriched);
  const confidenceLabel = confidenceValue != null ? `${confidenceValue}%` : "—";
  const probabilityValue = resolveNormalizedProbability(enriched);
  const probLabel = probabilityValue != null ? `${probabilityValue}%` : "—";
  const tierLabel = resolveTierLabel(enriched);
  const edgeLabels = enriched.rawEdgeLabel
    ? { displayEdgeLabel: enriched.displayEdgeLabel }
    : formatEdgeDisplay(enriched);
  const projection = resolveProjectionValue(enriched);
  const projectionLabel = projection != null && projection > 0 ? formatNumber(projection) : "—";
  const displayRankLabel = rankLabel || (rank != null ? `#${rank}` : null);
  const reasonText =
    enriched.qualificationReason ||
    enriched.cardDescription ||
    enriched.bestPlayFilterReason ||
    enriched.probabilityExplanation ||
    "";
  const ppLine = enriched.prizePicksLineLabel;
  const udLine = enriched.underdogLineLabel;
  const activeLine = enriched.activeLineLabel ?? (enriched.line != null ? formatNumber(enriched.line) : "—");

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(enriched);
  }

  return (
    <article
      className="best-play-row-card best-play-row-card--compact"
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
          <div className="best-play-row-top-line">
            {displayRankLabel ? <span style={styles.bestPlayRowRank}>{displayRankLabel}</span> : null}
            <h3 style={styles.bestPlayRowPlayer}>{playerName}</h3>
            {!compact ? (
              <span className={`best-play-row-tier best-play-row-tier--${String(enriched.tier || enriched.finalTier || "c").toLowerCase()}`}>
                {tierLabel}
              </span>
            ) : null}
          </div>
          <p style={styles.bestPlayRowSubline}>
            {matchup} · {market}
          </p>
          <p className="best-play-row-subline" style={{ marginTop: 2 }}>
            Recommended: <strong>{leanSideLabel !== "Pass" ? leanSideLabel : sideLabel}</strong>
            {ppLine ? <> · PrizePicks: <strong>{ppLine}</strong></> : null}
            {udLine ? <> · Underdog: <strong>{udLine}</strong></> : null}
            <> · Line Used: <strong>{activeLine}</strong></>
          </p>
          <ProviderLabel prop={enriched} compact />
          <div className="prop-card-core-metrics prop-card-core-metrics--mobile" style={{ marginTop: 6 }}>
            <span>
              Projection <strong>{projectionLabel}</strong>
            </span>
            <span>
              Probability <strong>{probLabel}</strong>
            </span>
            <span>
              Confidence <strong>{confidenceLabel}</strong>
            </span>
            <span>
              Edge <strong>{edgeLabels?.displayEdgeLabel ?? "—"}</strong>
            </span>
          </div>
          {reasonText ? (
            <p className="best-play-row-subline" style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
              {reasonText}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default memo(BestPlayRowCard);
