/**
 * MLB board pipeline — data status, research gating, probability caps, prop normalization.
 */

import { STARTER_PENDING_LABEL } from "./opponentStarter.js";

export const DATA_STATUS = {
  FULL_MLB_DATA: "FULL_MLB_DATA",
  PARTIAL_DATA: "PARTIAL_DATA",
  RESEARCH_ONLY: "RESEARCH_ONLY",
};

export const BEST_PLAYS_MIN = {
  confidence: 65,
  probability: 65,
  playability: 70,
};

export const TIER_A_RULES = {
  confidence: 75,
  probability: 70,
  playability: 75,
};

export const TIER_B_RULES = {
  confidence: 65,
  probability: 65,
  playability: 70,
};

export const NO_VERIFIED_PLAYS_MESSAGE = "No verified plays yet";

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

export function hasFullMlbDataFields(prop = {}) {
  const line = finite(prop.line);
  const projection = finite(prop.projection ?? prop.projectedValue);
  const last5 = prop.last5HitRate ?? prop.hitRateSnapshot?.last5 ?? prop.recentHitRate;
  const last10 = prop.last10HitRate ?? prop.hitRateSnapshot?.last10 ?? prop.recentHitRate;
  const season = prop.seasonHitRate ?? prop.hitRateSnapshot?.seasonLabel;
  const sampleGames = resolveSampleGames(prop);
  return (
    line != null &&
    line > 0 &&
    projection != null &&
    projection > 0 &&
    hitRatePresent(last5) &&
    hitRatePresent(last10) &&
    hitRatePresent(season) &&
    sampleGames != null &&
    sampleGames >= 10
  );
}

export function resolvePitcherStatus(prop = {}) {
  const audit = prop.pitcherMatchupAudit?.pitcherLookup || prop.integrityAudit || {};
  if (audit.pitcherValidated === true || audit.pitcherStatus === "VERIFIED") return "verified";
  const pitcher = String(prop.opposingPitcher || prop.matchupAudit?.pitcher || prop.opponentStarterNote || "").trim();
  if (!pitcher || pitcher === "—" || /pitcher pending|starter pending/i.test(pitcher)) {
    return "pending";
  }
  if (audit.pitcherInvalid || audit.pitcherStatus === "UNKNOWN") return "pending";
  return "verified";
}

export function isResearchCandidate(prop = {}) {
  if (prop.isResearchCandidate === true) return true;
  if (prop.isResearchCandidate === false) return false;

  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const playability = resolvePropPlayability(prop);
  const dataStatus = resolveMlbDataStatus(prop);
  const pitcherStatus = resolvePitcherStatus(prop);

  if (dataStatus === DATA_STATUS.RESEARCH_ONLY) return true;
  if (dataStatus !== DATA_STATUS.FULL_MLB_DATA) return true;
  if (pitcherStatus !== "verified") return true;
  if (prop.reviewNeeded || prop.integrityAudit?.hitRateInvalid || prop.integrityAudit?.probabilityMismatch) return true;
  if (finite(confidence) != null && confidence < BEST_PLAYS_MIN.confidence) return true;
  if (finite(probability) != null && probability < BEST_PLAYS_MIN.probability) return true;
  if (finite(playability) != null && playability < BEST_PLAYS_MIN.playability) return true;
  if (prop.projectionSanityAudit?.sanityFail || prop.projectionOutlierDetected || prop.projectionRisk === "AGGRESSIVE") {
    return true;
  }
  return false;
}

export function resolveMlbDataStatus(prop = {}) {
  if (prop.dataStatus === DATA_STATUS.FULL_MLB_DATA || prop.dataStatus === DATA_STATUS.RESEARCH_ONLY) {
    return prop.dataStatus;
  }
  if (hasFullMlbDataFields(prop)) return DATA_STATUS.FULL_MLB_DATA;
  if (!finite(prop.line) || !finite(prop.projection ?? prop.projectedValue)) return DATA_STATUS.RESEARCH_ONLY;
  return DATA_STATUS.PARTIAL_DATA;
}

export function passesBestPlayBoardGate(prop = {}) {
  if (isResearchCandidate(prop)) return false;
  if (resolveMlbDataStatus(prop) !== DATA_STATUS.FULL_MLB_DATA) return false;
  const tier = String(prop.finalTier || "").toUpperCase();
  if (tier !== "A" && tier !== "B") return false;
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const playability = resolvePropPlayability(prop);
  return (
    finite(confidence) >= BEST_PLAYS_MIN.confidence &&
    finite(probability) >= BEST_PLAYS_MIN.probability &&
    finite(playability) >= BEST_PLAYS_MIN.playability
  );
}

export function passesVerifiedSectionGate(prop = {}) {
  return passesBestPlayBoardGate(prop);
}

export function applyBoardProbabilityCaps(prop = {}, probability = null) {
  let value = finite(probability ?? prop.probabilityScore ?? prop.verifiedProbability);
  if (value == null) return null;

  const hitRates = prop.probabilityCalibration?.hitRates || {};
  const seasonMissing = !hitRates.seasonRateValid && prop.seasonHitRate == null;
  const sampleGames = resolveSampleGames(prop);
  const pitcherStatus = resolvePitcherStatus(prop);
  const flags = prop.projectionSanityAudit || {};
  const aggressive = prop.projectionRisk === "AGGRESSIVE" || flags.projectionRisk === "AGGRESSIVE";
  const outlier = Boolean(prop.projectionOutlierDetected || flags.outlierDetected || flags.outlierWarning);

  if (seasonMissing) value = Math.min(value, 60);
  if (sampleGames != null && sampleGames < 10) value = Math.min(value, 60);
  if (pitcherStatus !== "verified") value = Math.min(value, 64);
  if (aggressive || outlier) value = Math.min(value, 70);

  return Math.round(Math.max(50, value));
}

export function resolveCardPlayLabel(prop = {}) {
  if (isResearchCandidate(prop)) return "Research Candidate";
  if (prop.reviewNeeded || prop.projectionOutlierDetected || prop.projectionRisk === "AGGRESSIVE") {
    return "Review Needed";
  }
  const tier = String(prop.finalTier || "").toUpperCase();
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
