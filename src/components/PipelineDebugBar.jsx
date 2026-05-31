import { memo } from "react";
import { styles } from "../theme/styles.js";

function PipelineDebugBar({ debug = null }) {
  if (!debug) return null;

  const sources = debug.sourceStatus || {};

  return (
    <section className="pipeline-debug-bar" style={styles.pipelineDebugBar} aria-label="Pipeline debug">
      <p style={styles.pipelineDebugTitle}>Pipeline Debug</p>
      <div style={styles.pipelineDebugGrid}>
        <span>Raw fetched: {debug.rawPropsFetched ?? 0}</span>
        <span>Parsed: {debug.parsedPropsCount ?? 0}</span>
        <span>Verified: {debug.verifiedPropsCount ?? 0}</span>
        <span>Ranked: {debug.rankedCount ?? 0}</span>
        <span>Rejected: {debug.rejectedPropsCount ?? 0}</span>
        <span>Refresh: {debug.lastSuccessfulRefresh ? String(debug.lastSuccessfulRefresh).slice(0, 19) : "—"}</span>
      </div>
      {debug.usedFallback ? (
        <p style={styles.pipelineDebugFallback}>{debug.fallbackLabel || "Fallback projections loaded"}</p>
      ) : null}
      <div style={styles.pipelineDebugSources}>
        {Object.entries(sources).map(([name, status]) => (
          <span key={name} style={styles.pipelineDebugSourcePill}>
            {name}: {status}
          </span>
        ))}
        {debug.apiKeys
          ? Object.entries(debug.apiKeys).map(([name, state]) => (
              <span key={`key-${name}`} style={styles.pipelineDebugSourcePill}>
                {name} key: {state}
              </span>
            ))
          : null}
      </div>
      {Array.isArray(debug.propTraces) && debug.propTraces.length ? (
        <div style={{ marginTop: 10 }}>
          <p style={styles.pipelineDebugTitle}>MLB Prop Pipeline Traces</p>
          {debug.propTraces.slice(0, 8).map((row) => (
            <div
              key={row.id || `${row.playerName}-${row.statType}-${row.recordedAt}`}
              style={{
                marginBottom: 8,
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(15,23,42,0.55)",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              <div>
                <strong>{row.playerName}</strong> · {row.statType} · line {row.line}
              </div>
              <div>
                Failure reason: <code>{row.failureCode || "—"}</code>
                {row.failureReason ? ` — ${row.failureReason}` : ""}
              </div>
              <div>
                Last successful stage: <code>{row.lastSuccessfulStage || "—"}</code>
              </div>
              {row.success ? (
                <div>
                  Projection: {row.projection} · Edge: {row.edge} · Pick: {row.recommendation}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default memo(PipelineDebugBar);
