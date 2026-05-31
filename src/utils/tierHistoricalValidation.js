/**
 * Historical data presence + maximum tier caps for verified play tiers.
 */

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export const HISTORICAL_DATA_UNAVAILABLE_WARNING = "⚠ Historical data unavailable";
export const TIER_A_MIN_SANITY_SCORE = 80;
export const TIER_B_MIN_SANITY_SCORE = 65;
export const TIER_C_MIN_SANITY_SCORE = 50;
export const MAX_SANITY_WITHOUT_HISTORY = 50;
export const MAX_CONFIDENCE_WITHOUT_HISTORY = 50;
export const MAX_PLAYABILITY_WITHOUT_HISTORY = 25;
export const RESEARCH_ONLY_TIER_LABEL = "Research Only";

const TIER_RANK = { A: 0, B: 1, C: 2, D: 3 };

function hasStoredLast5(prop = {}) {
  if (finite(prop.last5HitRate) != null) return true;
  if (finite(prop.last5Average) != null) return true;
  if (finite(prop.recentForm) != null) return true;
  return finite(prop.pitcherInputs?.last5Average) != null;
}

function hasStoredLast10(prop = {}) {
  if (finite(prop.last10HitRate) != null) return true;
  if (finite(prop.recentHitRate) != null) return true;
  if (finite(prop.last10Average) != null) return true;
  return finite(prop.pitcherInputs?.last10Average) != null;
}

function hasStoredSeason(prop = {}) {
  if (finite(prop.seasonHitRate) != null) return true;
  if (finite(prop.historicalHitRate) != null) return true;
  if (finite(prop.seasonAverage) != null) return true;
  return finite(prop.pitcherInputs?.seasonAverage) != null;
}

/** Last5 + Last10 + Season present on the prop (averages or hit rates). */
export function resolveHistoricalDataPresent(prop = {}) {
  const last5Present = hasStoredLast5(prop);
  const last10Present = hasStoredLast10(prop);
  const seasonPresent = hasStoredSeason(prop);
  const missingLabels = [];
  if (!last5Present) missingLabels.push("Last5");
  if (!last10Present) missingLabels.push("Last10");
  if (!seasonPresent) missingLabels.push("Season");

  return {
    present: last5Present && last10Present && seasonPresent,
    last5Present,
    last10Present,
    seasonPresent,
    missingLabels,
  };
}

/** Tier A requires actual stored hit rates — not line-estimated substitutes. */
export function resolveHitRateValidationPresent(prop = {}) {
  const last5HitRate = finite(prop.last5HitRate);
  const last10HitRate = finite(prop.last10HitRate) ?? finite(prop.recentHitRate);
  const seasonHitRate = finite(prop.seasonHitRate) ?? finite(prop.historicalHitRate);
  const missingLabels = [];
  if (last5HitRate == null) missingLabels.push("Last5");
  if (last10HitRate == null) missingLabels.push("Last10");
  if (seasonHitRate == null) missingLabels.push("Season");

  return {
    present: last5HitRate != null && last10HitRate != null && seasonHitRate != null,
    last5HitRate,
    last10HitRate,
    seasonHitRate,
    missingLabels,
  };
}

export function resolveMaximumTier({ playability, sanityFail = false } = {}) {
  if (sanityFail) return "RESEARCH";
  const play = finite(playability);
  if (play != null && play < 40) return "C";
  if (play != null && play < 50) return "B";
  return "A";
}

/** Small confidence haircut when history is incomplete — informational, not a rejection gate. */
export function applyMissingHistoricalConfidencePenalty(confidence, prop = {}) {
  const base = Number(confidence);
  if (!Number.isFinite(base)) return confidence;
  const historical = resolveHistoricalDataPresent(prop);
  if (historical.present) return Math.round(base);

  let penalty = 0;
  if (!historical.last5Present) penalty += 3;
  if (!historical.last10Present) penalty += 3;
  if (!historical.seasonPresent) penalty += 2;
  return Math.max(35, Math.round(base - penalty));
}

export function capTierToMaximum(tier, maximumTier) {
  if (!tier) return tier;
  if (!maximumTier) return tier;
  if (maximumTier === "RESEARCH") return tier === "A" || tier === "B" ? "C" : "D";
  const current = TIER_RANK[tier];
  const max = TIER_RANK[maximumTier];
  if (current == null || max == null) return tier;
  if (current < max) return maximumTier;
  return tier;
}
