import { memo } from "react";
import { styles } from "../theme/styles.js";

function CacheAnalyticsPanel({ analytics = null, cacheNotice = "", loading = false }) {
  if (loading) {
    return (
      <details style={styles.compactDetails}>
        <summary style={styles.detailsSummary}>
          <span>
            <span style={styles.eyebrow}>Cache</span>
            <strong>Cache analytics</strong>
          </span>
        </summary>
        <div style={styles.compactPanel}>
          <p style={styles.streakCopy}>Loading cache analytics…</p>
        </div>
      </details>
    );
  }

  if (!analytics && !cacheNotice) return null;

  return (
    <details style={styles.compactDetails} open={Boolean(cacheNotice)}>
      <summary style={styles.detailsSummary}>
        <span>
          <span style={styles.eyebrow}>Cache</span>
          <strong>Cache analytics</strong>
        </span>
        <span style={styles.countPill}>
          {analytics?.avgFreshnessScore != null ? `avg freshness ${analytics.avgFreshnessScore}` : "—"}
        </span>
      </summary>
      <div style={styles.compactPanel}>
        {cacheNotice ? (
          <p style={{ ...styles.streakCopy, color: "#fbbf24", marginBottom: 10 }}>{cacheNotice}</p>
        ) : null}
        {analytics ? (
          <>
            <div style={styles.summaryStrip}>
              <div style={styles.summaryCard}>
                <p style={styles.eyebrow}>Live</p>
                <strong>{analytics.live ?? 0}</strong>
              </div>
              <div style={styles.summaryCard}>
                <p style={styles.eyebrow}>Verified cache</p>
                <strong>{analytics.cached ?? 0}</strong>
              </div>
              <div style={styles.summaryCard}>
                <p style={styles.eyebrow}>Stale warning</p>
                <strong>{analytics.stale ?? 0}</strong>
              </div>
              <div style={styles.summaryCard}>
                <p style={styles.eyebrow}>Expired</p>
                <strong>{analytics.expired ?? 0}</strong>
              </div>
            </div>
            <p style={{ ...styles.streakCopy, marginTop: 10 }}>
              Average freshness score: <strong>{analytics.avgFreshnessScore ?? 0}</strong> · tracked props:{" "}
              <strong>{analytics.total ?? 0}</strong>
            </p>
          </>
        ) : null}
      </div>
    </details>
  );
}

export default memo(CacheAnalyticsPanel);
