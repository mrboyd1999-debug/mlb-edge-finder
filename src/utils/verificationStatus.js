/**
 * Play verification tiers — MLB Stats API enhances FULL status but never blocks generation.
 */

import { normalizeSource } from "./normalizeSource.js";
import { PITCHER_VERIFICATION, resolvePitcherVerification } from "./opponentStarter.js";
import { resolveProjectionValue } from "./projectionQuality.js";
import {
  buildVerificationBreakdown,
  formatVerificationBreakdownLines,
  qualifiesFormBasedFullVerification,
  resolveFormVerificationIntegrityScore,
  resolvePartialVerificationReason,
} from "./verificationBreakdown.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function hasMlbStatsApiData(prop = {}) {
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
  RESEARCH: "RESEARCH",
  UNVERIFIED: "UNVERIFIED",
};

export const FORM_VERIFIED_REASON = "Verified using player form and market data.";

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
  if (src === "underdog" || src === "prizepicks") return true;
  return finite(prop.line) > 0 && (prop.lineVerified || prop.sportsbookLineVerified);
}

export function resolvePitcherVerified(prop = {}) {
  const verification =
    prop.pitcherVerification ||
    prop.pitcherVerificationLevel ||
    resolvePitcherVerification(prop).pitcherVerification;
  return verification === PITCHER_VERIFICATION.VERIFIED;
}

function hasResearchProjection(prop = {}) {
  const projection = resolvePlayProjection(prop);
  return projection != null && projection > 0;
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
  const formVerified = qualifiesFormBasedFullVerification(prop);
  const hasMarketData = sportsData || cachedLine || statsApi;

  if (formVerified && hasMarketData) {
    return VERIFICATION_STATUS.FULL;
  }

  if (statsApi && pitcherVerified) {
    return VERIFICATION_STATUS.FULL;
  }

  if (hasMarketData || statsApi) {
    return VERIFICATION_STATUS.PARTIAL;
  }

  if (hasResearchProjection(prop)) {
    return VERIFICATION_STATUS.RESEARCH;
  }

  return VERIFICATION_STATUS.UNVERIFIED;
}

export function resolveVerificationReason(prop = {}) {
  const status = resolveVerificationStatus(prop);
  if (status === VERIFICATION_STATUS.FULL) {
    if (qualifiesFormBasedFullVerification(prop) && !resolvePitcherVerified(prop)) {
      return FORM_VERIFIED_REASON;
    }
    return "Full verification";
  }
  if (status === VERIFICATION_STATUS.PARTIAL) {
    return resolvePartialVerificationReason(prop);
  }
  if (status === VERIFICATION_STATUS.RESEARCH) {
    return "Research — limited supporting data";
  }
  return "Unverified";
}

export function attachVerificationStatusFields(prop = {}) {
  const verificationStatus = resolveVerificationStatus(prop);
  const verificationBreakdown = buildVerificationBreakdown(prop);
  const verificationReason = resolveVerificationReason(prop);
  const partialVerificationReason =
    verificationStatus === VERIFICATION_STATUS.PARTIAL ? verificationReason : "";

  if (verificationStatus === VERIFICATION_STATUS.PARTIAL && import.meta.env?.DEV) {
    console.info(
      `[MLB Verification] PARTIAL: ${prop.playerName || prop.player || "Unknown"} — ${partialVerificationReason}`
    );
  }

  return {
    ...prop,
    verificationStatus,
    verificationStatusLabel:
      verificationStatus === VERIFICATION_STATUS.FULL
        ? "Full verification"
        : verificationStatus === VERIFICATION_STATUS.PARTIAL
          ? "Partial verification"
          : verificationStatus === VERIFICATION_STATUS.RESEARCH
            ? "Research"
            : "Unverified",
    verificationReason,
    partialVerificationReason,
    verificationBreakdown,
    verificationBreakdownLines: formatVerificationBreakdownLines(verificationBreakdown),
    formVerificationIntegrityScore: resolveFormVerificationIntegrityScore(prop),
    allowFallbackVerification,
    ...(verificationStatus === VERIFICATION_STATUS.FULL
      ? {
          playCategory: "VERIFIED",
          playCategoryLabel: "Verified Play",
          cardPlayLabel: "Verified Play",
        }
      : {}),
  };
}

export function isFullyVerifiedPlay(prop = {}) {
  return resolveVerificationStatus(prop) === VERIFICATION_STATUS.FULL;
}

export function isPartiallyVerifiedPlay(prop = {}) {
  return resolveVerificationStatus(prop) === VERIFICATION_STATUS.PARTIAL;
}

export function isResearchVerifiedPlay(prop = {}) {
  return resolveVerificationStatus(prop) === VERIFICATION_STATUS.RESEARCH;
}

export function isBoardEligibleVerification(prop = {}) {
  const status = resolveVerificationStatus(prop);
  if (status === VERIFICATION_STATUS.UNVERIFIED) return false;
  if (status === VERIFICATION_STATUS.FULL) return true;
  if (status === VERIFICATION_STATUS.PARTIAL) {
    return allowFallbackVerification;
  }
  return status === VERIFICATION_STATUS.RESEARCH;
}

export function countVerificationStatuses(pool = []) {
  const counts = {
    projectedProps: 0,
    verifiedFull: 0,
    verifiedPartial: 0,
    verifiedResearch: 0,
    unverified: 0,
  };
  for (const prop of pool || []) {
    const projection = resolvePlayProjection(prop);
    if (projection != null && projection > 0) counts.projectedProps += 1;
    const status = resolveVerificationStatus(prop);
    if (status === VERIFICATION_STATUS.FULL) counts.verifiedFull += 1;
    else if (status === VERIFICATION_STATUS.PARTIAL) counts.verifiedPartial += 1;
    else if (status === VERIFICATION_STATUS.RESEARCH) counts.verifiedResearch += 1;
    else counts.unverified += 1;
  }
  return counts;
}
