import { useState } from "react";
import { formatNumber, dateKey } from "../utils/formatters.js";
import { displaySport } from "../utils/propLabels.js";
import { styles } from "../theme/styles.js";

function MetricCard({ label, value }) {
  return (
    <div style={styles.metricCard}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={styles.dashboardValue}>{value}</strong>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label style={styles.selectLabel}>
      {label}
      <select style={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? "All" : option === "today" ? "Today" : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Breakdown({ title, rows }) {
  return (
    <div style={styles.breakdownCard}>
      <h3 style={styles.breakdownTitle}>{title}</h3>
      {rows.length === 0 ? (
        <p style={styles.breakdownEmpty}>No settled picks yet.</p>
      ) : (
        rows.map((row) => (
          <div key={row.key} style={styles.breakdownRow}>
            <span>{row.key}</span>
            <strong>
              {row.winPercentage === "—" ? "—" : `${row.winPercentage}%`} ({row.wins}-{row.losses}-{row.pushes})
            </strong>
          </div>
        ))
      )}
    </div>
  );
}

function matchesHistoryFilter(pick, filter) {
  const status = pick.resultStatus || pick.finalResult || "Pending";
  if (filter.result !== "all" && status !== filter.result) return false;
  if (filter.sport !== "all" && displaySport(pick) !== filter.sport) return false;
  if (filter.platform !== "all" && pick.platform !== filter.platform) return false;
  if (filter.date === "today" && pick.date !== dateKey(new Date())) return false;
  if (filter.categorySource !== "all" && !String(pick.categorySource || "").includes(filter.categorySource)) return false;
  return true;
}

function formatHitRate(value) {
  return value === "—" ? "—" : `${value}%`;
}

export default function AccuracyReview({
  dashboard,
  history = [],
  updatePickResult,
  clearHistory,
  exportHistoryCsv,
  importHistoryJson,
  clearOldResearchPicks,
  filterOptions = { sports: ["all"], categories: ["all"], platforms: ["all"] },
}) {
  const [historyFilter, setHistoryFilter] = useState({
    date: "all",
    sport: "all",
    categorySource: "all",
    result: "all",
    platform: "all",
  });
  const filteredHistory = history.filter((pick) => matchesHistoryFilter(pick, historyFilter));
  const recent = filteredHistory.slice(0, 12);

  return (
    <details style={styles.compactDetails}>
      <summary style={styles.detailsSummary}>
        <div>
          <p style={styles.eyebrow}>Saved picks</p>
          <strong>Accuracy Review</strong>
        </div>
        <div style={styles.dashboardActions}>
          <button type="button" style={styles.secondaryButton} onClick={exportHistoryCsv} disabled={history.length === 0}>
            Export CSV
          </button>
          {importHistoryJson ? (
            <label style={styles.secondaryButton}>
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={(e) => {
                  importHistoryJson(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}
          {clearOldResearchPicks ? (
            <button type="button" style={styles.secondaryButton} onClick={clearOldResearchPicks} disabled={history.length === 0}>
              Clear old research
            </button>
          ) : null}
          <button type="button" style={styles.secondaryButton} onClick={clearHistory} disabled={history.length === 0}>
            Clear
          </button>
          <p style={styles.countPill}>{dashboard.total} saved</p>
        </div>
      </summary>

      <div style={styles.dashboardGrid}>
        <MetricCard label="Total" value={dashboard.total} />
        <MetricCard label="Pending" value={dashboard.pending} />
        <MetricCard label="Wins" value={dashboard.wins} />
        <MetricCard label="Losses" value={dashboard.losses} />
        <MetricCard label="Pushes" value={dashboard.pushes ?? 0} />
        <MetricCard label="Voids" value={dashboard.voids ?? 0} />
        <MetricCard label="Hit rate" value={`${dashboard.winPercentage}%`} />
        <MetricCard label="Best Value HR" value={formatHitRate(dashboard.bestValueHitRate)} />
        <MetricCard label="Streak HR" value={formatHitRate(dashboard.streakFinderHitRate)} />
        <MetricCard label="By sport (top)" value={dashboard.bySport?.[0]?.key ? `${dashboard.bySport[0].key} ${dashboard.bySport[0].winPercentage}%` : "—"} />
        <MetricCard label="Top Picks HR" value={formatHitRate(dashboard.topPicksHitRate)} />
        <MetricCard label="Ready HR" value={formatHitRate(dashboard.readyToBetHitRate)} />
        <MetricCard label="Goblin HR" value={formatHitRate(dashboard.goblinHitRate)} />
        <MetricCard label="Demon HR" value={formatHitRate(dashboard.demonHitRate)} />
      </div>

      <div style={styles.historyFilters}>
        <FilterSelect label="Date" value={historyFilter.date} options={["all", "today"]} onChange={(v) => setHistoryFilter((c) => ({ ...c, date: v }))} />
        <FilterSelect label="Sport" value={historyFilter.sport} options={filterOptions.sports} onChange={(v) => setHistoryFilter((c) => ({ ...c, sport: v }))} />
        <FilterSelect label="Category" value={historyFilter.categorySource} options={filterOptions.categories} onChange={(v) => setHistoryFilter((c) => ({ ...c, categorySource: v }))} />
        <FilterSelect label="Result" value={historyFilter.result} options={["all", "Pending", "Win", "Loss", "Push", "Void"]} onChange={(v) => setHistoryFilter((c) => ({ ...c, result: v }))} />
        <FilterSelect label="Platform" value={historyFilter.platform} options={filterOptions.platforms} onChange={(v) => setHistoryFilter((c) => ({ ...c, platform: v }))} />
      </div>

      <div style={styles.breakdownGrid}>
        <Breakdown title="By market" rows={dashboard.byMarket || []} />
        <Breakdown title="By prop type" rows={dashboard.byStatType} />
        <Breakdown title="By platform" rows={dashboard.byPlatform} />
        <Breakdown title="By confidence" rows={dashboard.byConfidenceRange} />
        <Breakdown title="By line range" rows={dashboard.byLineRange || []} />
        <Breakdown title="By source" rows={dashboard.bySource || []} />
        <Breakdown title="By player" rows={dashboard.byPlayer} />
        <Breakdown title="By recommendation" rows={dashboard.byCategorySource} />
      </div>

      {recent.length > 0 && (
        <div style={styles.historyList}>
          {recent.map((pick) => (
            <div key={pick.id} style={styles.historyRow}>
              <div>
                <strong>{pick.playerName || pick.player}</strong>
                <p style={styles.historyMeta}>
                  {pick.platform} · {displaySport(pick)} · {pick.statType} · {pick.pickDirection || pick.pick}{" "}
                  {formatNumber(pick.line)} · {pick.confidenceScore ?? pick.confidence}%
                </p>
              </div>
              <div style={styles.resultButtons}>
                {["Win", "Loss", "Push", "Void", "Pending"].map((result) => (
                  <button
                    key={result}
                    type="button"
                    style={(pick.resultStatus || pick.finalResult) === result ? styles.resultButtonActive : styles.resultButton}
                    onClick={() => updatePickResult(pick.id, result)}
                  >
                    {result}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
