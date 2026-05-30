import { memo } from "react";
import { getProviderFetchDiagnostics, PROVIDER_SLOW_THRESHOLD_MS } from "../utils/providerFetchDiagnostics.js";
import { diagnosePrizePicksFailure, getPrizePicksDiagnostics } from "../utils/prizepicksDiagnostics.js";

function metric(label, value) {
  return (
    <div className="provider-feed-diagnostics__metric">
      <span className="provider-feed-diagnostics__metric-label">{label}</span>
      <span className="provider-feed-diagnostics__metric-value">{value ?? "—"}</span>
    </div>
  );
}

function boolText(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "—";
}

function ProviderBlock({ title, row = {}, isPrizePicks = false }) {
  const responseMs = row.responseTimeMs != null ? `${row.responseTimeMs}ms` : "—";
  const timeoutNote =
    row.timedOut || row.slow
      ? row.timedOut
        ? `Timed out (>${PROVIDER_SLOW_THRESHOLD_MS / 1000}s)`
        : `Slow (≥${PROVIDER_SLOW_THRESHOLD_MS / 1000}s)`
      : "";
  const ppDiag = isPrizePicks ? getPrizePicksDiagnostics() : null;
  const diagnosis = isPrizePicks ? diagnosePrizePicksFailure({ ...ppDiag, ...row }) : null;
  const failureReason = row.failureReason || ppDiag?.failureReason || diagnosis?.reason || row.lastError || "";

  return (
    <div className="provider-feed-diagnostics__block">
      <h5 className="provider-feed-diagnostics__title">{title}</h5>
      <div className="provider-feed-diagnostics__grid">
        {metric("Response Time", responseMs)}
        {metric("HTTP Status", row.httpStatus ?? "—")}
        {metric("Payload Size", row.payloadSize != null ? `${row.payloadSize} chars` : "—")}
        {metric("Parsed Props", row.parsedPropsCount ?? 0)}
        {metric("Final Props", row.finalPropsCount ?? 0)}
      </div>
      {isPrizePicks ? (
        <div className="provider-feed-diagnostics__grid">
          {metric("Request Sent", boolText(row.requestSent ?? ppDiag?.requestSent))}
          {metric("Response Received", boolText(row.responseReceived ?? ppDiag?.responseReceived))}
          {metric("Captcha", boolText(row.captchaDetected ?? ppDiag?.captchaDetected))}
          {metric("Blocked Payload", boolText(row.blockedPayloadDetected ?? ppDiag?.blockedPayloadDetected))}
        </div>
      ) : null}
      {row.skipped ? <p className="provider-feed-diagnostics__note">Fetch skipped (not configured).</p> : null}
      {failureReason ? (
        <p className="provider-feed-diagnostics__warn" role="status">
          {diagnosis?.category ? `${diagnosis.category}: ` : ""}
          {failureReason}
        </p>
      ) : null}
      {timeoutNote && !failureReason ? (
        <p className="provider-feed-diagnostics__warn" role="status">
          {timeoutNote}
          {row.lastError ? ` — ${row.lastError}` : ""}
        </p>
      ) : null}
      {row.requestUrl ? (
        <p className="provider-feed-diagnostics__note">Request URL: {row.requestUrl}</p>
      ) : null}
      {row.lastPhase ? <p className="provider-feed-diagnostics__note">Last phase: {row.lastPhase}</p> : null}
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
        <ProviderBlock title="PrizePicks" row={d.prizepicks || {}} isPrizePicks />
        <ProviderBlock title="Underdog" row={d.underdog || {}} />
      </div>
    </details>
  );
}

export default memo(ProviderFeedDiagnosticsPanel);
