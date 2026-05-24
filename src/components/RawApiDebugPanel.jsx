import { useCallback, useEffect, useState } from "react";
import { styles } from "../theme/styles.js";
import { buildRawDebugRows, dumpDebugGlobals } from "../utils/rawResponseDebug.js";

function JsonBlock({ value }) {
  const text =
    value == null
      ? "—"
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  return (
    <pre
      style={{
        margin: 0,
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgba(15,23,42,0.85)",
        color: "#cbd5e1",
        fontSize: 11,
        lineHeight: 1.45,
        overflow: "auto",
        maxHeight: 220,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </pre>
  );
}

export default function RawApiDebugPanel({ open = false, onToggle }) {
  const [rows, setRows] = useState(() => buildRawDebugRows());

  const refresh = useCallback(() => {
    dumpDebugGlobals("manual-refresh");
    setRows(buildRawDebugRows());
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  return (
    <>
      <button
        type="button"
        className="raw-api-debug-toggle"
        onClick={onToggle}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 1200,
          padding: "10px 14px",
          borderRadius: 999,
          border: "1px solid rgba(148,163,184,0.35)",
          background: open ? "#1e293b" : "#0f172a",
          color: "#f8fafc",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}
      >
        {open ? "Hide Raw API Debug" : "Show Raw API Debug"}
      </button>

      {open ? (
        <section
          aria-label="Raw API Debug"
          style={{
            position: "fixed",
            inset: "auto 12px 68px 12px",
            maxHeight: "72vh",
            overflow: "auto",
            zIndex: 1199,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "rgba(2,6,23,0.96)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <p style={{ ...styles.eyebrow, margin: 0 }}>Ingestion</p>
              <strong style={{ color: "#f8fafc" }}>Raw Provider Debug</strong>
            </div>
            <button
              type="button"
              onClick={refresh}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid rgba(148,163,184,0.35)",
                background: "transparent",
                color: "#e2e8f0",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Refresh + Log Console
            </button>
          </div>
          <p style={{ ...styles.compactFlags, marginTop: 8 }}>
            Console: <code>window.__DEBUG_RESPONSES__</code>, <code>window.__DEBUG_PROVIDER_STATUS__</code>,{" "}
            <code>window.__NORMALIZED_PROPS__</code>
          </p>

          {rows.map((row) => (
            <article
              key={row.provider}
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.18)",
                background: "rgba(15,23,42,0.55)",
              }}
            >
              <strong style={{ color: "#e2e8f0", textTransform: "capitalize" }}>{row.provider}</strong>
              <p style={styles.compactFlags}>
                status {row.httpStatus ?? "—"} · raw {row.rawCount} · normalized {row.normalizedPropCount}
              </p>
              <p style={{ ...styles.compactFlags, wordBreak: "break-all" }}>{row.endpointUrl || "—"}</p>
              <p style={styles.compactFlags}>keys: {(row.topLevelKeys || []).join(", ") || "—"}</p>
              {row.message ? <p style={{ ...styles.compactFlags, color: "#fca5a5" }}>{row.message}</p> : null}
              {row.parserErrorStack?.length ? (
                <>
                  <p style={styles.compactFlags}>parser error stack</p>
                  <JsonBlock value={row.parserErrorStack.join("\n")} />
                </>
              ) : null}
              <p style={{ ...styles.compactFlags, marginTop: 8 }}>first raw object</p>
              <JsonBlock value={row.firstRawObject} />
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
