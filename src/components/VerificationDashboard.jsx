import { memo } from "react";

function VerificationDashboard({ dashboard = null }) {
  if (!dashboard) return null;
  const {
    verifiedPasses = 0,
    researchPasses = 0,
    verifiedFailures = 0,
    failureBreakdown = {},
    auditLabels = {},
  } = dashboard;

  const labelFor = (key) => auditLabels[key] || key;

  const rows = Object.entries(failureBreakdown)
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => [labelFor(key), count]);

  return (
    <div className="verification-dashboard" aria-label="Verification dashboard">
      <p className="prop-pipeline-counters">
        Verified Passes: {verifiedPasses} · Research Plays: {researchPasses} · Verified Failures:{" "}
        {verifiedFailures}
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
