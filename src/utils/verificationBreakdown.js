/**
 * Verification breakdown — component pass/fail and partial-status reasons.
 */

import { normalizeSource } from "./normalizeSource.js";
import { PITCHER_VERIFICATION, PROBABLE_STARTER_PENDING_LABEL, resolvePitcherVerification } from "./opponentStarter.js";
import { computeWeightedIntegrityScore } from "./integrityAudit.js";
import { resolveProjectionValue } from "./projectionQuality.js";

export const FORM_FULL_MIN_PROBABILITY = 70;
export const FORM_FULL_MIN_CONFIDENCE = 65;
export const FORM_FULL_MIN_INTEGRITY = 85;
export const STRONG_BEST_PLAY_MIN_PROBABILITY = 72;
export const STRONG_BEST_PLAY_MIN_CONFIDENCE = 65;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolvePropConfidence(prop = {}) {
  return finite(prop.finalConfidence ?? prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence) ?? NaN;
}

function resolvePropProbability(prop = {}) {
  return finite(prop.finalProbability ?? prop.probabilityScore ?? prop.verifiedProbability) ?? NaN;
}

function resolvePlayProjection(prop = {}) {
  if (prop.projectionUnavailable || prop.unverifiedGradeBlocked) return null;
  const direct = finite(prop.projection ?? prop.projectedValue);
  if (direct != null && direct > 0) return direct;
  const resolved = finite(resolveProjectionValue(prop));
  return resolved != null && resolved > 0 ? resolved : null;
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

function hasSportsDataIoData(prop = {}) {
  return Boolean(
    /sportsdata/i.test(String(prop.projectionSource || "")) ||
      prop.sportsDataGames != null ||
      prop.sportsDataRawStat != null ||
      prop.sportsDataPropLabel ||
      prop.isSportsDataSeasonProjection
  );
}

function hasCachedSportsbookLine(prop = {}) {
  if (prop.fromCache || prop.cachedLine || prop.usingCachedLine) return true;
  const src = normalizeSource(prop);
  if (src === "underdog" || src === "prizepicks") return true;
  return finite(prop.line) > 0 && (prop.lineVerified || prop.sportsbookLineVerified);
}

function resolvePitcherVerified(prop = {}) {
  const verification =
    prop.pitcherVerification ||
    prop.pitcherVerificationLevel ||
    resolvePitcherVerification(prop).pitcherVerification;
  return verification === PITCHER_VERIFICATION.VERIFIED;
}

function isPitcherUnavailable(prop = {}) {
  if (resolvePitcherVerified(prop)) return false;
  const pitcher = String(
    prop.opposingPitcher || prop.opponentStarterNote || prop.matchupAudit?.pitcher || ""
  ).trim();
  return (
    !pitcher ||
    pitcher === "—" ||
    pitcher === PROBABLE_STARTER_PENDING_LABEL ||
    /pitcher pending|starter pending|probable starter pending|opponent pitcher unavailable/i.test(pitcher)
  );
}

export function resolveFormVerificationIntegrityScore(prop = {}) {
  const cached = finite(prop.formVerificationIntegrityScore);
  if (cached != null) return cached;

  const audit = prop.integrityAudit;
  if (audit?.projectionIntegrity != null) {
    return computeWeightedIntegrityScore({
      projectionIntegrity: audit.projectionIntegrity,
      seasonDataIntegrity: audit.seasonDataIntegrity,
      opponentIntegrity: audit.opponentIntegrity,
      pitcherIntegrity: 85,
    });
  }

  const rawIntegrity = finite(prop.integrityScore);
  if (rawIntegrity != null) {
    return Math.min(99, rawIntegrity + 9);
  }

  return 0;
}

export function qualifiesFormBasedFullVerification(prop = {}) {
  const probability = resolvePropProbability(prop);
  const confidence = resolvePropConfidence(prop);
  if (probability == null || probability < FORM_FULL_MIN_PROBABILITY) return false;
  if (confidence == null || confidence < FORM_FULL_MIN_CONFIDENCE) return false;

  const breakdown = buildVerificationBreakdown(prop);
  const integrityScore = resolveFormVerificationIntegrityScore(prop);
  if (integrityScore >= FORM_FULL_MIN_INTEGRITY) return true;

  const pitcherOnlyGap =
    breakdown.historical.pass &&
    breakdown.projectionQuality.pass &&
    !breakdown.pitcherVerification.pass;

  return pitcherOnlyGap;
}

export function passesStrongMetricBestPlayGate(prop = {}) {
  const probability = resolvePropProbability(prop);
  const confidence = resolvePropConfidence(prop);
  const projection = resolvePlayProjection(prop);
  return (
    projection != null &&
    projection > 0 &&
    probability != null &&
    probability >= STRONG_BEST_PLAY_MIN_PROBABILITY &&
    confidence != null &&
    confidence >= STRONG_BEST_PLAY_MIN_CONFIDENCE
  );
}

export function buildVerificationBreakdown(prop = {}) {
  const historicalPass = hasMlbStatsApiData(prop);
  const linePass = hasCachedSportsbookLine(prop) && finite(prop.line) > 0;
  const projectionPass =
    resolvePlayProjection(prop) != null &&
    !prop.projectionUnavailable &&
    !prop.unverifiedGradeBlocked;
  const pitcherPass = resolvePitcherVerified(prop);

  return {
    historical: { label: "Historical", pass: historicalPass },
    lineVerification: { label: "Line Verification", pass: linePass },
    projectionQuality: { label: "Projection Quality", pass: projectionPass },
    pitcherVerification: { label: "Pitcher Verification", pass: pitcherPass },
  };
}

export function resolvePartialVerificationReason(prop = {}) {
  const breakdown = prop.verificationBreakdown || buildVerificationBreakdown(prop);
  const reasons = [];

  if (!breakdown.historical.pass) reasons.push("Historical data incomplete");
  if (!breakdown.lineVerification.pass) reasons.push("Line verification incomplete");
  if (!breakdown.projectionQuality.pass) reasons.push("Projection quality incomplete");
  if (!breakdown.pitcherVerification.pass || isPitcherUnavailable(prop)) {
    reasons.push("Pitcher not available");
  }

  return reasons.length ? reasons.join("; ") : "Partial verification";
}

export function formatVerificationBreakdownLines(breakdown = {}) {
  return Object.values(breakdown).map((row) => {
    const status = row?.pass ? "PASS" : "FAIL";
    return `${row?.label || "Check"}: ${status}`;
  });
}
