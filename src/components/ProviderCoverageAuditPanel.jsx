import { memo } from "react";

function CountRow({ label, value, highlight = false }) {
  return (
    <p
      className="prop-pipeline-counters prop-pipeline-counters--meta"
      style={{ margin: "2px 0", color: highlight ? "#fde047" : undefined }}
    >
      {label}: {value ?? 0}
    </p>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="prop-pipeline-counters prop-pipeline-counters--meta" style={{ margin: "8px 0 4px", fontWeight: 600 }}>
      {children}
    </p>
  );
}

function ProviderCoverageAuditPanel({ audit = null }) {
  if (!audit) return null;

  const ud = audit.underdogAudit || {};
  const diagnosis = audit.diagnosis || {};

  return (
    <details className="compact-settings-details provider-coverage-audit" open>
      <summary>
        Provider Coverage Debug
        {audit.feedMode ? ` · ${audit.feedMode} MODE` : ""}
      </summary>
      <div className="prop-pipeline-counters-block" aria-label="Provider coverage debug">
        <SectionLabel>PrizePicks</SectionLabel>
        <CountRow label="Raw fetched" value={audit.prizepicksFetched} />
        <CountRow label="Parsed" value={audit.prizepicksParsed} />
        <CountRow
          label="Usable"
          value={audit.prizepicksUsable}
          highlight={audit.prizepicksUsable === 0 && audit.prizepicksTimedOut}
        />
        {audit.prizepicksTimedOut ? (
          <p className="compact-form-notice prop-pipeline-counters__failure" role="status">
            Timeout at: {audit.prizepicksTimeoutStep || "unknown step"}
          </p>
        ) : null}

        <SectionLabel>Underdog</SectionLabel>
        <CountRow label="Raw fetched" value={audit.underdogFetched} />
        <CountRow label="Parsed" value={audit.underdogParsed} />
        <CountRow label="Usable" value={audit.underdogUsable} />
        {ud.parserMismatch ? (
          <p className="compact-form-notice prop-pipeline-counters__failure" role="status">
            Parser mismatch — raw {ud.rawProps}, parsed {ud.parsedProps}
          </p>
        ) : null}
        {audit.underdogTimedOut ? (
          <p className="compact-form-notice prop-pipeline-counters__failure" role="status">
            Timeout at: {audit.underdogTimeoutStep || "unknown step"}
          </p>
        ) : null}

        <SectionLabel>Cache</SectionLabel>
        <CountRow label="Cached props loaded" value={audit.cacheUsable} />
        {audit.prizepicksUsedCache ? (
          <p className="prop-pipeline-counters prop-pipeline-counters--meta">PrizePicks: cache fallback</p>
        ) : null}
        {audit.underdogUsedCache ? (
          <p className="prop-pipeline-counters prop-pipeline-counters--meta">Underdog: cache fallback</p>
        ) : null}
        {audit.ingestionFallback ? (
          <p className="prop-pipeline-counters prop-pipeline-counters--meta">Ingestion: {audit.ingestionFallback}</p>
        ) : null}

        <SectionLabel>Final</SectionLabel>
        <CountRow label="Projection candidates" value={audit.projectionCandidates} />
        <CountRow label="Projected props" value={audit.projected} />
        <CountRow label="Verified props" value={audit.verified} />

        <div style={{ marginTop: 8, borderTop: "1px solid #334155", paddingTop: 8 }}>
          <CountRow label="Underdog MLB props" value={ud.mlbProps} />
          <CountRow label="Underdog supported props" value={ud.supportedProps} />
          <CountRow label="Underdog projected props" value={ud.projectedProps} />
        </div>

        {diagnosis.summary ? (
          <p className="prop-pipeline-counters prop-pipeline-counters--meta" style={{ marginTop: 8 }}>
            Bottleneck: {diagnosis.summary}
          </p>
        ) : null}
      </div>
    </details>
  );
}

export default memo(ProviderCoverageAuditPanel);
