import { memo } from "react";
import { styles } from "../theme/styles.js";

function formatTime(value = "") {
  if (!value) return "—";
  const text = String(value);
  if (text.length >= 19) return text.slice(11, 19);
  return text;
}

function LiveStatusHeader({ debug = null, failureReasons = [], loading = false }) {
  if (loading) return null;
  if (!debug) return null;

  const sources = debug.sourceStatus || {};
  const activeSources = Object.entries(sources)
    .filter(([, status]) => /connected|live|ok|partial|cached/i.test(String(status)))
    .map(([name]) => name);

  return (
    <section className="live-status-header" style={styles.liveStatusHeader} aria-label="Live data status">
      <div style={styles.liveStatusRow}>
        <span style={styles.liveStatusPill}>
          {debug.isLive ? "🟢 Live" : debug.usedFallback ? "🟡 Fallback" : "🔴 Offline"}
        </span>
        <span style={styles.liveStatusMeta}>Updated {formatTime(debug.lastSuccessfulRefresh)}</span>
        <span style={styles.liveStatusMeta}>{debug.livePropCount ?? debug.rankedCount ?? 0} props</span>
      </div>
      <div style={styles.liveStatusSources}>
        {Object.entries(sources).map(([name, status]) => (
          <span key={name} style={styles.liveStatusSourceChip}>
            {name}: {status}
          </span>
        ))}
      </div>
      {failureReasons?.length ? (
        <p style={styles.liveStatusFailure} role="alert">
          {failureReasons.join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

export default memo(LiveStatusHeader);
