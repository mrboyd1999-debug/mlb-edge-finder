import { memo } from "react";

function VerificationDashboard({ dashboard = null }) {
  if (!dashboard) return null;
  const { verifiedPasses = 0, verifiedFailures = 0, failureBreakdown = {} } = dashboard;
  const rows = [
    ["Missing Team", failureBreakdown.missingTeam],
    ["Missing Projection", failureBreakdown.missingProjection],
    ["Missing Matchup", failureBreakdown.missingMatchup],
    ["Low Edge", failureBreakdown.lowEdge],
    ["Low Confidence", failureBreakdown.lowConfidence],
    ["Other", failureBreakdown.other],
  ].filter(([, count]) => Number(count) > 0);

  return (
    <div className="verification-dashboard" aria-label="Verification dashboard">
      <p className="prop-pipeline-counters">
        Verified Passes: {verifiedPasses} · Verified Failures: {verifiedFailures}
      </p>
      {rows.length ? (
        <p className="prop-pipeline-counters prop-pipeline-counters--meta">
          Failure Breakdown: {rows.map(([label, count]) => `${label} ${count}`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

export default memo(VerificationDashboard);
