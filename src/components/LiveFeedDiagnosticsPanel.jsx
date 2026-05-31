import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { LIVE_STAGE_LABELS } from "../utils/liveFeedFailureAnalysis.js";

function MetricRow({ label, value }) {
  return (
    <div className="live-feed-diagnostics__row">
      <span className="live-feed-diagnostics__label">{label}</span>
      <span className="live-feed-diagnostics__value">{value ?? "—"}</span>
    </div>
  );
}

function StageGrid({ stages = {} }) {
  const order = Object.values(LIVE_STAGE_LABELS);
  return (
    <div className="live-feed-diagnostics__stages live-feed-diagnostics__stages--four">
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

  return (
    <div className="live-feed-diagnostics__provider">
      <strong className="live-feed-diagnostics__provider-title">{title}</strong>
      {row.endpointDeprecated ? (
        <p className="live-feed-diagnostics__warn" role="alert">
          Endpoint deprecated
        </p>
      ) : null}
      {row.exactFailureReason ? (
        <p className="live-feed-diagnostics__warn" role="status">
          Root cause: {row.exactFailureReason}
        </p>
      ) : null}
      <MetricRow label="Endpoint" value={row.endpoint || row.requestUrl || "—"} />
      <MetricRow label="HTTP status" value={row.httpStatus ?? row.urlStatus ?? "—"} />
      <MetricRow label="Response bytes" value={row.responseBytes ?? row.responseSize ?? "—"} />
      <MetricRow
        label="Response time"
        value={row.responseTimeMs != null ? `${row.responseTimeMs} ms` : "—"}
      />
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

  const endpointWarnings = live.endpointAudit?.warnings || [];

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
          value={audit?.lastSuccessfulFetchAt ? formatDateTime(audit.lastSuccessfulFetchAt) : "—"}
        />
      </div>
      {endpointWarnings.length ? (
        <div className="live-feed-diagnostics__endpoint-warnings">
          {endpointWarnings.map((warning) => (
            <p key={warning} className="live-feed-diagnostics__warn">
              {warning}
            </p>
          ))}
        </div>
      ) : null}
      <ProviderBlock title="PrizePicks" row={live.prizepicks} />
      <ProviderBlock title="Underdog" row={live.underdog} />
    </section>
  );
}

export default memo(LiveFeedDiagnosticsPanel);
