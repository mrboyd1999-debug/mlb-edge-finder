import { memo, useMemo } from "react";

function safeJson(value) {
  if (value == null) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `[stringify failed: ${error?.message || error}]`;
  }
}

function DebugSection({ title, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#94a3b8",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(2,6,23,0.92)",
          color: "#e2e8f0",
          fontSize: 10,
          lineHeight: 1.4,
          overflow: "auto",
          maxHeight: 160,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          border: "1px solid rgba(148,163,184,0.18)",
        }}
      >
        {safeJson(value)}
      </pre>
    </div>
  );
}

function ProjectionSchemaDebugPanel({ snapshot = null }) {
  const data = useMemo(() => {
    const projections = Array.isArray(snapshot?.projections) ? snapshot.projections : [];
    return {
      projectionCount: projections.length,
      firstProjection: projections[0] ?? null,
      firstNormalizedProp: snapshot?.normalizedProp ?? null,
      firstMergedProp: snapshot?.mergedProp ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
    };
  }, [snapshot]);

  if (!import.meta.env.DEV) return null;

  return (
    <aside
      aria-label="Projection schema debug panel"
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 99999,
        width: "min(420px, calc(100vw - 24px))",
        maxHeight: "min(70vh, 640px)",
        overflow: "auto",
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(15, 23, 42, 0.96)",
        color: "#f8fafc",
        boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        border: "2px solid #f59e0b",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 12, color: "#fbbf24" }}>TEMP PROJECTION DEBUG</strong>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>
          {data.updatedAt ? String(data.updatedAt).slice(11, 19) : "—"}
        </span>
      </div>

      <div style={{ fontSize: 12, marginBottom: 10, color: "#fcd34d" }}>
        projection count: {data.projectionCount ?? 0}
      </div>

      <DebugSection title="projections[0]" value={data.firstProjection} />
      <DebugSection title="normalizedProps[0]" value={data.firstNormalizedProp} />
      <DebugSection title="mergedProps[0]" value={data.firstMergedProp} />
    </aside>
  );
}

export default memo(ProjectionSchemaDebugPanel);
