/**
 * Verified-play pass/fail audit with categorized failure breakdown.
 */

import {
  passesVerifiedBestPlaysFilter,
  resolveBestPlayInvalidReason,
  resolveBestPlayPlayerName,
  resolveBestPlayStatSpecificProjection,
  passesResearchBestPlaysFilter,
  VERIFIED_MIN_CONFIDENCE,
  VERIFIED_MIN_EDGE,
  VERIFIED_MIN_PROBABILITY,
} from "./bestPlaysPipelineDebug.js";
import { hasMissingMatchupData, isLowMatchupProp } from "./conservativeProjection.js";
import { resolveEdgeMagnitude } from "./bestPlayRanking.js";

export const VERIFICATION_FAILURE_KEYS = [
  "missingTeam",
  "missingProjection",
  "missingMatchup",
  "lowEdge",
  "lowConfidence",
  "other",
];

function emptyBreakdown() {
  return {
    missingTeam: 0,
    missingProjection: 0,
    missingMatchup: 0,
    lowEdge: 0,
    lowConfidence: 0,
    other: 0,
  };
}

function resolveEdgePercent(prop = {}) {
  const edge = resolveEdgeMagnitude(prop);
  const line = Number(prop.line);
  if (!Number.isFinite(edge) || !Number.isFinite(line) || line <= 0) return 0;
  return Math.abs(edge) / line;
}

export function categorizeVerifiedFailure(prop = {}) {
  if (!resolveBestPlayPlayerName(prop)) return "other";

  const projection = resolveBestPlayStatSpecificProjection(prop);
  if (projection == null || projection <= 0) return "missingProjection";

  if (!String(prop.team || "").trim() && prop.teamConfidence !== "LOW") return "missingTeam";

  if (passesResearchBestPlaysFilter(prop)) return "lowConfidence";
  if (isLowMatchupProp(prop) || hasMissingMatchupData(prop)) return "missingMatchup";

  const confidence = Number(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence);
  if (!Number.isFinite(confidence) || confidence < VERIFIED_MIN_CONFIDENCE) return "lowConfidence";

  const probability = Number(prop.probabilityScore ?? prop.verifiedProbability);
  if (!Number.isFinite(probability) || probability < VERIFIED_MIN_PROBABILITY) return "lowConfidence";

  if (resolveEdgePercent(prop) < VERIFIED_MIN_EDGE) return "lowEdge";

  const invalid = resolveBestPlayInvalidReason(prop);
  if (/team/.test(invalid)) return "missingTeam";
  if (/projection/.test(invalid)) return "missingProjection";
  if (/matchup|research/.test(invalid)) return "missingMatchup";
  if (/edge/.test(invalid)) return "lowEdge";
  if (/confidence|probability/.test(invalid)) return "lowConfidence";

  return "other";
}

export function buildVerificationDashboard(props = []) {
  const breakdown = emptyBreakdown();
  let verifiedPasses = 0;
  let researchPasses = 0;
  let verifiedFailures = 0;

  for (const prop of props || []) {
    if (passesVerifiedBestPlaysFilter(prop)) {
      verifiedPasses += 1;
      continue;
    }
    if (passesResearchBestPlaysFilter(prop)) {
      researchPasses += 1;
      continue;
    }
    verifiedFailures += 1;
    const bucket = categorizeVerifiedFailure(prop);
    breakdown[bucket] = (breakdown[bucket] || 0) + 1;
  }

  return {
    verifiedPasses,
    researchPasses,
    verifiedFailures,
    failureBreakdown: breakdown,
    total: (props || []).length,
  };
}
