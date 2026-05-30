import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { PIPELINE_STAGE_LABELS } from "../utils/liveProviderPipelineAudit.js";

function MetricRow({ label, value }) {
  return (
    <div className="live-feed-diagnostics__row">
      <span className="live-feed-diagnostics__label">{label}</span>
      <span className="live-feed-diagnostics__value">{value ?? "—"}</span>
    </div>
  );
}

function StageGrid({ stages = {} }) {
  const order = Object.values(PIPELINE_STAGE_LABELS);
  return (
    <div className="live-feed-diagnostics__stages">
      {order.map((stage) => (
        <div key={stage} className="live-feed-diagnostics__stage">
          <span>{stage}</span>
          <strong>{stages[stage] ?? 0}</strong>
        </div>
      ))}
    </div>
  );
}

function ProviderBlock({ title, row = null }) {
  if (!row) return null;
  const failure = row.failurePoint ? ` · ${row.failurePoint}` : "";
  return (
    <div className="live-feed-diagnostics__provider">
      <strong className="live-feed-diagnostics__provider-title">
        {title}
        {failure}
      </strong>
      <MetricRow label="URL" value={row.requestUrl || "—"} />
      <MetricRow label="URL status" value={row.urlStatus} />
      <MetricRow label="Response size" value={row.responseSize != null ? `${row.responseSize} bytes` : "—"} />
      <MetricRow
        label="Last successful fetch"
        value={row.lastSuccessfulFetchAt ? formatDateTime(row.lastSuccessfulFetchAt) : "—"}
      />
      <StageGrid stages={row.stages} />
      {row.lastError ? <p className="live-feed-diagnostics__error">{row.lastError}</p> : null}
    </div>
  );
}

function LiveFeedDiagnosticsPanel({ audit = null, liveFeedDiagnostics = null }) {
  const live = liveFeedDiagnostics || audit?.liveFeedDiagnostics;
  if (!live) return null;

  return (
    <section className="live-feed-diagnostics" aria-label="Live feed diagnostics">
      <div className="live-feed-diagnostics__head">
        <strong>Live Feed Diagnostics</strong>
        {audit?.feedMode ? (
          <span className="live-feed-diagnostics__mode">{audit.feedMode} MODE</span>
        ) : null}
      </div>
      <div className="live-feed-diagnostics__summary">
        <MetricRow label="Live combined fetched" value={live.liveCombinedFetched} />
        <MetricRow label="Cached board props" value={live.cacheBoardProps ?? audit?.cacheUsable} />
        <MetricRow
          label="Last successful fetch (any provider)"
          value={
            audit?.lastSuccessfulFetchAt
              ? formatDateTime(audit.lastSuccessfulFetchAt)
              : "—"
          }
        />
      </div>
      <ProviderBlock title="PrizePicks" row={live.prizepicks} />
      <ProviderBlock title="Underdog" row={live.underdog} />
    </section>
  );
}

export default memo(LiveFeedDiagnosticsPanel);
