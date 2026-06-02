import { memo } from "react";
import {
  INTEGRITY_MISSING,
  INTEGRITY_PARTIAL,
  INTEGRITY_VERIFIED,
} from "../utils/dataIntegrity.js";

const TONE_STYLES = {
  [INTEGRITY_VERIFIED]: { background: "#052e16", color: "#86efac", border: "1px solid #166534" },
  [INTEGRITY_PARTIAL]: { background: "#422006", color: "#fcd34d", border: "1px solid #854d0e" },
  [INTEGRITY_MISSING]: { background: "#450a0a", color: "#fca5a5", border: "1px solid #991b1b" },
};

function IntegrityCell({ label, value }) {
  const tone = TONE_STYLES[value] || TONE_STYLES[INTEGRITY_MISSING];
  const text =
    value === INTEGRITY_VERIFIED ? "Verified" : value === INTEGRITY_PARTIAL ? "Partial" : "Missing";
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 10, color: "#94a3b8" }}>{label}</span>
      <span
        style={{
          ...tone,
          display: "inline-block",
          width: "fit-content",
          borderRadius: 999,
          padding: "2px 8px",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        {text}
      </span>
    </div>
  );
}

function IntegrityMetric({ label, value }) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return (
    <span>
      {label}: <strong style={{ color: "#e2e8f0" }}>{Math.round(Number(value))}</strong>
    </span>
  );
}

function DataIntegrityPanel({ audit = null }) {
  if (!audit) return null;
  const components = audit.integrityComponents || {};
  const projectionIntegrity = audit.projectionIntegrity ?? components.projectionIntegrity;
  const seasonIntegrity = audit.seasonDataIntegrity ?? components.seasonDataIntegrity;
  const opponentIntegrity = audit.opponentIntegrity ?? components.opponentIntegrity;
  const pitcherIntegrity = audit.pitcherIntegrity ?? components.pitcherIntegrity;

  return (
    <div className="data-integrity-panel" style={{ marginTop: 8 }}>
      <strong style={{ fontSize: 11 }}>Integrity audit</strong>
      {audit.integrityScore != null ? (
        <p style={{ fontSize: 11, color: "#e2e8f0", marginTop: 4 }}>
          Weighted integrity score: <strong>{Math.round(Number(audit.integrityScore))}</strong>
          {audit.reviewNeeded ? " · Review Needed" : ""}
          {audit.pitcherMatchupUnverified ? " · Pitcher matchup not verified" : ""}
        </p>
      ) : null}
      <div style={{ display: "grid", gap: 4, marginTop: 8, fontSize: 10, color: "#94a3b8" }}>
        <IntegrityMetric label="Projection integrity" value={projectionIntegrity} />
        <IntegrityMetric label="Season integrity" value={seasonIntegrity} />
        <IntegrityMetric label="Opponent integrity" value={opponentIntegrity} />
        <IntegrityMetric label="Pitcher integrity" value={pitcherIntegrity} />
      </div>
      {audit.weightedBreakdown ? (
        <p style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>
          Weighted: projection {audit.weightedBreakdown.projection ?? "—"} · season{" "}
          {audit.weightedBreakdown.season ?? "—"} · opponent {audit.weightedBreakdown.opponent ?? "—"} · pitcher{" "}
          {audit.weightedBreakdown.pitcher ?? "—"}
        </p>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
          marginTop: 8,
        }}
      >
        <IntegrityCell label="Player Data Score" value={audit.playerDataScore} />
        <IntegrityCell label="Matchup Data Score" value={audit.matchupDataScore} />
        <IntegrityCell label="Projection Data Score" value={audit.projectionDataScore} />
        <IntegrityCell label="Probability Data Score" value={audit.probabilityDataScore} />
      </div>
    </div>
  );
}

export default memo(DataIntegrityPanel);
