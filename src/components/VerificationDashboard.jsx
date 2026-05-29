import { memo } from "react";
import { AUDIT_LABELS } from "../utils/verificationDashboard.js";

function VerificationDashboard({ dashboard = null }) {
  if (!dashboard) return null;
  const {
    verifiedPasses = 0,
    researchPasses = 0,
    verifiedFailures = 0,
    failureBreakdown = {},
  } = dashboard;

  const diagnosticRows = [
    ["failedProbability", failureBreakdown.failedProbability ?? 0],
    ["failedConfidence", failureBreakdown.failedConfidence ?? 0],
    ["failedMatchup", failureBreakdown.failedMatchup ?? 0],
    ["failedDataQuality", failureBreakdown.failedDataQuality ?? 0],
  ];

  return (
    <div className="verification-dashboard" aria-label="Verification dashboard">
      <p className="prop-pipeline-counters">
        Verified Passes: {verifiedPasses} · Research Plays: {researchPasses} · Verified Failures:{" "}
        {verifiedFailures}
      </p>
      <p className="prop-pipeline-counters prop-pipeline-counters--meta">
        {diagnosticRows
          .map(([key, count]) => `${AUDIT_LABELS[key] || key}: ${count}`)
          .join(" · ")}
      </p>
    </div>
  );
}

export default memo(VerificationDashboard);
