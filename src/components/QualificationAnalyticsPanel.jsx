import { memo } from "react";
import { styles } from "../theme/styles.js";

const METRIC_LABELS = {
  matchupQuality: "Matchup quality",
  recentForm: "Recent form",
  consistency: "Consistency",
  lineStability: "Line stability",
  edge: "Edge",
  volatility: "Volatility",
  projectionConfidence: "Projection confidence",
  verifiedStatsQuality: "Verified stats",
};

function QualificationAnalyticsPanel({ analytics = null, loading = false }) {
  if (loading) {
    return (
      <details style={styles.compactDetails}>
        <summary style={styles.detailsSummary}>
          <span>
            <span style={styles.eyebrow}>Qualification</span>
            <strong>Qualification analytics</strong>
          </span>
        </summary>
        <div style={styles.compactPanel}>
          <p style={styles.streakCopy}>Loading qualification analytics…</p>
        </div>
      </details>
    );
  }

  if (!analytics || !analytics.evaluated) return null;

  return (
    <details style={styles.compactDetails} open={analytics.accepted < 5}>
      <summary style={styles.detailsSummary}>
        <span>
          <span style={styles.eyebrow}>Qualification</span>
          <strong>Qualification analytics</strong>
        </span>
        <span style={styles.countPill}>
          avg {analytics.avgQualificationScore} · {analytics.accepted} accepted
          {analytics.adaptiveApplied ? " · adaptive" : ""}
        </span>
      </summary>
      <div style={styles.compactPanel}>
        <div style={styles.summaryStrip}>
          <div style={styles.summaryCard}>
            <p style={styles.eyebrow}>Avg score</p>
            <strong>{analytics.avgQualificationScore}</strong>
          </div>
          <div style={styles.summaryCard}>
            <p style={styles.eyebrow}>Accepted</p>
            <strong>{analytics.accepted}</strong>
          </div>
          <div style={styles.summaryCard}>
            <p style={styles.eyebrow}>Evaluated</p>
            <strong>{analytics.evaluated}</strong>
          </div>
        </div>

        {analytics.strongestMetrics?.length > 0 ? (
          <>
            <p style={{ ...styles.eyebrow, marginTop: 12 }}>Strongest metrics (pool avg)</p>
            <div style={styles.compactFlags}>
              {analytics.strongestMetrics.map((row) => (
                <p key={row.key} style={{ margin: "4px 0" }}>
                  <strong>{METRIC_LABELS[row.key] || row.key}</strong>: {row.avg}
                </p>
              ))}
            </div>
          </>
        ) : null}

        {analytics.weakestMetrics?.length > 0 ? (
          <>
            <p style={{ ...styles.eyebrow, marginTop: 12 }}>Weakest metrics (pool avg)</p>
            <div style={styles.compactFlags}>
              {analytics.weakestMetrics.map((row) => (
                <p key={row.key} style={{ margin: "4px 0" }}>
                  <strong>{METRIC_LABELS[row.key] || row.key}</strong>: {row.avg}
                </p>
              ))}
            </div>
          </>
        ) : null}

        {analytics.topRejectionCauses?.length > 0 ? (
          <>
            <p style={{ ...styles.eyebrow, marginTop: 12 }}>Top rejection causes</p>
            <div style={styles.compactFlags}>
              {analytics.topRejectionCauses.map((row) => (
                <p key={row.reason} style={{ margin: "4px 0" }}>
                  <strong>{row.count}</strong> · {row.reason}
                </p>
              ))}
            </div>
          </>
        ) : null}

        {analytics.mostRestrictiveFilters?.length > 0 ? (
          <>
            <p style={{ ...styles.eyebrow, marginTop: 12 }}>Most restrictive filters</p>
            <div style={styles.compactFlags}>
              {analytics.mostRestrictiveFilters.map((row) => (
                <p key={row.filter} style={{ margin: "4px 0" }}>
                  <strong>{row.count}</strong> · {row.filter}
                </p>
              ))}
            </div>
          </>
        ) : null}

        {analytics.tierCounts ? (
          <>
            <p style={{ ...styles.eyebrow, marginTop: 12 }}>Tier distribution</p>
            <div style={styles.compactFlags}>
              {Object.entries(analytics.tierCounts).map(([tier, count]) => (
                <p key={tier} style={{ margin: "4px 0" }}>
                  <strong>{tier}</strong>: {count}
                </p>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </details>
  );
}

export default memo(QualificationAnalyticsPanel);
