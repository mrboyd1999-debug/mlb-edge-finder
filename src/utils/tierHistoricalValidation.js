/**
 * Historical data presence + maximum tier caps for verified play tiers.
 */

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export const HISTORICAL_DATA_UNAVAILABLE_WARNING = "⚠ Historical data unavailable";
export const TIER_A_MIN_SANITY_SCORE = 70;
export const MAX_SANITY_WITHOUT_HISTORY = 60;

const TIER_RANK = { A: 0, B: 1, C: 2 };

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

export function resolveMaximumTier({ playability, historicalPresent = true } = {}) {
  const play = finite(playability);
  if (play != null && play < 40) return "C";
  if (play != null && play < 50) return "B";
  if (!historicalPresent) return "B";
  return "A";
}

export function capTierToMaximum(tier, maximumTier) {
  if (!tier || !maximumTier) return tier;
  const current = TIER_RANK[tier];
  const max = TIER_RANK[maximumTier];
  if (current == null || max == null) return tier;
  if (current < max) return maximumTier;
  return tier;
}
