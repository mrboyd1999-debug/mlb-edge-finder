/**
 * Integrity audit — weighted component scores for tier and overall-play validation.
 */

import { resolveVerifiedHitRateSnapshot } from "./verifiedHitRates.js";
import { resolveProbabilityTruth } from "./probabilityTruth.js";
import { hasPositiveBettingEdge, resolveBettingEdgeMessage } from "./bettingEdgeMessage.js";
import { STARTER_PENDING_LABEL } from "./opponentStarter.js";
import { isFullDataProp, resolvePropSanity } from "./boardQuality.js";
import { resolveProjectionValue } from "./projectionQuality.js";

export const INTEGRITY_WEIGHTS = {
  projection: 0.35,
  season: 0.25,
  opponent: 0.2,
  pitcher: 0.2,
};

export const INTEGRITY_COMPONENT_MIN_TIER_A = 50;
export const INTEGRITY_PERFECT_COMPONENT_MIN = 95;
export const PITCHER_ZERO_MAX_RANK = 3;
export const PITCHER_MATCHUP_NOT_VERIFIED_MESSAGE = "Pitcher matchup not verified.";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function parseHitRatePercent(value) {
  if (value == null || value === "" || value === "—") return null;
  const num = Number(String(value).replace("%", "").trim());
  if (!Number.isFinite(num)) return null;
  return num <= 1 ? num * 100 : num;
}

export function detectInvalidHitRates(prop = {}) {
  const snapshot = resolveVerifiedHitRateSnapshot(prop);
  const fields = [
    { key: "last5HitRate", label: "L5", raw: prop.last5HitRate, labelValue: snapshot.last5Label },
    { key: "last10HitRate", label: "L10", raw: prop.last10HitRate, labelValue: snapshot.last10Label },
    { key: "seasonHitRate", label: "Season", raw: prop.seasonHitRate, labelValue: snapshot.seasonLabel },
  ];
  const invalid = [];

  for (const field of fields) {
    const fromRaw = finite(field.raw);
    const fromLabel = parseHitRatePercent(field.labelValue);
    const value = fromRaw != null ? (fromRaw <= 1 ? fromRaw * 100 : fromRaw) : fromLabel;
    if (value != null && value > 100) {
      invalid.push({ ...field, value });
    }
  }

  return {
    invalid,
    hasInvalidHitRate: invalid.length > 0,
  };
}

export function resolvePitcherIntegrity(prop = {}) {
  const audit = prop.matchupAudit || {};
  const pitcher = String(audit.pitcher || prop.opposingPitcher || "").trim();
  const pitcherStatus = String(audit.pitcherStatus || prop.pitcherStatus || "").toUpperCase();
  const opponent = String(prop.opponent || audit.opponent || "").trim();

  if (pitcherStatus === "UNKNOWN" || audit.pitcherInvalid) return 0;
  if (!pitcher || pitcher === "—" || pitcher === STARTER_PENDING_LABEL) return 45;
  if (/ vs /i.test(pitcher)) return 0;
  if (!opponent || opponent === "—") return 50;
  if (audit.pitcherValidated) return 95;
  if (audit.complete) return 85;
  return 70;
}

export function resolveOpponentIntegrity(prop = {}) {
  const opponent = String(prop.opponent || prop.matchupAudit?.opponent || "").trim();
  if (!opponent || opponent === "—") return 0;
  const rank = finite(prop.opponentRank);
  const whip = finite(prop.opponentPitcherWhip ?? prop.opponentContext?.whip);
  let score = 80;
  if (rank != null) score += 5;
  if (whip != null && whip > 0) score += 10;
  if (prop.matchupAudit?.complete) score += 5;
  return Math.min(100, score);
}

export function resolveSeasonDataIntegrity(prop = {}) {
  const snapshot = resolveVerifiedHitRateSnapshot(prop);
  const seasonValid = Boolean(prop.seasonRateValid);
  const seasonLabel = snapshot.seasonLabel;
  if (seasonValid && seasonLabel !== "—" && seasonLabel !== "0%") return 100;
  if (snapshot.last10Label !== "—") return 55;
  if (snapshot.last5Label !== "—") return 40;
  return 0;
}

export function resolveProjectionIntegrity(prop = {}) {
  const projection = finite(resolveProjectionValue(prop));
  const line = finite(prop.line);
  const sanity = prop.projectionSanityAudit;
  const checks = [
    projection != null && projection > 0,
    line != null && line > 0,
    isFullDataProp(prop),
    !sanity?.sanityFail,
    !prop.projectionClamped || prop.projectionValidation?.outlierSupported,
  ];
  let score = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  const hitRateCheck = detectInvalidHitRates(prop);
  const truth = prop.probabilityTruth || resolveProbabilityTruth(prop);
  if (hitRateCheck.hasInvalidHitRate) score = Math.min(score, 40);
  if (truth.probabilityMismatch) score = Math.min(score, 60);

  return Math.max(0, Math.min(100, score));
}

export function computeWeightedIntegrityScore(components = {}) {
  const projectionIntegrity = finite(components.projectionIntegrity) ?? 0;
  const seasonDataIntegrity = finite(components.seasonDataIntegrity) ?? 0;
  const opponentIntegrity = finite(components.opponentIntegrity) ?? 0;
  const pitcherIntegrity = finite(components.pitcherIntegrity) ?? 0;

  const weighted = round1(
    projectionIntegrity * INTEGRITY_WEIGHTS.projection +
      seasonDataIntegrity * INTEGRITY_WEIGHTS.season +
      opponentIntegrity * INTEGRITY_WEIGHTS.opponent +
      pitcherIntegrity * INTEGRITY_WEIGHTS.pitcher
  );

  const allPerfect = [projectionIntegrity, seasonDataIntegrity, opponentIntegrity, pitcherIntegrity].every(
    (score) => score >= INTEGRITY_PERFECT_COMPONENT_MIN
  );

  if (allPerfect) return 100;
  return Math.max(0, Math.min(99, Math.round(weighted)));
}

export function hasLowIntegrityComponent(components = {}) {
  return [
    components.projectionIntegrity,
    components.seasonDataIntegrity,
    components.opponentIntegrity,
    components.pitcherIntegrity,
  ].some((score) => finite(score) != null && score < INTEGRITY_COMPONENT_MIN_TIER_A);
}

export function buildIntegrityAudit(prop = {}) {
  const hitRateCheck = detectInvalidHitRates(prop);
  const truth = prop.probabilityTruth || resolveProbabilityTruth(prop);
  const edge = finite(prop.edge ?? prop.rawEdge);
  const probability = finite(truth.calibratedProbability ?? truth.probabilityScore);
  const positiveEdge = hasPositiveBettingEdge(prop);
  const edgeMessage = resolveBettingEdgeMessage(prop);

  const edgeMismatch =
    edge != null && edge > 0 && probability != null && probability >= 60 && !positiveEdge;

  const projectionIntegrity = resolveProjectionIntegrity(prop);
  const seasonDataIntegrity = resolveSeasonDataIntegrity(prop);
  const opponentIntegrity = resolveOpponentIntegrity(prop);
  const pitcherIntegrity = resolvePitcherIntegrity(prop);

  const integrityComponents = {
    projectionIntegrity,
    seasonDataIntegrity,
    opponentIntegrity,
    pitcherIntegrity,
  };

  const integrityScore = computeWeightedIntegrityScore(integrityComponents);
  const lowIntegrityComponent = hasLowIntegrityComponent(integrityComponents);
  const pitcherMatchupUnverified = pitcherIntegrity === 0;

  const penalties = [];
  if (hitRateCheck.hasInvalidHitRate) {
    penalties.push({ type: "hitRateInvalid", amount: "projectionIntegrity capped" });
  }
  if (truth.probabilityMismatch) {
    penalties.push({ type: "probabilityMismatch", amount: "projectionIntegrity capped" });
  }
  if (edgeMismatch) {
    penalties.push({ type: "edgeMismatch", amount: "review flag" });
  }

  const dataIntegrityWarning =
    hitRateCheck.hasInvalidHitRate ||
    truth.probabilityMismatch ||
    edgeMismatch ||
    lowIntegrityComponent ||
    integrityScore < 90;

  const tierAEligible =
    integrityScore >= 90 &&
    !lowIntegrityComponent &&
    !hitRateCheck.hasInvalidHitRate &&
    !truth.probabilityMismatch &&
    seasonDataIntegrity >= 80 &&
    pitcherIntegrity >= 80 &&
    (resolvePropSanity(prop) ?? 0) >= 90;

  return {
    integrityScore,
    integrityComponents,
    projectionIntegrity,
    seasonDataIntegrity,
    opponentIntegrity,
    pitcherIntegrity,
    integrityWeights: INTEGRITY_WEIGHTS,
    weightedBreakdown: {
      projection: round1(projectionIntegrity * INTEGRITY_WEIGHTS.projection),
      season: round1(seasonDataIntegrity * INTEGRITY_WEIGHTS.season),
      opponent: round1(opponentIntegrity * INTEGRITY_WEIGHTS.opponent),
      pitcher: round1(pitcherIntegrity * INTEGRITY_WEIGHTS.pitcher),
    },
    penalties,
    hitRateInvalid: hitRateCheck.hasInvalidHitRate,
    probabilityMismatch: truth.probabilityMismatch,
    edgeMismatch,
    dataIntegrityWarning,
    lowIntegrityComponent,
    maxTierB: lowIntegrityComponent,
    pitcherMatchupUnverified,
    tierAEligible,
    reviewNeeded:
      !tierAEligible &&
      (dataIntegrityWarning || integrityScore < 90 || lowIntegrityComponent || pitcherMatchupUnverified),
    positiveBettingEdge: positiveEdge,
    bettingEdgeMessage: edgeMessage,
  };
}

export function attachIntegrityAuditFields(prop = {}) {
  const integrityAudit = buildIntegrityAudit(prop);
  return {
    ...prop,
    integrityAudit,
    integrityScore: integrityAudit.integrityScore,
    integrityComponents: integrityAudit.integrityComponents,
    projectionIntegrity: integrityAudit.projectionIntegrity,
    seasonDataIntegrity: integrityAudit.seasonDataIntegrity,
    opponentIntegrity: integrityAudit.opponentIntegrity,
    pitcherIntegrity: integrityAudit.pitcherIntegrity,
    dataIntegrityWarning: integrityAudit.dataIntegrityWarning,
    reviewNeeded: integrityAudit.reviewNeeded,
    maxTierB: integrityAudit.maxTierB,
    pitcherMatchupUnverified: integrityAudit.pitcherMatchupUnverified,
  };
}

export function canSelectOverallPlayAtRank(prop = {}, rank = 1) {
  const integrity = prop.integrityAudit || buildIntegrityAudit(prop);
  if (integrity.pitcherIntegrity === 0 && rank < PITCHER_ZERO_MAX_RANK) return false;
  return true;
}
