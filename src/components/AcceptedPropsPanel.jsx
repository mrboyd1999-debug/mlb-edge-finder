import { memo, useMemo } from "react";
import { formatNumber } from "../utils/formatters.js";
import { computeTopPickWeightedScore } from "../services/topPicksSelection.js";
import { styles } from "../theme/styles.js";

function movementLabel(prop = {}) {
  const tag = prop.lineMovementTag || prop.lineMovement?.tag || "stable";
  if (prop.lineMovement?.againstPick) return `${tag} · against pick`;
  return tag;
}

function sourceLabel(prop = {}) {
  return prop.platform || prop.source || prop.projectionSource || "—";
}

function AcceptedPropsPanel({ props = [], loading = false }) {
  const rows = useMemo(
    () =>
      (props || []).filter(Boolean).map((prop) => ({
        ...prop,
        weightedScore: computeTopPickWeightedScore(prop),
      })),
    [props]
  );

  if (loading) {
    return (
      <section style={styles.section} aria-label="Accepted props">
        <div style={styles.sectionHeading}>
          <div>
            <p style={styles.eyebrow}>Visibility</p>
            <h2 style={styles.sectionTitle}>Accepted Props</h2>
          </div>
        </div>
        <p style={styles.streakCopy}>Loading accepted props…</p>
      </section>
    );
  }

  if (!rows.length) return null;

  return (
    <details open style={styles.compactDetails} aria-label="Accepted props">
      <summary style={styles.detailsSummary}>
        <span>
          <span style={styles.eyebrow}>Visibility</span>
          <strong>Accepted Props</strong>
        </span>
        <span style={styles.countPill}>{rows.length} accepted</span>
      </summary>
      <div style={styles.compactPanel}>
        <p style={{ ...styles.streakCopy, marginTop: 0 }}>
          All qualification-accepted MLB props — not filtered by UI tabs or search.
        </p>
        <div style={styles.compactFlags}>
          {rows.map((prop) => (
            <div
              key={prop.id || `${prop.playerName}-${prop.statType}-${prop.line}`}
              style={{ margin: "10px 0", paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <strong>{prop.playerName || "—"}</strong>
              <p style={{ margin: "4px 0 0", opacity: 0.92 }}>
                Market: {prop.statType || "—"} · Line: {formatNumber(prop.line)} · Pick:{" "}
                {prop.bestPick || prop.pick || prop.pickDirection || "—"}
              </p>
              <p style={{ margin: "4px 0 0", opacity: 0.85 }}>
                Confidence: {formatNumber(prop.confidenceScore ?? prop.confidence)}% · Edge: +{formatNumber(prop.edge)} ·
                Weighted: {formatNumber(prop.weightedScore)} · Volatility:{" "}
                {Number.isFinite(Number(prop.volatility)) ? formatNumber(prop.volatility) : "—"} · Line movement:{" "}
                {movementLabel(prop)} · Source: {sourceLabel(prop)}
              </p>
              {prop.qualificationLabel || prop.qualificationTier ? (
                <p style={{ margin: "4px 0 0", opacity: 0.75 }}>
                  Tier: {prop.qualificationLabel || prop.qualificationTier}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

export default memo(AcceptedPropsPanel);
