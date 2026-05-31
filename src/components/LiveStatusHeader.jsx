import { memo } from "react";
import { styles } from "../theme/styles.js";

function formatTime(value = "") {
  if (!value) return "—";
  const text = String(value);
  if (text.length >= 19) return text.slice(11, 19);
  return text;
}

function LiveStatusHeader({ debug = null, failureReasons = [], loading = false, loadedPropCount = 0 }) {
  if (loading) return null;
  if (!debug) return null;

  const sources = debug.sourceStatus || {};
  const displayedCount = loadedPropCount || (debug.livePropCount ?? debug.rankedCount ?? debug.parsedCount ?? 0);
  const visibleFailures = displayedCount > 0 ? [] : failureReasons;

  return (
    <section className="live-status-header" style={styles.liveStatusHeader} aria-label="Live data status">
      <div style={styles.liveStatusRow}>
        <span style={styles.liveStatusPill}>
          {displayedCount > 0 ? "🟢 Live" : debug.isLive ? "🟢 Live" : debug.usedFallback ? "🟡 Fallback" : "🔴 Offline"}
        </span>
        <span style={styles.liveStatusMeta}>Updated {formatTime(debug.lastSuccessfulRefresh)}</span>
        <span style={styles.liveStatusMeta}>{displayedCount} props loaded</span>
      </div>
      <div style={styles.liveStatusSources}>
        {Object.entries(sources).map(([name, status]) => (
          <span key={name} style={styles.liveStatusSourceChip}>
            {name}: {status}
          </span>
        ))}
      </div>
      {visibleFailures?.length ? (
        <p style={styles.liveStatusFailure} role="alert">
          {visibleFailures.join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

export default memo(LiveStatusHeader);
