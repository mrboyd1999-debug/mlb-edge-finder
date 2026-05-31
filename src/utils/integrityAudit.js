/**
 * Integrity audit — numeric score and component checks for tier validation.
 */

import { resolveVerifiedHitRateSnapshot } from "./verifiedHitRates.js";
import { resolveProbabilityTruth } from "./probabilityTruth.js";
import { hasPositiveBettingEdge, resolveBettingEdgeMessage } from "./bettingEdgeMessage.js";
import { STARTER_PENDING_LABEL } from "./opponentStarter.js";
import { resolvePropSanity } from "./boardQuality.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

export function buildIntegrityAudit(prop = {}) {
  const hitRateCheck = detectInvalidHitRates(prop);
  const truth = prop.probabilityTruth || resolveProbabilityTruth(prop);
  const edge = finite(prop.edge ?? prop.rawEdge);
  const probability = finite(truth.calibratedProbability ?? truth.probabilityScore);
  const positiveEdge = hasPositiveBettingEdge(prop);
  const edgeMessage = resolveBettingEdgeMessage(prop);

  const edgeMismatch =
    edge != null &&
    edge > 0 &&
    probability != null &&
    probability >= 60 &&
    !positiveEdge;

  let integrityScore = 100;
  const penalties = [];

  if (hitRateCheck.hasInvalidHitRate) {
    integrityScore -= 50;
    penalties.push({ type: "hitRateInvalid", amount: 50, detail: hitRateCheck.invalid });
  }
  if (truth.probabilityMismatch) {
    integrityScore -= 25;
    penalties.push({ type: "probabilityMismatch", amount: 25 });
  }
  if (edgeMismatch) {
    integrityScore -= 25;
    penalties.push({ type: "edgeMismatch", amount: 25 });
  }

  integrityScore = Math.max(0, Math.min(100, integrityScore));

  const pitcherIntegrity = resolvePitcherIntegrity(prop);
  const opponentIntegrity = resolveOpponentIntegrity(prop);
  const seasonDataIntegrity = resolveSeasonDataIntegrity(prop);

  const dataIntegrityWarning =
    hitRateCheck.hasInvalidHitRate ||
    truth.probabilityMismatch ||
    edgeMismatch ||
    integrityScore < 90;

  const tierAEligible =
    integrityScore >= 90 &&
    !hitRateCheck.hasInvalidHitRate &&
    !truth.probabilityMismatch &&
    !dataIntegrityWarning &&
    seasonDataIntegrity >= 80 &&
    pitcherIntegrity >= 80 &&
    (resolvePropSanity(prop) ?? 0) >= 90;

  return {
    integrityScore,
    penalties,
    hitRateInvalid: hitRateCheck.hasInvalidHitRate,
    probabilityMismatch: truth.probabilityMismatch,
    edgeMismatch,
    dataIntegrityWarning,
    tierAEligible,
    reviewNeeded: !tierAEligible && (dataIntegrityWarning || integrityScore < 90),
    pitcherIntegrity,
    opponentIntegrity,
    seasonDataIntegrity,
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
    dataIntegrityWarning: integrityAudit.dataIntegrityWarning,
    reviewNeeded: integrityAudit.reviewNeeded,
  };
}
