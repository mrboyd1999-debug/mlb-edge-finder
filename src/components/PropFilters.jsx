import { styles } from "../theme/styles.js";

const MARKET_QUICK_FILTERS = [
  { id: "all", label: "All" },
  { id: "points", label: "Points" },
  { id: "rebounds", label: "Rebounds" },
  { id: "assists", label: "Assists" },
  { id: "pra", label: "PRA" },
  { id: "threes", label: "3PM" },
  { id: "fantasy", label: "Fantasy" },
  { id: "goblins", label: "Goblins" },
  { id: "demons", label: "Demons" },
];

export default function PropFilters({
  platform,
  setPlatform,
  sport,
  setSport,
  statType,
  setStatType,
  edgeFilter,
  setEdgeFilter,
  dateFilter,
  setDateFilter,
  readyOnly,
  setReadyOnly,
  searchText,
  setSearchText,
  filterPrefs = {},
  setFilterPrefs,
  platformOptions = [],
  sportOptions = [],
  propTypes = [],
  edgeFilters = [],
  dateFilters = [],
  marketQuickFilter = "all",
  setMarketQuickFilter,
}) {
  const updatePref = (key, value) => {
    setFilterPrefs?.((current) => ({ ...current, [key]: value }));
  };

  return (
    <div style={styles.compactPanel}>
      <section style={styles.controls} aria-label="DFS filters">
        <div style={styles.segmentGroup}>
          <span style={styles.controlLabel}>Source</span>
          <div style={styles.segmentRow}>
            {platformOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                style={platform === option.id ? styles.segmentActive : styles.segment}
                onClick={() => setPlatform(option.id)}
                title={option.statusMessage || option.label}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label style={styles.selectLabel}>
          Sport
          <select style={styles.select} value={sport} onChange={(e) => setSport(e.target.value)}>
            {sportOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.selectLabel}>
          Prop type
          <select style={styles.select} value={statType} onChange={(e) => setStatType(e.target.value)}>
            {propTypes.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All types" : option}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.selectLabel}>
          Date
          <select style={styles.select} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
            {dateFilters.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.selectLabel}>
          Search
          <input
            style={styles.textInput}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Player, prop, team"
          />
        </label>
      </section>
      <section style={styles.quickFilters} aria-label="Market filters">
        <span style={styles.controlLabel}>Markets</span>
        <div style={{ ...styles.segmentRow, flexWrap: "wrap", gap: "6px" }}>
          {MARKET_QUICK_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              style={marketQuickFilter === option.id ? styles.segmentActive : styles.segment}
              onClick={() => setMarketQuickFilter?.(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
      <section style={styles.quickFilters} aria-label="Edge filters">
        <span style={styles.controlLabel}>Edge</span>
        <div style={styles.segmentRow}>
          {edgeFilters.map((option) => (
            <button
              key={option.id}
              type="button"
              style={edgeFilter === option.id ? styles.segmentActive : styles.segment}
              onClick={() => setEdgeFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            style={readyOnly ? styles.segmentActive : styles.segment}
            onClick={() => setReadyOnly(!readyOnly)}
          >
            Ready to Bet only
          </button>
        </div>
      </section>
      <section style={styles.quickFilters} aria-label="Display filters">
        <span style={styles.controlLabel}>Display</span>
        <div style={{ ...styles.segmentRow, flexWrap: "wrap", gap: "8px" }}>
          <label style={styles.selectLabel}>
            <input
              type="checkbox"
              checked={Boolean(filterPrefs.hideResearchOnly)}
              onChange={(e) => updatePref("hideResearchOnly", e.target.checked)}
            />
            Hide research-only
          </label>
          <label style={styles.selectLabel}>
            <input
              type="checkbox"
              checked={filterPrefs.hideUnsupportedMarkets !== false}
              onChange={(e) => updatePref("hideUnsupportedMarkets", e.target.checked)}
            />
            Hide unsupported markets
          </label>
          <label style={styles.selectLabel}>
            <input
              type="checkbox"
              checked={filterPrefs.hideEsports !== false}
              onChange={(e) => updatePref("hideEsports", e.target.checked)}
            />
            Hide esports
          </label>
          <label style={styles.selectLabel}>
            <input
              type="checkbox"
              checked={filterPrefs.excludeUnsupportedMarkets !== false}
              onChange={(e) => updatePref("excludeUnsupportedMarkets", e.target.checked)}
            />
            Exclude unsupported markets (pipeline)
          </label>
          <label style={styles.selectLabel}>
            Board sort
            <select
              style={styles.select}
              value={filterPrefs.boardSortMode || "priority"}
              onChange={(e) => updatePref("boardSortMode", e.target.value)}
            >
              <option value="priority">Priority score</option>
              <option value="ev">Highest EV</option>
              <option value="confidence">Highest confidence</option>
              <option value="volatility">Lowest volatility</option>
            </select>
          </label>
          <label style={styles.selectLabel}>
            <input
              type="checkbox"
              checked={Boolean(filterPrefs.sharpOnly)}
              onChange={(e) => updatePref("sharpOnly", e.target.checked)}
            />
            Sharp only
          </label>
          <label style={styles.selectLabel}>
            Pregame window
            <select
              style={styles.select}
              value={String(filterPrefs.pregameWindowHours ?? 24)}
              onChange={(e) => updatePref("pregameWindowHours", Number(e.target.value))}
            >
              <option value="6">Next 6 hours</option>
              <option value="12">Next 12 hours</option>
              <option value="24">Next 24 hours</option>
              <option value="48">Next 48 hours</option>
              <option value="0">All future</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  );
}
