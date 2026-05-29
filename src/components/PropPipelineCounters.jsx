import { memo } from "react";

function PropPipelineCounters({ counts = null, compact = false }) {
  if (!counts) return null;
  const {
    raw = counts.fetched ?? 0,
    normalized = 0,
    projected = counts.withProjections ?? counts.projected ?? 0,
    verified = 0,
    rendered = 0,
    prizepicksFetch = 0,
    underdogFetch = 0,
    fallbackMode = null,
    failureReason = "",
    bottleneckStage = null,
  } = counts;

  if (compact) {
    return (
      <p className="prop-pipeline-counters" aria-label="Prop pipeline counts">
        Raw: {raw} · Normalized: {normalized} · Projected: {projected} · Verified: {verified} · Rendered:{" "}
        {rendered}
      </p>
    );
  }

  return (
    <div className="prop-pipeline-counters-block" aria-label="Prop pipeline counts">
      <p className="prop-pipeline-counters">
        Raw: {raw} · Normalized: {normalized} · Projected: {projected} · Verified: {verified} · Rendered: {rendered}
      </p>
      <p className="prop-pipeline-counters prop-pipeline-counters--meta">
        Providers — PrizePicks: {prizepicksFetch} · Underdog: {underdogFetch}
        {fallbackMode ? ` · Fallback: ${fallbackMode}` : ""}
      </p>
      {failureReason ? (
        <p className="compact-form-notice prop-pipeline-counters__failure" role="status">
          {bottleneckStage ? `[${bottleneckStage}] ` : ""}
          {failureReason}
        </p>
      ) : null}
    </div>
  );
}

export default memo(PropPipelineCounters);
