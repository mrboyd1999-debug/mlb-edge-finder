import { memo } from "react";
import { AUDIT_LABELS } from "../utils/verificationDashboard.js";

function Metric({ label, value }) {
  return (
    <div className="verification-diagnostics__metric">
      <span className="verification-diagnostics__metric-label">{label}</span>
      <span className="verification-diagnostics__metric-value">{value ?? 0}</span>
    </div>
  );
}

function DiagnosticTable({ rows = [], emptyMessage = "None" }) {
  if (!rows.length) {
    return <p className="verification-diagnostics__empty">{emptyMessage}</p>;
  }
  return (
    <div className="verification-diagnostics__table-wrap">
      <table className="verification-diagnostics__table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Probability</th>
            <th>Confidence</th>
            <th>Playability</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.player}-${index}`}>
              <td>{row.player}</td>
              <td>{row.probability}%</td>
              <td>{row.confidence}%</td>
              <td>{row.playability}</td>
              <td>{row.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VerificationDashboard({ dashboard = null }) {
  if (!dashboard) return null;

  const {
    projected = 0,
    verifiedCount = 0,
    passedProbability = 0,
    failedProbability = 0,
    passedConfidence = 0,
    failedConfidence = 0,
    passedDataQuality = 0,
    failedDataQuality = 0,
    passedMatchup = 0,
    failedMatchup = 0,
    tierA = 0,
    tierB = 0,
    tierC = 0,
    topBeforeVerification = [],
    topAfterVerification = [],
    rejectionCounts = null,
    failureBreakdown = {},
    regressionReasons = {},
  } = dashboard;

  const showRejections = verifiedCount === 0;
  const rejectionRows = showRejections
    ? Object.entries(failureBreakdown || {})
        .filter(([, count]) => Number(count) > 0)
        .map(([key, count]) => ({
          label: AUDIT_LABELS[key] || key,
          count,
        }))
    : [];

  const regressionRows = showRejections
    ? Object.entries(regressionReasons || {})
        .filter(([, count]) => Number(count) > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([reason, count]) => ({ reason, count }))
    : [];

  return (
    <section className="verification-diagnostics" aria-label="Verification diagnostics">
      <h3 className="verification-diagnostics__title">Verification Diagnostics</h3>

      <div className="verification-diagnostics__grid">
        <Metric label="Projected" value={projected} />
        <Metric label="Passed Probability" value={passedProbability} />
        <Metric label="Failed Probability" value={failedProbability} />
        <Metric label="Passed Confidence" value={passedConfidence} />
        <Metric label="Failed Confidence" value={failedConfidence} />
        <Metric label="Passed Data Quality" value={passedDataQuality} />
        <Metric label="Failed Data Quality" value={failedDataQuality} />
        <Metric label="Passed Matchup" value={passedMatchup} />
        <Metric label="Failed Matchup" value={failedMatchup} />
        <Metric label="Tier A Count" value={tierA} />
        <Metric label="Tier B Count" value={tierB} />
        <Metric label="Tier C Count" value={tierC} />
      </div>

      {showRejections ? (
        <div className="verification-diagnostics__rejections">
          <h4 className="verification-diagnostics__subtitle">Rejection counts (verified = 0)</h4>
          {rejectionRows.length ? (
            <ul className="verification-diagnostics__rejection-list">
              {rejectionRows.map(({ label, count }) => (
                <li key={label}>
                  {label}: {count}
                </li>
              ))}
            </ul>
          ) : null}
          {rejectionCounts ? (
            <p className="verification-diagnostics__meta">
              {Object.entries(rejectionCounts)
                .filter(([, count]) => Number(count) > 0)
                .map(([key, count]) => `${AUDIT_LABELS[key] || key}: ${count}`)
                .join(" · ")}
            </p>
          ) : null}
          {regressionRows.length ? (
            <>
              <h4 className="verification-diagnostics__subtitle">Exact rejection reasons</h4>
              <ul className="verification-diagnostics__rejection-list">
                {regressionRows.map(({ reason, count }) => (
                  <li key={reason}>
                    {reason}: {count}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      <h4 className="verification-diagnostics__subtitle">Top 10 props before verification</h4>
      <DiagnosticTable rows={topBeforeVerification} emptyMessage="No projected props." />

      <h4 className="verification-diagnostics__subtitle">Top 10 props after verification</h4>
      <DiagnosticTable rows={topAfterVerification} emptyMessage="No verified props." />
    </section>
  );
}

export default memo(VerificationDashboard);
