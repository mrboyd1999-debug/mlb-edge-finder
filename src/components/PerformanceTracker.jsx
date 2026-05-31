import { memo } from "react";

const CATEGORY_LABELS = {
  overall: "Overall",
  over: "Higher/Over",
  under: "Lower/Under",
  tierA: "Tier A",
  tierB: "Tier B",
  tierC: "Tier C",
  prizepicks: "PrizePicks",
  underdog: "Underdog",
};

function formatCategoryLabel(key = "") {
  return CATEGORY_LABELS[key] || key;
}

function WindowPanel({ title, stats = {} }) {
  const accuracy = stats.accuracy != null ? `${stats.accuracy}%` : "—";
  const best = stats.bestCategory
    ? `${formatCategoryLabel(stats.bestCategory.key)} (${stats.bestCategory.accuracy}%)`
    : "—";
  const worst = stats.worstCategory
    ? `${formatCategoryLabel(stats.worstCategory.key)} (${stats.worstCategory.accuracy}%)`
    : "—";

  return (
    <article className="performance-tracker__window">
      <h3>{title}</h3>
      <div className="performance-tracker__metrics">
        <div>
          <span>Wins</span>
          <strong>{stats.wins ?? 0}</strong>
        </div>
        <div>
          <span>Losses</span>
          <strong>{stats.losses ?? 0}</strong>
        </div>
        <div>
          <span>Pushes</span>
          <strong>{stats.pushes ?? 0}</strong>
        </div>
        <div>
          <span>Accuracy</span>
          <strong>{accuracy}</strong>
        </div>
        <div>
          <span>Best category</span>
          <strong>{best}</strong>
        </div>
        <div>
          <span>Worst category</span>
          <strong>{worst}</strong>
        </div>
      </div>
    </article>
  );
}

function PerformanceTracker({ dashboard = null }) {
  if (!dashboard) return null;

  const hasData =
    (dashboard.trackedCount ?? 0) > 0 ||
    (dashboard.allTime?.wins ?? 0) + (dashboard.allTime?.losses ?? 0) > 0;

  return (
    <section className="compact-section performance-tracker">
      <div className="compact-section__head">
        <h2>Performance Tracker</h2>
        <p>Saved generated Best Plays only · Auto-graded when game results are available</p>
      </div>
      {hasData ? (
        <div className="performance-tracker__grid">
          <WindowPanel title="Last 7 Days" stats={dashboard.last7Days} />
          <WindowPanel title="Last 30 Days" stats={dashboard.last30Days} />
          <WindowPanel title="All Time" stats={dashboard.allTime} />
        </div>
      ) : (
        <p className="compact-empty">No graded Best Plays outcomes yet. Generated board picks are saved automatically.</p>
      )}
    </section>
  );
}

export default memo(PerformanceTracker);
