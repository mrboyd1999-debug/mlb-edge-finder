import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";

function SummaryMetric({ label, value }) {
  return (
    <div className="board-summary-card__metric">
      <span className="board-summary-card__label">{label}</span>
      <strong className="board-summary-card__value">{value ?? "—"}</strong>
    </div>
  );
}

function BoardSummaryCard({ summary = null }) {
  if (!summary) return null;

  return (
    <section className="board-summary-card" aria-label="Board summary">
      <div className="board-summary-card__grid">
        <SummaryMetric label="Tier A Plays" value={summary.tierAPlays} />
        <SummaryMetric label="Tier B Plays" value={summary.tierBPlays} />
        <SummaryMetric label="PrizePicks Lines" value={summary.prizePicksLines} />
        <SummaryMetric label="Underdog Lines" value={summary.underdogLines} />
        <SummaryMetric
          label="Last Refresh"
          value={summary.lastRefresh ? formatDateTime(summary.lastRefresh) : "Never"}
        />
      </div>
    </section>
  );
}

export default memo(BoardSummaryCard);
