/**
 * Play verification tiers — MLB Stats API enhances FULL status but never blocks generation.
 */

import { normalizeSource } from "./normalizeSource.js";
import { PITCHER_VERIFICATION, resolvePitcherVerification } from "./opponentStarter.js";
import { resolveProjectionValue } from "./projectionQuality.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasMlbStatsApiData(prop = {}) {
  return Boolean(
    prop.hasVerifiedStats ||
      prop.statsProfile ||
      prop.historicalCoverage === true ||
      Number(prop.sampleSize) >= 5 ||
      prop.historicalStatsAttached ||
      prop.hasGameLogs ||
      prop.historicalDataPresent
  );
}

export function hasSportsDataIoData(prop = {}) {
  return Boolean(
    /sportsdata/i.test(String(prop.projectionSource || "")) ||
      prop.sportsDataGames != null ||
      prop.sportsDataRawStat != null ||
      prop.sportsDataPropLabel ||
      prop.isSportsDataSeasonProjection
  );
}

export const VERIFICATION_STATUS = {
  FULL: "FULL",
  PARTIAL: "PARTIAL",
  UNVERIFIED: "UNVERIFIED",
};

/** When true, verified play sections populate without MLB Stats API historical attachment. */
export const allowFallbackVerification = true;

export function resolvePlayProjection(prop = {}) {
  if (prop.projectionUnavailable || prop.unverifiedGradeBlocked) return null;
  const direct = finite(prop.projection ?? prop.projectedValue);
  if (direct != null && direct > 0) return direct;
  const resolved = finite(resolveProjectionValue(prop));
  return resolved != null && resolved > 0 ? resolved : null;
}

export function hasCachedSportsbookLine(prop = {}) {
  if (prop.fromCache || prop.cachedLine || prop.usingCachedLine) return true;
  const src = normalizeSource(prop);
  return src === "underdog" || src === "prizepicks";
}

export function resolvePitcherVerified(prop = {}) {
  const verification =
    prop.pitcherVerification ||
    prop.pitcherVerificationLevel ||
    resolvePitcherVerification(prop).pitcherVerification;
  return verification === PITCHER_VERIFICATION.VERIFIED;
}

export function resolveVerificationStatus(prop = {}) {
  if (prop.projectionUnavailable || prop.unverifiedGradeBlocked) {
    return VERIFICATION_STATUS.UNVERIFIED;
  }

  const projection = resolvePlayProjection(prop);
  if (projection == null || projection <= 0) {
    return VERIFICATION_STATUS.UNVERIFIED;
  }

  const statsApi = hasMlbStatsApiData(prop);
  const sportsData = hasSportsDataIoData(prop);
  const cachedLine = hasCachedSportsbookLine(prop);
  const pitcherVerified = resolvePitcherVerified(prop);

  if (statsApi && pitcherVerified) {
    return VERIFICATION_STATUS.FULL;
  }
  if (sportsData || cachedLine) {
    return VERIFICATION_STATUS.PARTIAL;
  }
  if (statsApi) {
    return VERIFICATION_STATUS.PARTIAL;
  }

  return VERIFICATION_STATUS.UNVERIFIED;
}

export function attachVerificationStatusFields(prop = {}) {
  const verificationStatus = resolveVerificationStatus(prop);
  return {
    ...prop,
    verificationStatus,
    verificationStatusLabel:
      verificationStatus === VERIFICATION_STATUS.FULL
        ? "Full verification"
        : verificationStatus === VERIFICATION_STATUS.PARTIAL
          ? "Partial verification"
          : "Unverified",
    allowFallbackVerification,
  };
}

export function isFullyVerifiedPlay(prop = {}) {
  return resolveVerificationStatus(prop) === VERIFICATION_STATUS.FULL;
}

export function isPartiallyVerifiedPlay(prop = {}) {
  return resolveVerificationStatus(prop) === VERIFICATION_STATUS.PARTIAL;
}

export function isBoardEligibleVerification(prop = {}) {
  const status = resolveVerificationStatus(prop);
  if (status === VERIFICATION_STATUS.UNVERIFIED) return false;
  if (status === VERIFICATION_STATUS.FULL) return true;
  return allowFallbackVerification && status === VERIFICATION_STATUS.PARTIAL;
}

export function countVerificationStatuses(pool = []) {
  const counts = {
    projectedProps: 0,
    verifiedFull: 0,
    verifiedPartial: 0,
    unverified: 0,
  };
  for (const prop of pool || []) {
    const projection = resolvePlayProjection(prop);
    if (projection != null && projection > 0) counts.projectedProps += 1;
    const status = resolveVerificationStatus(prop);
    if (status === VERIFICATION_STATUS.FULL) counts.verifiedFull += 1;
    else if (status === VERIFICATION_STATUS.PARTIAL) counts.verifiedPartial += 1;
    else counts.unverified += 1;
  }
  return counts;
}
