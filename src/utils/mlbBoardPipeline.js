/**
 * MLB board pipeline — data status, research gating, probability caps, prop normalization.
 */

import { STARTER_PENDING_LABEL, PITCHER_VERIFICATION, resolvePitcherVerification } from "./opponentStarter.js";
import { resolveVerificationStatus, VERIFICATION_STATUS, allowFallbackVerification } from "./verificationStatus.js";
import { passesStrongMetricBestPlayGate } from "./verificationBreakdown.js";
import { hasPositiveEdge } from "./tierClassification.js";

export const DATA_STATUS = {
  FULL_MLB_DATA: "FULL_MLB_DATA",
  PARTIAL_DATA: "PARTIAL_DATA",
  RESEARCH_ONLY: "RESEARCH_ONLY",
  REVIEW_NEEDED: "REVIEW_NEEDED",
};

export const BEST_PLAYS_MIN = {
  confidence: 65,
  probability: 60,
  playability: 0,
};

export const TIER_A_RULES = {
  confidence: 70,
  probability: 70,
  playability: 0,
};

export const TIER_B_RULES = {
  confidence: 65,
  probability: 65,
  playability: 0,
};

export const NO_VERIFIED_PLAYS_MESSAGE = "No verified MLB plays meet today's safety threshold.";
export const NO_BEST_PLAYS_STANDARDS_MESSAGE =
  "No verified MLB plays currently meet Best Play standards.";
export const NO_MLB_PROPS_LOADED_MESSAGE = "No MLB props loaded yet.";
export const NO_TIER_AB_RESEARCH_MESSAGE =
  "No Tier A/B verified plays today — showing research candidates.";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolvePropConfidence(prop = {}) {
  return finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence);
}

function resolvePropPlayability(prop = {}) {
  return finite(prop.playabilityScore ?? prop.playabilityBreakdown?.finalPlayability);
}

function resolvePropProbability(prop = {}) {
  return finite(prop.probabilityScore ?? prop.verifiedProbability);
}

function hitRatePresent(value) {
  if (value == null || value === "" || value === "—") return false;
  const num = finite(value);
  if (num == null) return false;
  return num > 0 || num === 0;
}

export function resolveSampleGames(prop = {}) {
  return (
    finite(prop.sampleGames ?? prop.games ?? prop.gameLogCount ?? prop.last10Games ?? prop.hitRateSnapshot?.last10Games) ??
    null
  );
}

function hasRecentForm(prop = {}) {
  const last10 = prop.last10HitRate ?? prop.hitRateSnapshot?.last10 ?? prop.recentHitRate;
  const recentAvg = prop.recentForm ?? prop.last10Avg ?? prop.hitRateSnapshot?.last10Avg;
  return hitRatePresent(last10) || finite(recentAvg) != null;
}

function hasSeasonRate(prop = {}) {
  const seasonSource = String(prop.seasonRateSource ?? prop.hitRateSnapshot?.seasonSource ?? "").toLowerCase();
  if (seasonSource === "unavailable" || seasonSource === "missing") return false;
  const season = prop.seasonHitRate ?? prop.seasonAvg ?? prop.hitRateSnapshot?.seasonLabel ?? prop.hitRateSnapshot?.season;
  return hitRatePresent(season);
}

function hasTeamContext(prop = {}) {
  const team = String(prop.team || prop.playerTeam || prop.teamAbbr || "").trim();
  const opponent = String(prop.opponent || prop.opponentTeam || prop.matchupTeam || prop.matchup || "").trim();
  return Boolean(team && opponent && team !== "—" && opponent !== "—");
}

export function hasFullMlbDataFields(prop = {}) {
  const line = finite(prop.line);
  const projection = finite(prop.projection ?? prop.projectedValue);
  const last5 = prop.last5HitRate ?? prop.hitRateSnapshot?.last5 ?? prop.recentHitRate;
  const last10 = prop.last10HitRate ?? prop.hitRateSnapshot?.last10 ?? prop.recentHitRate;
  const sampleGames = resolveSampleGames(prop);
  const pitcherStatus = resolvePitcherStatus(prop);

  return (
    line != null &&
    line > 0 &&
    projection != null &&
    projection > 0 &&
    hitRatePresent(last5) &&
    hitRatePresent(last10) &&
    hasRecentForm(prop) &&
    hasSeasonRate(prop) &&
    sampleGames != null &&
    sampleGames >= 10 &&
    hasTeamContext(prop) &&
    (pitcherStatus === "verified" || pitcherStatus === "partial" || pitcherStatus === "pending")
  );
}

export function resolvePitcherStatus(prop = {}) {
  const verification =
    prop.pitcherVerification ||
    prop.pitcherVerificationLevel ||
    resolvePitcherVerification(prop).pitcherVerification;
  if (verification === PITCHER_VERIFICATION.VERIFIED) return "verified";
  if (verification === PITCHER_VERIFICATION.PARTIAL) return "partial";
  const audit = prop.pitcherMatchupAudit?.pitcherLookup || prop.integrityAudit || {};
  if (audit.pitcherValidated === true || audit.pitcherStatus === "VERIFIED") return "verified";
  const pitcher = String(prop.opposingPitcher || prop.matchupAudit?.pitcher || prop.opponentStarterNote || "").trim();
  if (!pitcher || pitcher === "—" || /pitcher pending|starter pending/i.test(pitcher) || pitcher === STARTER_PENDING_LABEL) {
    return "pending";
  }
  if (audit.pitcherInvalid || audit.pitcherStatus === "UNKNOWN") return "pending";
  return "verified";
}

export function isResearchCandidate(prop = {}) {
  if (prop.isResearchCandidate === true) return true;
  if (prop.isResearchCandidate === false) return false;
  if (passesStrongMetricBestPlayGate(prop)) return false;

  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const playability = resolvePropPlayability(prop);
  const dataStatus = resolveMlbDataStatus(prop);
  const pitcherVerification =
    prop.pitcherVerification || resolvePitcherVerification(prop).pitcherVerification;
  const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
  const partialEligible =
    allowFallbackVerification && verificationStatus === VERIFICATION_STATUS.PARTIAL;

  if (verificationStatus === VERIFICATION_STATUS.FULL) return false;

  if (pitcherVerification === PITCHER_VERIFICATION.FAIL) {
    if (finite(confidence) != null && confidence < 70 && finite(probability) != null && probability < 60) {
      return true;
    }
  }
  if (dataStatus === DATA_STATUS.RESEARCH_ONLY) return true;
  if (
    !partialEligible &&
    verificationStatus !== VERIFICATION_STATUS.RESEARCH &&
    dataStatus !== DATA_STATUS.FULL_MLB_DATA &&
    dataStatus !== DATA_STATUS.REVIEW_NEEDED
  ) {
    return true;
  }
  if (verificationStatus === VERIFICATION_STATUS.RESEARCH) {
    return finite(confidence) == null || confidence < 65 || finite(probability) == null || probability < 55;
  }
  if (prop.reviewNeeded || prop.integrityAudit?.hitRateInvalid || prop.integrityAudit?.probabilityMismatch) {
    return true;
  }
  if (finite(confidence) != null && confidence < 50 && finite(probability) != null && probability < 50) {
    return true;
  }
  if (prop.projectionSanityAudit?.sanityFail || prop.projectionOutlierDetected || prop.projectionRisk === "AGGRESSIVE") {
    return true;
  }
  return false;
}

export function resolveMlbDataStatus(prop = {}) {
  if (
    prop.dataStatus === DATA_STATUS.FULL_MLB_DATA ||
    prop.dataStatus === DATA_STATUS.RESEARCH_ONLY ||
    prop.dataStatus === DATA_STATUS.REVIEW_NEEDED
  ) {
    return prop.dataStatus;
  }
  const verificationStatus = prop.verificationStatus;
  if (verificationStatus === VERIFICATION_STATUS.FULL) return DATA_STATUS.FULL_MLB_DATA;
  if (hasFullMlbDataFields(prop)) return DATA_STATUS.FULL_MLB_DATA;
  if (!finite(prop.line) || !finite(prop.projection ?? prop.projectedValue)) return DATA_STATUS.RESEARCH_ONLY;
  if (
    prop.reviewNeeded ||
    prop.projectionOutlierDetected ||
    prop.projectionRisk === "AGGRESSIVE" ||
    !hasSeasonRate(prop)
  ) {
    return DATA_STATUS.REVIEW_NEEDED;
  }
  return DATA_STATUS.PARTIAL_DATA;
}

export function passesBestPlayBoardGate(prop = {}) {
  if (passesStrongMetricBestPlayGate(prop) && hasPositiveEdge(prop)) return true;
  if (isResearchCandidate(prop)) return false;

  const verificationStatus = prop.verificationStatus || resolveVerificationStatus(prop);
  if (
    verificationStatus !== VERIFICATION_STATUS.FULL &&
    verificationStatus !== VERIFICATION_STATUS.PARTIAL &&
    verificationStatus !== VERIFICATION_STATUS.RESEARCH
  ) {
    return false;
  }

  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  if (finite(confidence) < BEST_PLAYS_MIN.confidence || finite(probability) < BEST_PLAYS_MIN.probability) {
    return false;
  }

  const line = finite(prop.line);
  const projection = finite(prop.projection ?? prop.projectedValue);
  if (line == null || projection == null) return false;

  const edge = finite(prop.edge);
  if (Number.isFinite(edge)) return edge !== 0;

  return projection !== line;
}

export function passesVerifiedSectionGate(prop = {}) {
  return passesBestPlayBoardGate(prop);
}

export function applyBoardProbabilityCaps(prop = {}, probability = null) {
  let value = finite(probability ?? prop.probabilityScore ?? prop.verifiedProbability);
  if (value == null) return null;

  const sampleGames = resolveSampleGames(prop);
  const flags = prop.projectionSanityAudit || {};
  const aggressive = prop.projectionRisk === "AGGRESSIVE" || flags.projectionRisk === "AGGRESSIVE";
  const outlier = Boolean(prop.projectionOutlierDetected || flags.outlierDetected || flags.outlierWarning);

  if (sampleGames != null && sampleGames < 10) value = Math.min(value, 69);

  if (aggressive || outlier) value = Math.min(value, 74);

  return Math.round(Math.max(50, value));
}

export function resolveCardPlayLabel(prop = {}) {
  if (isResearchCandidate(prop)) return "Research Candidate";
  if (prop.reviewNeeded || prop.projectionOutlierDetected || prop.projectionRisk === "AGGRESSIVE") {
    return "Review Needed";
  }
  const tier = String(prop.tier || prop.finalTier || "").toUpperCase();
  if (tier === "A" || tier === "B") return "Verified Play";
  return "Review Needed";
}

export function normalizeBoardProp(prop = {}) {
  const dataStatus = resolveMlbDataStatus(prop);
  const research = isResearchCandidate({ ...prop, dataStatus });
  const probability = applyBoardProbabilityCaps(prop, prop.probabilityScore ?? prop.verifiedProbability);
  const pitcherStatus = resolvePitcherStatus(prop);
  return {
    ...prop,
    dataStatus,
    isResearchCandidate: research,
    isFullData: dataStatus === DATA_STATUS.FULL_MLB_DATA,
    partialData: dataStatus !== DATA_STATUS.FULL_MLB_DATA,
    probabilityScore: probability ?? prop.probabilityScore,
    verifiedProbability: probability ?? prop.verifiedProbability,
    pitcherStatus,
    cardPlayLabel: resolveCardPlayLabel({ ...prop, dataStatus, isResearchCandidate: research }),
    sampleGames: resolveSampleGames(prop),
  };
}
