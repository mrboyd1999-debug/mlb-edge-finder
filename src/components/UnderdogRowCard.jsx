import { memo } from "react";
import PlayerImage from "./PlayerImage.jsx";
import { styles } from "../theme/styles.js";
import { formatNumber } from "../utils/formatters.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";
import {
  buildUnderdogRowViewModel,
  formatUnderdogMultiplier,
} from "../utils/underdogRowCard.js";

function SideButton({ label, multiplier, probability, active, onClick }) {
  return (
    <button
      type="button"
      className={`underdog-side-btn${active ? " underdog-side-btn-active" : ""}`}
      style={{
        ...styles.underdogSideBtn,
        ...(active ? styles.underdogSideBtnActive : null),
      }}
      onClick={onClick}
    >
      <span className="underdog-side-label" style={styles.underdogSideLabel}>
        {label}
      </span>
      <span className="underdog-side-multiplier" style={styles.underdogSideMultiplier}>
        Payout {formatUnderdogMultiplier(multiplier)}
      </span>
      <span className="underdog-side-prob" style={styles.underdogSideProb}>
        Prob {probability != null ? `${probability}%` : "—"}
      </span>
    </button>
  );
}

function UnderdogRowCard({ prop, onOpen, rank }) {
  const enriched = withPlayerImageUrl(prop || {});
  const view = buildUnderdogRowViewModel(enriched);
  const lineText = formatNumber(view.line);

  function openDetails(event) {
    event?.stopPropagation?.();
    onOpen?.(enriched);
  }

  return (
    <article
      className="underdog-row-card"
      style={styles.underdogRowCard}
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
      <div className="underdog-row-left" style={styles.underdogRowLeft}>
        <PlayerImage prop={enriched} />
        <div className="underdog-row-meta" style={styles.underdogRowMeta}>
          <div className="underdog-row-name-line" style={styles.underdogRowNameLine}>
            <h3 className="underdog-row-player" style={styles.underdogRowPlayer} title={view.fullName}>
              {rank != null ? <span style={styles.underdogRowRank}>#{rank}</span> : null}
              {view.playerName}
            </h3>
            <span className="underdog-row-line" style={styles.underdogRowLine}>
              {lineText}
            </span>
          </div>
          <p className="underdog-row-matchup" style={styles.underdogRowMatchup}>
            {view.matchup}
          </p>
          <p className="underdog-row-time" style={styles.underdogRowTime}>
            {view.gameTime}
          </p>
        </div>
      </div>

      <div className="underdog-row-actions" style={styles.underdogRowActions}>
        <SideButton
          label="Higher"
          multiplier={view.higherMultiplier}
          probability={view.higherProb}
          active={view.recommendedSide === "Higher"}
          onClick={(e) => {
            e.stopPropagation();
            openDetails(e);
          }}
        />
        <SideButton
          label="Lower"
          multiplier={view.lowerMultiplier}
          probability={view.lowerProb}
          active={view.recommendedSide === "Lower"}
          onClick={(e) => {
            e.stopPropagation();
            openDetails(e);
          }}
        />
      </div>
    </article>
  );
}

export default memo(UnderdogRowCard);
