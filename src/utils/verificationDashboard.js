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
  VERIFICATION_AUDIT_KEYS,
} from "./verifiedTierSystem.js";

export { VERIFICATION_AUDIT_KEYS };

function emptyBreakdown() {
  return {
    failedProjection: 0,
    failedProbability: 0,
    failedConfidence: 0,
    failedMatchup: 0,
  };
}

const AUDIT_LABELS = {
  failedProjection: "Failed Projection",
  failedProbability: "Failed Probability",
  failedConfidence: "Failed Confidence",
  failedMatchup: "Failed Matchup",
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

  const verifiedFailures = audit.totalFailures;
  const failureBreakdown = { ...emptyBreakdown(), ...audit.breakdown };

  return {
    verifiedPasses,
    researchPasses,
    verifiedFailures,
    failureBreakdown,
    auditLabels: AUDIT_LABELS,
    auditSamples: audit.samples,
    total: (props || []).length,
  };
}

export function logVerificationDashboardAudit(props = []) {
  const dashboard = buildVerificationDashboard(props);
  console.info("[MLB Pipeline] verification dashboard", {
    verifiedPasses: dashboard.verifiedPasses,
    researchPasses: dashboard.researchPasses,
    verifiedFailures: dashboard.verifiedFailures,
    failureBreakdown: dashboard.failureBreakdown,
  });
  return dashboard;
}
