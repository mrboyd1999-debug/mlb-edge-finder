import { memo } from "react";

function CountRow({ label, value }) {
  return (
    <p className="prop-pipeline-counters prop-pipeline-counters--meta" style={{ margin: "2px 0" }}>
      {label}: {value ?? 0}
    </p>
  );
}

function PipelineCoverageAuditPanel({ audit = null }) {
  if (!audit) return null;

  const rejections = Object.entries(audit.rejections || {}).filter(([, count]) => Number(count) > 0);
  const warning = audit.coverageWarning;

  return (
    <details className="compact-settings-details pipeline-coverage-audit" open>
      <summary>Pipeline Coverage Audit</summary>
      <div className="prop-pipeline-counters-block" aria-label="Pipeline coverage audit">
        <CountRow label="1. PrizePicks raw props" value={audit.rawPrizePicks} />
        <CountRow label="2. Underdog raw props" value={audit.rawUnderdog} />
        <CountRow label="3. Combined raw props" value={audit.combinedRaw ?? audit.rawPropsFetched} />
        <CountRow label="4. After cache merge" value={audit.afterCacheMerge} />
        <CountRow label="5. After sport filter" value={audit.afterSportFilter} />
        <CountRow label="6. After MLB-only filter" value={audit.afterMlbOnlyFilter} />
        <CountRow label="7. After market filter (supported only)" value={audit.afterMarketFilter} />
        <CountRow label="8. After duplicate removal" value={audit.afterDuplicateRemoval} />
        <CountRow label="9. After player normalization" value={audit.afterPlayerNormalization} />
        <CountRow label="10. After line validation" value={audit.afterLineValidation} />
        <CountRow label="11. After projection eligibility" value={audit.projectionCandidates ?? audit.afterProjectionFilter} />
        <CountRow label="12. Projected props" value={audit.projectedProps ?? audit.afterProjectionMerge} />
        <CountRow label="13. Verified props" value={audit.verifiedProps ?? audit.afterVerificationFilter} />
        <CountRow label="14. Top displayed plays" value={audit.displayedProps} />

        {warning ? (
          <p className="compact-form-notice prop-pipeline-counters__failure" role="status">
            {warning.message}
            {warning.topRejectionReason ? ` · Top rejection: ${warning.topRejectionReason}` : ""}
            {warning.dropOffStage ? ` · Drop-off: ${warning.dropOffStage}` : ""}
          </p>
        ) : null}

        {audit.dropOffDetail ? (
          <p className="prop-pipeline-counters prop-pipeline-counters--meta">{audit.dropOffDetail}</p>
        ) : null}

        {rejections.length ? (
          <div>
            <p className="prop-pipeline-counters prop-pipeline-counters--meta" style={{ marginBottom: 4 }}>
              Rejected by reason:
            </p>
            {rejections.map(([reason, count]) => (
              <p key={reason} className="prop-pipeline-counters prop-pipeline-counters--meta" style={{ margin: "2px 0" }}>
                {reason}: {count}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default memo(PipelineCoverageAuditPanel);
