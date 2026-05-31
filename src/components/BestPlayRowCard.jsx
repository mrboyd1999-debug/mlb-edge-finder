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

function BestPlayRowCard({ prop, onOpen, rank }) {
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
  const line = formatNumber(enriched.line);
  const confidenceValue = resolveNormalizedConfidence(enriched);
  const confidenceLabel = confidenceValue != null ? `${confidenceValue}%` : "—";
  const probabilityValue = resolveNormalizedProbability(enriched);
  const probLabel = probabilityValue != null ? `${probabilityValue}%` : "—";
  const tierLabel = resolveTierDisplayLabel(enriched);
  const riskLevel = String(enriched.riskLevel || "HIGH").toUpperCase();
  const edgeLabels = enriched.rawEdgeLabel
    ? { displayEdgeLabel: enriched.displayEdgeLabel }
    : formatEdgeDisplay(enriched);
  const projection = resolveProjectionValue(enriched);
  const projectionLabel = projection != null && projection > 0 ? formatNumber(projection) : "—";

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
            {rank != null ? <span style={styles.bestPlayRowRank}>#{rank}</span> : null}
            <h3 style={styles.bestPlayRowPlayer}>{playerName}</h3>
            <span className={`best-play-row-tier best-play-row-tier--${String(enriched.tier || enriched.finalTier || "c").toLowerCase()}`}>
              {tierLabel}
            </span>
          </div>
          <p style={styles.bestPlayRowSubline}>
            {matchup} · {market} · Line {line}
          </p>
          <ProviderLabel prop={enriched} compact />
          {enriched.cardDescription ? (
            <p className="best-play-row-description">{enriched.cardDescription}</p>
          ) : null}
          <div className="prop-card-core-metrics prop-card-core-metrics--mobile" style={{ marginTop: 4 }}>
            <span>
              Side <strong>{leanSideLabel !== "Pass" ? leanSideLabel : sideLabel}</strong>
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
            <span>
              Risk <strong>{riskLevel}</strong>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

export default memo(BestPlayRowCard);
