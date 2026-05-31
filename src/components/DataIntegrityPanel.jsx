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

function DataIntegrityPanel({ audit = null }) {
  if (!audit) return null;
  return (
    <div className="data-integrity-panel" style={{ marginTop: 8 }}>
      <strong style={{ fontSize: 11 }}>Data integrity</strong>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
          marginTop: 6,
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
