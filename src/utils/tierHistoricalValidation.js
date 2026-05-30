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

function hasBreakdownValue(prop = {}, pattern) {
  const row = (prop.projectionBreakdown || []).find((item) => pattern.test(String(item?.label || "")));
  return finite(row?.value) != null;
}

function hasHistoricalLast5(prop = {}) {
  if (finite(prop.last5HitRate) != null) return true;
  if (finite(prop.last5Average) != null) return true;
  if (finite(prop.pitcherInputs?.last5Average) != null) return true;
  return hasBreakdownValue(prop, /last\s*5/i);
}

function hasHistoricalLast10(prop = {}) {
  if (finite(prop.last10HitRate) != null) return true;
  if (finite(prop.recentHitRate) != null) return true;
  if (finite(prop.last10Average) != null) return true;
  if (finite(prop.pitcherInputs?.last10Average) != null) return true;
  return hasBreakdownValue(prop, /last\s*10/i);
}

function hasHistoricalSeason(prop = {}) {
  if (finite(prop.seasonHitRate) != null) return true;
  if (finite(prop.historicalHitRate) != null) return true;
  if (finite(prop.seasonAverage) != null) return true;
  if (finite(prop.pitcherInputs?.seasonAverage) != null) return true;
  return hasBreakdownValue(prop, /season/i);
}

export function resolveHistoricalDataPresent(prop = {}) {
  const last5Present = hasHistoricalLast5(prop);
  const last10Present = hasHistoricalLast10(prop);
  const seasonPresent = hasHistoricalSeason(prop);
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
