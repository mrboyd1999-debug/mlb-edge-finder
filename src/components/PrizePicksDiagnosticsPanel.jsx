import { memo } from "react";
import { styles } from "../theme/styles.js";
import { getPrizePicksDiagnostics } from "../utils/prizepicksDiagnostics.js";

function row(label, value) {
  const text = value == null || value === "" ? "—" : String(value);
  return (
    <div className="prizepicks-diagnostics__row" style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8 }}>
      <span style={{ color: "#94a3b8", fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 12, wordBreak: "break-all" }}>{text}</span>
    </div>
  );
}

function PrizePicksDiagnosticsPanel({ diagnostics: diagnosticsProp = null, feedRow = null }) {
  const fromWindow =
    typeof window !== "undefined" ? window.__PRIZEPICKS_DIAGNOSTICS__ : null;
  const d = diagnosticsProp || fromWindow || getPrizePicksDiagnostics();
  const feed = feedRow || {};

  const requestUrl = d.requestUrl || feed.apiUrl || feed.endpointsTried?.[0] || "";
  const statusCode = d.statusCode ?? d.lastAttemptStatus ?? feed.lastAttemptStatus ?? null;
  const lastError =
    d.lastError || feed.message || feed.lastError || feed.statusLabel || "";

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
        {row("Request URL", requestUrl)}
        {row("Proxy mode", d.proxyMode || (d.proxyConfigured ? "proxied (app route → external proxy)" : "none"))}
        {row("External proxy host", d.externalProxyHost)}
        {row("Proxy configured", d.proxyConfigured ? "yes" : "no")}
        {row("HTTP executed", d.httpExecuted ? "yes" : "no")}
        {row("Status code", statusCode)}
        {row("Response size (chars)", d.responseSize ?? 0)}
        {row("Raw prop count", d.rawPropCount ?? feed.rawCount ?? feed.rawPropsLoaded ?? 0)}
        {row("MLB scoped count", d.mlbScopedCount ?? 0)}
        {row("Normalized count", d.normalizedCount ?? feed.parsedCount ?? feed.propsAfterParsing ?? 0)}
        {row("Validation count", d.validationCount ?? feed.usableCount ?? feed.usablePropsCount ?? 0)}
        {row("MLB usable count", d.mlbUsableCount ?? 0)}
        {row("Provider status", d.providerStatus || feed.status || "")}
        {row("UI connection tier", d.uiConnectionTier || feed.connectionTier || "")}
        {row("Failure class", d.failureClass || "")}
        {row("Last error", lastError)}
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
