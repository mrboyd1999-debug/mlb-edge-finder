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
  const displayRejection = audit.propDisplayRejectionSummary || null;
  const topDisplayRejections = audit.propDisplayRejectionAudit?.topRejectionReasons || [];
  const projectionAudit = audit.projectionGenerationAudit || null;
  const projectionRejections = projectionAudit?.rejectionRows || [];
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

        {displayRejection ? (
          <div>
            <p className="prop-pipeline-counters prop-pipeline-counters--meta" style={{ marginTop: 8, marginBottom: 4 }}>
              Display rejection summary{displayRejection.emergencyMode ? " (emergency debug)" : ""}:
            </p>
            <p className="prop-pipeline-counters prop-pipeline-counters--meta">
              total {displayRejection.totalProps ?? 0} · missing projection {displayRejection.rejectedMissingProjection ?? 0}{" "}
              · low probability {displayRejection.rejectedLowProbability ?? 0} · low confidence{" "}
              {displayRejection.rejectedLowConfidence ?? 0} · low edge {displayRejection.rejectedLowEdge ?? 0} · missing
              player {displayRejection.rejectedMissingPlayer ?? 0} · accepted {displayRejection.accepted ?? 0}
            </p>
            {topDisplayRejections.length ? (
              <table className="pipeline-coverage-audit__table">
                <thead>
                  <tr>
                    <th scope="col">Top display rejection</th>
                    <th scope="col">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {topDisplayRejections.map((row) => (
                    <tr key={row.reason}>
                      <td>{row.reason}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
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

        {projectionAudit ? (
          <div className="pipeline-coverage-audit__projection-breakdown">
            <p className="prop-pipeline-counters prop-pipeline-counters--meta" style={{ marginTop: 8, marginBottom: 4 }}>
              Projection generation — candidates: {projectionAudit.candidateCount ?? 0} · filtered:{" "}
              {projectionAudit.filteredCount ?? 0} · projected: {projectionAudit.projectedCount ?? 0}
            </p>
            {projectionRejections.length ? (
              <table className="pipeline-coverage-audit__table">
                <thead>
                  <tr>
                    <th scope="col">Rejection reason</th>
                    <th scope="col">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {projectionRejections.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="prop-pipeline-counters prop-pipeline-counters--meta">No projection rejections recorded.</p>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default memo(PipelineCoverageAuditPanel);
