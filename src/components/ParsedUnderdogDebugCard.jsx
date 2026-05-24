import { styles } from "../theme/styles.js";

export default function ParsedUnderdogDebugCard({ picks = [] }) {
  const rows = (picks || []).filter(Boolean).slice(0, 5);
  if (!rows.length) return null;

  return (
    <section
      className="parsed-underdog-debug-card"
      style={{ ...styles.compactPanel, marginTop: "8px", padding: "10px 12px", border: "1px solid #1e3a8a" }}
      aria-label="Parsed Underdog debug preview"
    >
      <strong style={{ fontSize: 13, color: "#93c5fd" }}>Parsed Underdog Preview (first 5)</strong>
      <div style={{ marginTop: "8px", display: "grid", gap: "6px" }}>
        {rows.map((prop, idx) => (
          <div
            key={prop.id || `ud-preview-${idx}`}
            style={{
              padding: "8px",
              borderRadius: "6px",
              background: "#0b1220",
              border: "1px solid #1e293b",
              fontSize: "11px",
              lineHeight: 1.4,
            }}
          >
            <div style={{ fontWeight: 800, color: "#e2e8f0" }}>
              {prop.player || prop.playerName} · {prop.statType || prop.market} · {prop.line}
            </div>
            <div style={{ color: "#94a3b8", marginTop: "2px" }}>
              {prop.team || "—"} {prop.opponent ? `vs ${prop.opponent}` : ""} · {prop.sport || prop.league || "—"}
            </div>
            <div style={{ color: "#64748b", marginTop: "2px" }}>
              source={prop.normalizedSource || prop.source} · conf={prop.confidence ?? prop.confidenceScore ?? "—"}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
