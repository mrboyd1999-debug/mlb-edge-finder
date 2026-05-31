import { memo, useMemo, useState } from "react";
import { formatDateTime, formatNumber } from "../utils/formatters.js";
import { resolveTierDisplayLabel } from "../utils/boardQuality.js";
import { buildSavedPickSummary } from "../utils/savedPicksStorage.js";

const GRADE_OPTIONS = ["pending", "won", "lost", "push"];

function formatGradeLabel(value = "pending") {
  const key = String(value || "pending").toLowerCase();
  if (key === "won") return "Won";
  if (key === "lost") return "Lost";
  if (key === "push") return "Push";
  return "Pending";
}

function SavedPickRow({ pick, onOpen, onDelete, onGrade }) {
  const [actualResult, setActualResult] = useState(pick.actualResult ?? "");

  return (
    <article className="saved-pick-row">
      <button type="button" className="saved-pick-row__open" onClick={() => onOpen?.(pick.propSnapshot || pick)}>
        <div className="saved-pick-row__head">
          <strong>{pick.playerName}</strong>
          <span>Saved {formatDateTime(pick.savedAt) || "—"}</span>
        </div>
        <p>
          {pick.market} · {pick.recommendedSide} · Line {formatNumber(pick.line)} · Proj{" "}
          {pick.projection != null ? formatNumber(pick.projection) : "—"}
        </p>
        <div className="saved-pick-row__metrics">
          <span>Edge {pick.edge != null ? formatNumber(pick.edge) : "—"}</span>
          <span>Conf {Number.isFinite(Number(pick.confidence)) ? `${Math.round(Number(pick.confidence))}%` : "—"}</span>
          <span>{resolveTierDisplayLabel({ tier: pick.tier })}</span>
          <span className={`saved-pick-row__status saved-pick-row__status--${pick.resultStatus || "pending"}`}>
            {formatGradeLabel(pick.resultStatus)}
          </span>
        </div>
      </button>

      <div className="saved-pick-row__grade">
        <div className="saved-pick-row__grade-buttons">
          {GRADE_OPTIONS.map((status) => (
            <button
              key={status}
              type="button"
              className={pick.resultStatus === status ? "saved-pick-row__grade-btn saved-pick-row__grade-btn--active" : "saved-pick-row__grade-btn"}
              onClick={() => onGrade?.(pick.id, { resultStatus: status, actualResult })}
            >
              {formatGradeLabel(status)}
            </button>
          ))}
        </div>
        <label className="saved-pick-row__actual">
          <span>Actual result</span>
          <input
            type="text"
            value={actualResult}
            onChange={(event) => setActualResult(event.target.value)}
            onBlur={() => onGrade?.(pick.id, { resultStatus: pick.resultStatus || "pending", actualResult })}
            placeholder="e.g. 2 hits"
          />
        </label>
        <button type="button" className="compact-prop-card__btn compact-prop-card__btn--danger" onClick={() => onDelete?.(pick)}>
          Remove
        </button>
      </div>
    </article>
  );
}

function SavedPicksTab({ picks = [], onOpen, onDelete, onClearAll, onGrade }) {
  const summary = useMemo(() => buildSavedPickSummary(picks), [picks]);

  if (!picks.length) {
    return (
      <div className="compact-tab-panel">
        <p className="compact-empty">No saved picks yet. Open a prop and tap Save.</p>
      </div>
    );
  }

  return (
    <div className="compact-tab-panel">
      <div className="compact-section__head compact-section__head--row">
        <div>
          <h2>Saved Picks</h2>
          <p>{summary.total} saved picks</p>
        </div>
        <button type="button" className="compact-prop-card__btn compact-prop-card__btn--danger" onClick={onClearAll}>
          Clear all
        </button>
      </div>

      <div className="saved-pick-summary">
        <span>Total <strong>{summary.total}</strong></span>
        <span>Pending <strong>{summary.pending}</strong></span>
        <span>Won <strong>{summary.won}</strong></span>
        <span>Lost <strong>{summary.lost}</strong></span>
        <span>Push <strong>{summary.push}</strong></span>
        <span>Win rate <strong>{summary.winRate != null ? `${summary.winRate}%` : "—"}</strong></span>
      </div>

      <div className="saved-pick-list">
        {picks.map((pick) => (
          <SavedPickRow key={pick.id} pick={pick} onOpen={onOpen} onDelete={onDelete} onGrade={onGrade} />
        ))}
      </div>
    </div>
  );
}

export default memo(SavedPicksTab);
