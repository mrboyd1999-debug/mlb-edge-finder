import { memo } from "react";

function AuditRow({ entry }) {
  if (!entry) return null;
  return (
    <div
      style={{
        border: "1px solid #334155",
        borderRadius: 8,
        padding: "8px 10px",
        marginTop: 8,
        background: "#0f172a",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ color: "#e2e8f0", fontSize: 12 }}>{entry.player}</strong>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>{entry.market}</span>
      </div>
      <p style={{ fontSize: 11, color: "#cbd5e1", margin: "6px 0 0" }}>
        Current: <strong>Tier {entry.currentTier}</strong>
        {" · "}
        Expected: <strong>Tier {entry.expectedTier}</strong>
      </p>
      {entry.reasonForDowngrade ? (
        <p style={{ fontSize: 10, color: "#fca5a5", margin: "4px 0 0" }}>
          Reason: {entry.reasonForDowngrade}
        </p>
      ) : null}
      {entry.confidenceAudit ? (
        <div style={{ display: "grid", gap: 2, marginTop: 6, fontSize: 10, color: "#94a3b8" }}>
          <span>
            Confidence {entry.confidenceAudit.confidence_before_penalties} →{" "}
            {entry.confidenceAudit.confidence_after_penalties} → final{" "}
            {entry.confidenceAudit.final_confidence}
          </span>
          <span>
            Proj {entry.confidenceAudit.projection_score} · Hit {entry.confidenceAudit.hit_rate_score} ·
            Matchup {entry.confidenceAudit.matchup_score}
          </span>
        </div>
      ) : null}
      {Array.isArray(entry.downgradeReasons) && entry.downgradeReasons.length > 0 ? (
        <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 10, color: "#94a3b8" }}>
          {entry.downgradeReasons.map((row) => (
            <li key={`${entry.player}-${row.key}-${row.label}`}>
              {row.amount != null ? `−${row.amount} · ${row.label}` : row.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TierAuditPanel({ auditRows = [], limit = 12 }) {
  const rows = (auditRows || []).slice(0, limit);
  if (!rows.length) return null;

  return (
    <section className="tier-audit-panel" aria-label="Tier audit">
      <h3 style={{ fontSize: 12, color: "#e2e8f0", margin: 0 }}>Tier audit</h3>
      <p style={{ fontSize: 10, color: "#64748b", margin: "4px 0 0" }}>
        Current vs expected tier with penalty breakdown
      </p>
      {rows.map((entry) => (
        <AuditRow key={`${entry.player}-${entry.market}`} entry={entry} />
      ))}
    </section>
  );
}

export default memo(TierAuditPanel);
