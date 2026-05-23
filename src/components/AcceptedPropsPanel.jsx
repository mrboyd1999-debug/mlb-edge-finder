import { memo } from "react";
import { formatNumber } from "../utils/formatters.js";
import { styles } from "../theme/styles.js";

function statusLabel(prop = {}) {
  const vol = Number(prop.volatility);
  if (Number.isFinite(vol) && vol >= 3.5) return "High vol";
  if (Number.isFinite(vol) && vol >= 2.75) return "Moderate vol";
  return "Stable vol";
}

function movementLabel(prop = {}) {
  const tag = prop.lineMovementTag || prop.lineMovement?.tag || "stable";
  if (prop.lineMovement?.againstPick) return `${tag} · against pick`;
  return tag;
}

function sportsbookLabel(prop = {}) {
  if (prop.sportsbookLine != null) return `Book ${formatNumber(prop.sportsbookLine)}`;
  if (prop.sportsbookComparison?.marketAverageLine != null) {
    return `Book ${formatNumber(prop.sportsbookComparison.marketAverageLine)}`;
  }
  return prop.platform || "—";
}

function AcceptedPropsPanel({ props = [], loading = false }) {
  if (loading) {
    return (
      <section style={styles.section} aria-label="Accepted props debug">
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

  if (!props.length) return null;

  return (
    <section style={styles.section} aria-label="Accepted props debug">
      <div style={styles.sectionHeading}>
        <div>
          <p style={styles.eyebrow}>Visibility</p>
          <h2 style={styles.sectionTitle}>Accepted Props</h2>
          <p style={styles.streakCopy}>Verified accepted props with confidence, edge, volatility, and line movement status.</p>
        </div>
        <p style={styles.countPill}>{props.length} accepted</p>
      </div>
      <div style={styles.compactPanel}>
        <div style={styles.compactFlags}>
          {props.slice(0, 40).map((prop) => (
            <div key={prop.id} style={{ margin: "8px 0", paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <strong>{prop.playerName}</strong> · {prop.statType} · {prop.bestPick || prop.pick}{" "}
              {formatNumber(prop.line)} · {prop.confidenceScore ?? prop.confidence}% conf · +{formatNumber(prop.edge)} edge ·{" "}
              {sportsbookLabel(prop)}
              <p style={{ margin: "4px 0 0", opacity: 0.85 }}>
                Volatility: {statusLabel(prop)} · Line movement: {movementLabel(prop)} · Tier:{" "}
                {prop.qualificationLabel || prop.qualificationTier || "—"}
                {prop.topPickWeightedScore ? ` · Weight ${prop.topPickWeightedScore}` : ""}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default memo(AcceptedPropsPanel);
