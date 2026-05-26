/**
 * Rolling-form projections from verified MLB Stats API game logs only.
 */

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

/**
 * Weighted recent average — most recent games weighted highest.
 * @returns {{ value: number, sampleSize: number, window: number } | null}
 */
export function computeWeightedRollingProjection(values = [], window = 5, minSample = 3) {
  const clean = (values || []).filter(Number.isFinite).slice(0, window);
  if (clean.length < minSample) return null;
  const weights = clean.map((_, index) => window - index);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) return null;
  const value = clean.reduce((sum, val, index) => sum + val * weights[index], 0) / weightSum;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value: round(value, 1), sampleSize: clean.length, window };
}

export function buildRollingFormReason({ window, sampleSize, statLabel = "games" }) {
  return `Weighted last ${Math.min(window, sampleSize)} ${statLabel} from MLB Stats API logs`;
}
