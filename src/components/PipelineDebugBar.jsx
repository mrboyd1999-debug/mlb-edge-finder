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
    </section>
  );
}

export default memo(PipelineDebugBar);
