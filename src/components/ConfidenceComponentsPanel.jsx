import { memo } from "react";

function MetricRow({ label, value, weight = null }) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, color: "#94a3b8" }}>
      <span>
        {label}
        {weight != null ? ` (${Math.round(weight * 100)}%)` : ""}
      </span>
      <strong style={{ color: "#e2e8f0" }}>{Math.round(Number(value))}</strong>
    </div>
  );
}

function ConfidenceComponentsPanel({ audit = null }) {
  if (!audit) return null;

  const components = audit.components || audit;
  const weights = audit.weights || {};

  return (
    <div className="confidence-components-panel" style={{ marginTop: 8 }}>
      <strong style={{ fontSize: 11 }}>Confidence components</strong>
      <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
        <MetricRow label="Projection quality" value={components.projectionQuality} weight={weights.projectionQuality} />
        <MetricRow label="Recent form" value={components.recentForm} weight={weights.recentForm} />
        <MetricRow label="Edge score" value={components.edgeScore} weight={weights.edgeScore} />
        <MetricRow label="Hit rate" value={components.hitRate} weight={weights.hitRate} />
        <MetricRow label="Matchup" value={components.matchup ?? components.matchupQuality} weight={weights.matchup} />
      </div>
      {audit.weightedBase != null ? (
        <p style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>
          Weighted base: <strong style={{ color: "#cbd5e1" }}>{Math.round(Number(audit.weightedBase))}</strong>
        </p>
      ) : null}
      {Array.isArray(audit.penalties) && audit.penalties.length > 0 ? (
        <div style={{ marginTop: 6 }}>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>Penalties</span>
          <div style={{ display: "grid", gap: 2, marginTop: 4 }}>
            {audit.penalties.map((row) => (
              <div key={row.key || row.label} style={{ fontSize: 10, color: "#fca5a5" }}>
                −{row.amount} · {row.label}
              </div>
            ))}
            {audit.sanityPenalty > 0 ? (
              <div style={{ fontSize: 10, color: "#fca5a5" }}>−{audit.sanityPenalty} · Sanity check</div>
            ) : null}
          </div>
        </div>
      ) : audit.sanityPenalty > 0 ? (
        <div style={{ marginTop: 6 }}>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>Penalties</span>
          <div style={{ fontSize: 10, color: "#fca5a5", marginTop: 4 }}>−{audit.sanityPenalty} · Sanity check</div>
        </div>
      ) : (
        <p style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>Penalties: none</p>
      )}
      {audit.final != null ? (
        <p style={{ fontSize: 11, color: "#e2e8f0", marginTop: 8 }}>
          Final confidence: <strong>{Math.round(Number(audit.final))}</strong>
          {audit.floorApplied ? " · floor applied (65+)" : ""}
        </p>
      ) : null}
    </div>
  );
}

export default memo(ConfidenceComponentsPanel);
