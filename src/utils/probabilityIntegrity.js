/**
 * Probability integrity score and inflation detection.
 */

import { resolveOpposingPitcherDisplayLabel, PROBABLE_STARTER_PENDING_LABEL } from "./opponentStarter.js";
import { resolveHistoricalProbability, resolveCalibrationHitRates } from "./probabilityCalibration.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveSampleGames(prop = {}, hitRates = {}) {
  return (
    finite(hitRates.last10Games) ??
    finite(prop.sampleGames) ??
    finite(prop.gameLogCount) ??
    finite(prop.sampleSize) ??
    null
  );
}

function isStaleProjection(prop = {}) {
  if (prop.projectionStale || prop.staleProjection) return true;
  const source = String(prop.projectionSource || "").toLowerCase();
  return /fallback|estimate|missing|stale|line-only/.test(source) || Boolean(prop.isFallbackProjection);
}

export function computePropIntegrityScore(prop = {}, hitRates = null) {
  const rates = hitRates || prop.probabilityCalibration?.hitRates || resolveCalibrationHitRates(prop);
  let score = 100;
  const deductions = [];

  if (!rates.seasonRateValid && !prop.seasonRateValid && finite(prop.seasonHitRate) == null) {
    score -= 10;
    deductions.push({ label: "No season data", amount: 10 });
  }

  const pitcher = resolveOpposingPitcherDisplayLabel(prop);
  if (!pitcher || pitcher === PROBABLE_STARTER_PENDING_LABEL || /unavailable|pending/i.test(pitcher)) {
    score -= 10;
    deductions.push({ label: "No pitcher", amount: 10 });
  }

  const sampleGames = resolveSampleGames(prop, rates);
  if (sampleGames != null && sampleGames < 10) {
    score -= 10;
    deductions.push({ label: "Low sample", amount: 10 });
  }

  if (isStaleProjection(prop)) {
    score -= 10;
    deductions.push({ label: "Stale projection", amount: 10 });
  }

  return {
    integrityScore: Math.max(0, Math.round(score)),
    integrityDeductions: deductions,
  };
}

export function isInflatedProbabilityProp(prop = {}, probability = null) {
  const prob = finite(probability ?? prop.probabilityScore ?? prop.verifiedProbability ?? prop.probabilityNormalized);
  if (prob == null) return false;
  const hitRates = prop.probabilityCalibration?.hitRates || resolveCalibrationHitRates(prop);
  const mergedRates = {
    ...hitRates,
    last10HitRate: hitRates.last10HitRate ?? prop.last10HitRate ?? prop.recentHitRate,
    last5HitRate: hitRates.last5HitRate ?? prop.last5HitRate,
  };
  const hasRealHistory = Boolean(
    mergedRates.last10HitRate != null ||
      mergedRates.last5HitRate != null ||
      (mergedRates.seasonRateValid && mergedRates.seasonHitRate != null)
  );
  if (!hasRealHistory) return false;
  const historical = resolveHistoricalProbability(mergedRates);
  if (historical == null) return false;
  return prob > historical + 20;
}
