import { memo } from "react";
import { styles } from "../theme/styles.js";
import { diagnosePrizePicksFailure, getPrizePicksDiagnostics } from "../utils/prizepicksDiagnostics.js";

function row(label, value) {
  const text = value == null || value === "" ? "—" : String(value);
  return (
    <div className="prizepicks-diagnostics__row" style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8 }}>
      <span style={{ color: "#94a3b8", fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 12, wordBreak: "break-all" }}>{text}</span>
    </div>
  );
}

function boolLabel(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "—";
}

function formatHeaders(headers = {}) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return "—";
  return entries.map(([key, value]) => `${key}: ${value}`).join(" · ");
}

function PrizePicksDiagnosticsPanel({ diagnostics: diagnosticsProp = null, feedRow = null }) {
  const fromWindow =
    typeof window !== "undefined" ? window.__PRIZEPICKS_DIAGNOSTICS__ : null;
  const d = diagnosticsProp || fromWindow || getPrizePicksDiagnostics();
  const feed = feedRow || {};
  const diagnosis = diagnosePrizePicksFailure(d);

  const requestUrl = d.requestUrl || feed.apiUrl || feed.endpointsTried?.[0] || "";
  const statusCode = d.statusCode ?? d.lastAttemptStatus ?? feed.lastAttemptStatus ?? null;
  const failureReason = d.failureReason || diagnosis.reason || d.lastError || feed.message || feed.statusLabel || "";

  return (
    <details className="prizepicks-diagnostics compact-settings-details" open>
      <summary style={styles.detailsSummary}>
        <span>
          <span className="mobile-hide-verbose" style={styles.eyebrow}>
            Temporary
          </span>
          <strong>PrizePicks Diagnostics</strong>
        </span>
      </summary>
      <div style={{ display: "grid", gap: 6, marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(15,23,42,0.5)" }}>
        {failureReason ? (
          <p className="prizepicks-diagnostics__failure" style={{ color: "#f87171", fontSize: 12, margin: "0 0 6px" }} role="status">
            {diagnosis.category}: {failureReason}
          </p>
        ) : null}

        <strong style={{ fontSize: 12, color: "#e2e8f0" }}>Pipeline</strong>
        {row("PrizePicks Request Sent", boolLabel(d.requestSent))}
        {row("PrizePicks Response Received", boolLabel(d.responseReceived))}
        {row("PrizePicks Parsed Props", d.parsedPropsCount ?? feed.parsedCount ?? feed.propsAfterParsing ?? 0)}
        {row("PrizePicks Final Props", d.finalPropsCount ?? d.validationCount ?? feed.usableCount ?? 0)}

        <strong style={{ fontSize: 12, color: "#e2e8f0", marginTop: 4 }}>Request / Response</strong>
        {row("Request URL", requestUrl)}
        {row("Response headers", formatHeaders(d.responseHeaders))}
        {row("Response body length", d.responseBodyLength ?? d.responseSize ?? 0)}
        {row("Captcha detected", boolLabel(d.captchaDetected))}
        {row("Blocked payload detected", boolLabel(d.blockedPayloadDetected))}
        {row("Failure category", diagnosis.category)}
        {row("Used cache fallback", boolLabel(d.usedCacheFallback))}
        {row("Live fetch failure", d.liveFetchFailureReason || (d.usedCacheFallback ? failureReason : "—"))}

        <strong style={{ fontSize: 12, color: "#e2e8f0", marginTop: 4 }}>Counts</strong>
        {row("Proxy mode", d.proxyMode || (d.proxyConfigured ? "proxied (app route → external proxy)" : "none"))}
        {row("External proxy host", d.externalProxyHost)}
        {row("Proxy configured", d.proxyConfigured ? "yes" : "no")}
        {row("HTTP executed", d.httpExecuted ? "yes" : "no")}
        {row("Response time", d.responseTimeMs != null ? `${d.responseTimeMs}ms` : "—")}
        {row("Status code", statusCode)}
        {row("Raw prop count", d.rawPropCount ?? feed.rawCount ?? feed.rawPropsLoaded ?? 0)}
        {row("MLB scoped count", d.mlbScopedCount ?? 0)}
        {row("Normalized count", d.normalizedCount ?? 0)}
        {row("Provider status", d.providerStatus || feed.status || "")}
        {row("Failure class", d.failureClass || "")}
        {row("Updated at", d.updatedAt || "")}
        {d.filterReasons && Object.keys(d.filterReasons).length ? (
          <div style={{ marginTop: 4 }}>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>Filter reasons</span>
            <pre style={{ fontSize: 11, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(d.filterReasons, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default memo(PrizePicksDiagnosticsPanel);
