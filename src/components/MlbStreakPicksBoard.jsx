import { memo, useMemo, useState } from "react";
import UnderdogRowCard from "./UnderdogRowCard.jsx";
import { styles } from "../theme/styles.js";
import { UNDERDOG_STREAK_EMPTY_MESSAGE } from "../utils/underdogStreakPool.js";
import { SAFE_MODE_LOADING_MESSAGE } from "../utils/safeMode.js";
import {
  filterUnderdogRowProps,
  UNDERDOG_STAT_TABS,
} from "../utils/underdogRowCard.js";

function MlbStreakPicksBoard({
  picks = [],
  underdogPool = [],
  onOpen,
  hasUnderdogProps = false,
  emptyMessage = "",
  loading = false,
  categoryTab,
  onCategoryTabChange,
}) {
  const [internalTab, setInternalTab] = useState("all");
  const activeTab = categoryTab ?? internalTab;
  const setActiveTab = (tabId) => {
    onCategoryTabChange?.(tabId);
    if (categoryTab == null) setInternalTab(tabId);
  };

  const sourcePool = useMemo(
    () => filterUnderdogRowProps(underdogPool.length ? underdogPool : picks, { tabId: "all", sport: "MLB" }),
    [underdogPool, picks]
  );

  const visiblePicks = useMemo(
    () => filterUnderdogRowProps(sourcePool, { tabId: activeTab, sport: "MLB", limit: 2 }),
    [sourcePool, activeTab]
  );

  const tabCounts = useMemo(() => {
    const counts = { all: sourcePool.length };
    UNDERDOG_STAT_TABS.forEach((tab) => {
      if (tab.id === "all") return;
      counts[tab.id] = filterUnderdogRowProps(sourcePool, { tabId: tab.id, sport: "MLB" }).length;
    });
    return counts;
  }, [sourcePool]);

  return (
    <section className="mlb-streak-picks-section" style={styles.section} aria-label="MLB Streak Picks">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Top 2 · Underdog only</p>
          <h2 style={styles.sectionTitle}>MLB Streak Picks</h2>
        </div>
        <p style={styles.countPill}>{visiblePicks.length}/2</p>
      </div>

      <div className="underdog-stat-tabs" style={styles.underdogStatTabs} role="tablist" aria-label="Stat categories">
        {UNDERDOG_STAT_TABS.map((tab) => {
          const count = tabCounts[tab.id] ?? 0;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`underdog-stat-tab${active ? " underdog-stat-tab-active" : ""}`}
              style={{
                ...styles.underdogStatTab,
                ...(active ? styles.underdogStatTabActive : null),
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              {count > 0 ? <span style={styles.underdogStatTabCount}>{count}</span> : null}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={styles.emptyStateCompact}>{SAFE_MODE_LOADING_MESSAGE}</div>
      ) : visiblePicks.length > 0 ? (
        <div className="underdog-row-list" style={styles.underdogRowList}>
          {visiblePicks.map((prop, idx) => (
            <UnderdogRowCard
              key={prop.id || `mlb-streak-${activeTab}-${idx}`}
              prop={prop}
              rank={idx + 1}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <div style={styles.emptyStateCompact}>
          {emptyMessage ||
            (hasUnderdogProps
              ? `No Underdog streak picks in ${UNDERDOG_STAT_TABS.find((tab) => tab.id === activeTab)?.label || "this category"} yet.`
              : UNDERDOG_STREAK_EMPTY_MESSAGE)}
        </div>
      )}
    </section>
  );
}

export default memo(MlbStreakPicksBoard);
