/**
 * Phase 16 — data integrity scoring for audit panel.
 */

import { resolveVerifiedHitRateSnapshot } from "./verifiedHitRates.js";
import { resolveHistoricalDataPresent } from "./tierHistoricalValidation.js";
import { isFullDataProp } from "./boardQuality.js";
import { resolveProjectionValue } from "./projectionQuality.js";
import { STARTER_PENDING_LABEL } from "./opponentStarter.js";

export const INTEGRITY_VERIFIED = "verified";
export const INTEGRITY_PARTIAL = "partial";
export const INTEGRITY_MISSING = "missing";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function scoreFromChecks(checks = []) {
  if (!checks.length) return INTEGRITY_MISSING;
  if (checks.every(Boolean)) return INTEGRITY_VERIFIED;
  if (checks.some(Boolean)) return INTEGRITY_PARTIAL;
  return INTEGRITY_MISSING;
}

function resolvePlayerDataScore(prop = {}) {
  const historical = resolveHistoricalDataPresent(prop);
  const hitRates = resolveVerifiedHitRateSnapshot(prop);
  return scoreFromChecks([
    historical.present,
    hitRates.last5Label !== "—",
    hitRates.last10Label !== "—",
    hitRates.seasonLabel !== "—" && hitRates.seasonLabel !== "0%",
    finite(prop.seasonAverage) != null || finite(prop.last10Average) != null,
  ]);
}

function resolveMatchupDataScore(prop = {}) {
  const opponent = String(prop.opponent || "").trim();
  const starter = String(
    prop.opposingPitcher || prop.opponentStarterNote || prop.matchupAudit?.pitcher || ""
  ).trim();
  const whip = finite(prop.opponentPitcherWhip ?? prop.opponentContext?.whip);
  const whipValid = whip != null && whip > 0;
  const starterValid = Boolean(starter && starter !== "—" && starter !== STARTER_PENDING_LABEL);
  return scoreFromChecks([Boolean(opponent), starterValid, whipValid || !opponent]);
}

function resolveProjectionDataScore(prop = {}) {
  const projection = finite(resolveProjectionValue(prop));
  const line = finite(prop.line);
  const sanity = prop.projectionSanityAudit;
  return scoreFromChecks([
    projection != null && projection > 0,
    line != null && line > 0,
    isFullDataProp(prop),
    !sanity?.sanityFail,
    !prop.projectionClamped || prop.projectionValidation?.outlierSupported,
  ]);
}

function resolveProbabilityDataScore(prop = {}) {
  const probability = finite(prop.probabilityScore ?? prop.verifiedProbability);
  const audit = prop.probabilityAudit;
  const hitRates = resolveVerifiedHitRateSnapshot(prop);
  const seasonValid = Boolean(prop.seasonRateValid && hitRates.seasonLabel !== "—" && hitRates.seasonLabel !== "0%");
  return scoreFromChecks([
    probability != null && probability >= 50,
    Boolean(audit?.finalProbability != null || prop.probabilityCalibration),
    hitRates.last10Label !== "—",
    seasonValid,
  ]);
}

export function buildDataIntegrityAudit(prop = {}) {
  return {
    playerDataScore: resolvePlayerDataScore(prop),
    matchupDataScore: resolveMatchupDataScore(prop),
    projectionDataScore: resolveProjectionDataScore(prop),
    probabilityDataScore: resolveProbabilityDataScore(prop),
  };
}

export function attachDataIntegrityFields(prop = {}) {
  const dataIntegrity = buildDataIntegrityAudit(prop);
  return { ...prop, dataIntegrity };
}
