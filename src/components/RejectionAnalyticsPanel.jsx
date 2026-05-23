import { memo } from "react";
import { styles } from "../theme/styles.js";

const CATEGORY_LABELS = {
  confidence: "Confidence",
  edge: "Edge",
  volatility: "Volatility",
  verification: "Verification",
  dataQuality: "Data quality",
  market: "Market tier",
  timing: "Timing",
  other: "Other",
};

function RejectionAnalyticsPanel({ summary = null, samples = [], loading = false }) {
  if (loading) {
    return (
      <details style={styles.compactDetails}>
        <summary style={styles.detailsSummary}>
          <span>
            <span style={styles.eyebrow}>Pipeline</span>
            <strong>Rejection analytics</strong>
          </span>
        </summary>
        <div style={styles.compactPanel}>
          <p style={styles.streakCopy}>Loading rejection analytics…</p>
        </div>
      </details>
    );
  }

  if (!summary || !summary.total) return null;

  const topCategories = summary.topCategories || [];
  const topReasons = summary.byReason || [];

  return (
    <details style={styles.compactDetails} open={summary.rejected > 0 && summary.accepted <= 3}>
      <summary style={styles.detailsSummary}>
        <span>
          <span style={styles.eyebrow}>Pipeline</span>
          <strong>Rejection analytics</strong>
        </span>
        <span style={styles.countPill}>
          {summary.accepted} accepted · {summary.rejected} rejected · {summary.nearMiss} near miss
        </span>
      </summary>
      <div style={styles.compactPanel}>
        <div style={styles.summaryStrip}>
          <div style={styles.summaryCard}>
            <p style={styles.eyebrow}>Accepted</p>
            <strong>{summary.accepted}</strong>
          </div>
          <div style={styles.summaryCard}>
            <p style={styles.eyebrow}>Rejected</p>
            <strong>{summary.rejected}</strong>
          </div>
          <div style={styles.summaryCard}>
            <p style={styles.eyebrow}>Near miss</p>
            <strong>{summary.nearMiss}</strong>
          </div>
        </div>

        {topCategories.length > 0 ? (
          <>
            <p style={{ ...styles.eyebrow, marginTop: 12 }}>Rejection summary by category</p>
            <div style={styles.compactFlags}>
              {topCategories.map((row) => (
                <p key={row.category} style={{ margin: "4px 0" }}>
                  <strong>{CATEGORY_LABELS[row.category] || row.category}</strong>: {row.count} rejected
                </p>
              ))}
            </div>
          </>
        ) : null}

        {topReasons.length > 0 ? (
          <>
            <p style={{ ...styles.eyebrow, marginTop: 12 }}>Top rejection reasons</p>
            <div style={styles.compactFlags}>
              {topReasons.map((row) => (
                <p key={row.reason} style={{ margin: "4px 0" }}>
                  <strong>{row.count}</strong> · {row.reason}
                </p>
              ))}
            </div>
          </>
        ) : null}

        {samples.length > 0 ? (
          <>
            <p style={{ ...styles.eyebrow, marginTop: 12 }}>Sample rejections</p>
            <div style={styles.compactFlags}>
              {samples.slice(0, 20).map((row) => (
                <p key={row.id || `${row.playerName}-${row.statType}`} style={{ margin: "6px 0" }}>
                  <strong>{row.playerName}</strong> · {row.statType} · conf {row.finalConfidence}% ·{" "}
                  {row.primaryReason}
                  {row.thresholdFailed ? ` · failed: ${row.thresholdFailed}` : ""}
                  {row.deductions?.volatilityDeduction ? ` · vol −${row.deductions.volatilityDeduction}` : ""}
                  {row.deductions?.edgeDeduction ? ` · edge −${row.deductions.edgeDeduction}` : ""}
                  {row.deductions?.verificationDeduction ? ` · verify −${row.deductions.verificationDeduction}` : ""}
                </p>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </details>
  );
}

export default memo(RejectionAnalyticsPanel);
