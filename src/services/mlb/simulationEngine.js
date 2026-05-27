/**
 * Monte Carlo / Poisson simulation for MLB prop probabilities.
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logProb = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i += 1) logProb -= Math.log(i);
  return Math.exp(logProb);
}

function poissonOverProbability(line, lambda, maxK = 30) {
  const threshold = Math.floor(line);
  let underProb = 0;
  for (let k = 0; k <= threshold; k += 1) {
    underProb += poissonPmf(k, lambda);
  }
  return clamp(1 - underProb, 0, 1);
}

function normalSample(mean, stdDev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

export function simulatePropOutcome({ projection, line, volatility = 0.25, iterations = 2000, distribution = "poisson" } = {}) {
  const mean = Number(projection);
  const ln = Number(line);
  if (!Number.isFinite(mean) || mean <= 0 || !Number.isFinite(ln) || ln <= 0) {
    return {
      overProbability: null,
      underProbability: null,
      expectedValue: null,
      variance: null,
      confidenceInterval: null,
      iterations: 0,
    };
  }

  if (distribution === "poisson") {
    const overProbability = poissonOverProbability(ln, mean);
    const underProbability = 1 - overProbability;
    const variance = mean;
    return {
      overProbability: Number(overProbability.toFixed(4)),
      underProbability: Number(underProbability.toFixed(4)),
      expectedValue: mean,
      variance,
      confidenceInterval: [Math.max(0, mean - 1.96 * Math.sqrt(variance)), mean + 1.96 * Math.sqrt(variance)],
      iterations: 0,
      distribution: "poisson",
    };
  }

  const stdDev = Math.max(mean * volatility, 0.15);
  let overCount = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < iterations; i += 1) {
    const sample = Math.max(0, normalSample(mean, stdDev));
    if (sample > ln) overCount += 1;
    sum += sample;
    sumSq += sample * sample;
  }
  const overProbability = overCount / iterations;
  const avg = sum / iterations;
  const variance = sumSq / iterations - avg * avg;

  return {
    overProbability: Number(overProbability.toFixed(4)),
    underProbability: Number((1 - overProbability).toFixed(4)),
    expectedValue: Number(avg.toFixed(3)),
    variance: Number(Math.max(variance, 0).toFixed(4)),
    confidenceInterval: [Number((avg - 1.96 * Math.sqrt(variance)).toFixed(3)), Number((avg + 1.96 * Math.sqrt(variance)).toFixed(3))],
    iterations,
    distribution: "normal-mc",
  };
}

export function estimateExpectedRoi({ overProbability, underProbability, side = "over", payout = 1 } = {}) {
  const p = String(side).toLowerCase().includes("under") ? underProbability : overProbability;
  if (!Number.isFinite(p)) return null;
  return Number(((p * payout) - (1 - p)).toFixed(4));
}
