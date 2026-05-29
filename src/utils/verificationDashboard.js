/**
 * Verified-play pass/fail audit with categorized failure breakdown.
 */

import {
  passesMinimalBestPlaysFilter,
  resolveBestPlayStatSpecificProjection,
  passesVerifiedBestPlaysFilter,
  passesResearchBestPlaysFilter,
} from "./bestPlaysPipelineDebug.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import {
  auditVerificationFailure,
  summarizeVerificationAudit,
  logTopPickScoreAudit,
  logVerificationRegressionAudit,
  resolveVerifiedMetrics,
  VERIFIED_BASE_MIN_PROBABILITY,
  VERIFIED_BASE_MIN_CONFIDENCE,
  VERIFIED_MIN_DATA_QUALITY,
  hasIncompleteSupportingData,
  classifyVerifiedTier,
  VERIFICATION_AUDIT_KEYS,
} from "./verifiedTierSystem.js";
import {
  annotateTopPickRankingFields,
  compareTopPickScore,
  computeTopPickScore,
} from "./bestPlayRankingScore.js";

export { VERIFICATION_AUDIT_KEYS };

export const DIAGNOSTIC_TOP_N = 10;

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

export function resolveProjectedPool(props = []) {
  return (props || []).filter((prop) => {
    const proj = resolveBestPlayStatSpecificProjection(prop);
    return (
      proj != null &&
      proj > 0 &&
      passesMinimalBestPlaysFilter(prop) &&
      resolvePropSport(prop) === "MLB"
    );
  });
}

export function toVerificationDiagnosticRow(prop = {}) {
  const annotated = annotateTopPickRankingFields(prop);
  return {
    player: String(annotated.playerName || annotated.player || "Unknown").trim(),
    probability: Math.round(Number(annotated.probabilityScore ?? annotated.verifiedProbability ?? 0)),
    confidence: Math.round(
      Number(annotated.displayConfidenceScore ?? annotated.confidenceScore ?? annotated.confidence ?? 0)
    ),
    playability: Math.round(Number(annotated.playabilityScore ?? 0)),
    score: Number(annotated.topPickScore ?? computeTopPickScore(annotated)).toFixed(1),
  };
}

function computeGateMetrics(projectedPool = []) {
  let passedProbability = 0;
  let failedProbability = 0;
  let passedConfidence = 0;
  let failedConfidence = 0;
  let passedDataQuality = 0;
  let failedDataQuality = 0;
  let passedMatchup = 0;
  let failedMatchup = 0;

  for (const prop of projectedPool) {
    const { probability, confidence, dataQuality } = resolveVerifiedMetrics(prop);
    const probPass =
      Number.isFinite(probability) && probability >= VERIFIED_BASE_MIN_PROBABILITY;
    if (probPass) passedProbability += 1;
    else failedProbability += 1;

    const confPass =
      probPass && Number.isFinite(confidence) && confidence >= VERIFIED_BASE_MIN_CONFIDENCE;
    if (probPass) {
      if (confPass) passedConfidence += 1;
      else failedConfidence += 1;
    }

    if (confPass) {
      const dqFail = Number.isFinite(dataQuality) && dataQuality < VERIFIED_MIN_DATA_QUALITY;
      if (dqFail) failedDataQuality += 1;
      else passedDataQuality += 1;
    }

    if (hasIncompleteSupportingData(prop)) failedMatchup += 1;
    else passedMatchup += 1;
  }

  return {
    passedProbability,
    failedProbability,
    passedConfidence,
    failedConfidence,
    passedDataQuality,
    failedDataQuality,
    passedMatchup,
    failedMatchup,
  };
}

function countTierBreakdown(picks = []) {
  const counts = { tierA: 0, tierB: 0, tierC: 0 };
  for (const prop of picks) {
    const tier = prop.verifiedTier || classifyVerifiedTier(prop);
    if (tier === "A") counts.tierA += 1;
    else if (tier === "B") counts.tierB += 1;
    else if (tier === "C") counts.tierC += 1;
  }
  return counts;
}

function buildTopDiagnosticRows(pool = [], limit = DIAGNOSTIC_TOP_N) {
  return [...pool]
    .map((prop) => ({ prop, row: toVerificationDiagnosticRow(prop) }))
    .sort((a, b) => compareTopPickScore(a.prop, b.prop))
    .slice(0, limit)
    .map(({ row }) => row);
}

export function categorizeVerifiedFailure(prop = {}) {
  return auditVerificationFailure(prop) || "failedProbability";
}

export function buildVerificationDashboard(props = [], options = {}) {
  const audit = summarizeVerificationAudit(props);
  const projectedPool = options.displayPool?.length
    ? options.displayPool
    : resolveProjectedPool(props);
  const verifiedPicks = options.verifiedPicks || [];
  const gateMetrics = computeGateMetrics(projectedPool);
  const tierCounts = countTierBreakdown(verifiedPicks);
  const verifiedCount = verifiedPicks.length;

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
    projected: projectedPool.length,
    verifiedCount,
    verifiedPasses,
    researchPasses,
    verifiedFailures: audit.totalFailures,
    ...gateMetrics,
    tierA: tierCounts.tierA,
    tierB: tierCounts.tierB,
    tierC: tierCounts.tierC,
    topBeforeVerification: buildTopDiagnosticRows(projectedPool),
    topAfterVerification: buildTopDiagnosticRows(verifiedPicks),
    failureBreakdown,
    rejectionCounts: verifiedCount === 0 ? failureBreakdown : null,
    regressionReasons: audit.regressionReasons,
    auditLabels: AUDIT_LABELS,
    auditSamples: audit.samples,
    total: (props || []).length,
  };
}

export function logVerificationDashboardAudit(props = [], options = {}) {
  const dashboard = buildVerificationDashboard(props, options);
  const scoreAudit = logTopPickScoreAudit(props);
  const regression = logVerificationRegressionAudit(props);

  console.info("[MLB Pipeline] verification dashboard", {
    projected: dashboard.projected,
    verifiedCount: dashboard.verifiedCount,
    gateMetrics: {
      passedProbability: dashboard.passedProbability,
      failedProbability: dashboard.failedProbability,
      passedConfidence: dashboard.passedConfidence,
      failedConfidence: dashboard.failedConfidence,
      passedDataQuality: dashboard.passedDataQuality,
      failedDataQuality: dashboard.failedDataQuality,
      passedMatchup: dashboard.passedMatchup,
      failedMatchup: dashboard.failedMatchup,
    },
    tierCounts: {
      tierA: dashboard.tierA,
      tierB: dashboard.tierB,
      tierC: dashboard.tierC,
    },
    failureBreakdown: dashboard.failureBreakdown,
    regressionReasons: dashboard.regressionReasons,
  });

  return { ...dashboard, scoreAudit, regression };
}
