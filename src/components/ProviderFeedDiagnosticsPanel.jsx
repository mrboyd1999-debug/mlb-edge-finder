import { memo } from "react";
import { getProviderFetchDiagnostics, PROVIDER_SLOW_THRESHOLD_MS } from "../utils/providerFetchDiagnostics.js";

function metric(label, value) {
  return (
    <div className="provider-feed-diagnostics__metric">
      <span className="provider-feed-diagnostics__metric-label">{label}</span>
      <span className="provider-feed-diagnostics__metric-value">{value ?? "—"}</span>
    </div>
  );
}

function ProviderBlock({ title, row = {} }) {
  const responseMs = row.responseTimeMs != null ? `${row.responseTimeMs}ms` : "—";
  const timeoutNote =
    row.timedOut || row.slow
      ? row.timedOut
        ? `Timed out (>${PROVIDER_SLOW_THRESHOLD_MS / 1000}s)`
        : `Slow (≥${PROVIDER_SLOW_THRESHOLD_MS / 1000}s)`
      : "";

  return (
    <div className="provider-feed-diagnostics__block">
      <h5 className="provider-feed-diagnostics__title">{title}</h5>
      <div className="provider-feed-diagnostics__grid">
        {metric("Response Time", responseMs)}
        {metric("HTTP Status", row.httpStatus ?? "—")}
        {metric("Payload Size", row.payloadSize != null ? `${row.payloadSize} chars` : "—")}
        {metric("Parsed Props", row.parsedPropsCount ?? 0)}
      </div>
      {row.skipped ? <p className="provider-feed-diagnostics__note">Fetch skipped (not configured).</p> : null}
      {timeoutNote ? (
        <p className="provider-feed-diagnostics__warn" role="status">
          {timeoutNote}
          {row.lastError ? ` — ${row.lastError}` : ""}
        </p>
      ) : null}
      {row.lastPhase && !timeoutNote ? (
        <p className="provider-feed-diagnostics__note">Last phase: {row.lastPhase}</p>
      ) : null}
    </div>
  );
}

function ProviderFeedDiagnosticsPanel({ diagnostics = null }) {
  const d =
    diagnostics ||
    (typeof window !== "undefined" ? window.__PROVIDER_FETCH_DIAGNOSTICS__ : null) ||
    getProviderFetchDiagnostics();

  return (
    <details className="provider-feed-diagnostics compact-settings-details" open>
      <summary>
        <strong>Provider Feed Diagnostics</strong>
      </summary>
      <div className="provider-feed-diagnostics__body">
        <ProviderBlock title="PrizePicks" row={d.prizepicks || {}} />
        <ProviderBlock title="Underdog" row={d.underdog || {}} />
      </div>
    </details>
  );
}

export default memo(ProviderFeedDiagnosticsPanel);
