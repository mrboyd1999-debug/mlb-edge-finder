/**
 * Verified-play pass/fail audit with categorized failure breakdown.
 */

import {
  passesVerifiedBestPlaysFilter,
  passesResearchBestPlaysFilter,
} from "./bestPlaysPipelineDebug.js";
import {
  auditVerificationFailure,
  summarizeVerificationAudit,
  logTopPickScoreAudit,
  logVerificationRegressionAudit,
  VERIFICATION_AUDIT_KEYS,
} from "./verifiedTierSystem.js";

export { VERIFICATION_AUDIT_KEYS };

function emptyBreakdown() {
  return {
    failedProjection: 0,
    failedProbability: 0,
    failedConfidence: 0,
    failedMatchup: 0,
    failedDataQuality: 0,
  };
}

export const AUDIT_LABELS = {
  failedProjection: "Failed Projection",
  failedProbability: "Failed Probability",
  failedConfidence: "Failed Confidence",
  failedMatchup: "Failed Matchup",
  failedDataQuality: "Failed Data Quality",
};

export function categorizeVerifiedFailure(prop = {}) {
  return auditVerificationFailure(prop) || "failedProbability";
}

export function buildVerificationDashboard(props = []) {
  const audit = summarizeVerificationAudit(props);
  let verifiedPasses = 0;
  let researchPasses = 0;

  for (const prop of props || []) {
    if (passesVerifiedBestPlaysFilter(prop)) {
      verifiedPasses += 1;
      continue;
    }
    if (passesResearchBestPlaysFilter(prop)) {
      researchPasses += 1;
    }
  }

  const failureBreakdown = { ...emptyBreakdown(), ...audit.breakdown };

  return {
    verifiedPasses,
    researchPasses,
    verifiedFailures: audit.totalFailures,
    failureBreakdown,
    auditLabels: AUDIT_LABELS,
    auditSamples: audit.samples,
    regressionReasons: audit.regressionReasons,
    total: (props || []).length,
  };
}

export function logVerificationDashboardAudit(props = []) {
  const dashboard = buildVerificationDashboard(props);
  const scoreAudit = logTopPickScoreAudit(props);
  const regression = logVerificationRegressionAudit(props);

  console.info("[MLB Pipeline] verification dashboard", {
    verifiedPasses: dashboard.verifiedPasses,
    researchPasses: dashboard.researchPasses,
    verifiedFailures: dashboard.verifiedFailures,
    failureBreakdown: dashboard.failureBreakdown,
    regressionReasons: dashboard.regressionReasons,
  });

  return { ...dashboard, scoreAudit, regression };
}
