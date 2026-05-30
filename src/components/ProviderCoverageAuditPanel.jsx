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

function ProviderCoverageAuditPanel({ audit = null }) {
  if (!audit) return null;

  const ud = audit.underdogAudit || {};
  const diagnosis = audit.diagnosis || {};

  return (
    <details className="compact-settings-details provider-coverage-audit" open>
      <summary>Provider Coverage Audit</summary>
      <div className="prop-pipeline-counters-block" aria-label="Provider coverage audit">
        <CountRow label="PrizePicks fetched" value={audit.prizepicksFetched} />
        <CountRow label="PrizePicks parsed" value={audit.prizepicksParsed} />
        <CountRow
          label="PrizePicks usable"
          value={audit.prizepicksUsable}
          highlight={audit.prizepicksUsable === 0 && audit.prizepicksTimedOut}
        />
        {audit.prizepicksTimedOut ? (
          <p className="compact-form-notice prop-pipeline-counters__failure" role="status">
            PrizePicks timeout at: {audit.prizepicksTimeoutStep || "unknown step"}
          </p>
        ) : null}
        {audit.prizepicksUsedCache ? (
          <p className="prop-pipeline-counters prop-pipeline-counters--meta">PrizePicks source: cache fallback</p>
        ) : null}

        <CountRow label="Underdog fetched" value={audit.underdogFetched} />
        <CountRow label="Underdog parsed" value={audit.underdogParsed} />
        <CountRow label="Underdog usable" value={audit.underdogUsable} />

        <div style={{ marginTop: 8 }}>
          <p className="prop-pipeline-counters prop-pipeline-counters--meta" style={{ marginBottom: 4 }}>
            Underdog breakdown:
          </p>
          <CountRow label="Raw props" value={ud.rawProps} />
          <CountRow label="MLB props" value={ud.mlbProps} />
          <CountRow label="Supported props" value={ud.supportedProps} />
          <CountRow label="Projected props" value={ud.projectedProps} />
          {ud.parserMismatch ? (
            <p className="compact-form-notice prop-pipeline-counters__failure" role="status">
              Underdog parser mismatch detected
            </p>
          ) : null}
          {ud.usedCache ? (
            <p className="prop-pipeline-counters prop-pipeline-counters--meta">Underdog source: cache</p>
          ) : null}
        </div>

        <div style={{ marginTop: 8, borderTop: "1px solid #334155", paddingTop: 8 }}>
          <CountRow label="Combined usable" value={audit.combinedUsable} />
          <CountRow label="Projection candidates" value={audit.projectionCandidates} />
          <CountRow label="Projected" value={audit.projected} />
          <CountRow label="Verified" value={audit.verified} />
        </div>

        {diagnosis.summary ? (
          <p className="prop-pipeline-counters prop-pipeline-counters--meta" style={{ marginTop: 8 }}>
            Likely cause: {diagnosis.summary}
          </p>
        ) : null}
      </div>
    </details>
  );
}

export default memo(ProviderCoverageAuditPanel);
