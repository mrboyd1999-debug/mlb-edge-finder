/**
 * Probability distribution audit — histogram, spread, and compression diagnostics.
 */

import {
  computeConservativeProbability,
  resolveProjectionValue,
} from "./conservativeProjection.js";
import { computeStatSpecificProbability } from "./mlbStatProbability.js";
import {
  computeStandardEdge,
  computeStandardEdgePercent,
} from "./standardPropMetrics.js";

export const PROBABILITY_HISTOGRAM_BUCKETS = [
  { id: "50-55", label: "50-55%", min: 50, max: 55 },
  { id: "55-60", label: "55-60%", min: 55, max: 60 },
  { id: "60-65", label: "60-65%", min: 60, max: 65 },
  { id: "65-70", label: "65-70%", min: 65, max: 70 },
  { id: "70-75", label: "70-75%", min: 70, max: 75 },
  { id: "75+", label: "75%+", min: 75, max: Infinity },
];

const RESEARCH_CAP = 70;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function resolveDisplayedProbability(prop = {}) {
  return finite(prop.probabilityScore ?? prop.verifiedProbability);
}

export function assignProbabilityBucket(probability) {
  const prob = finite(probability);
  if (prob == null) return null;
  if (prob >= 75) return "75+";
  if (prob >= 70) return "70-75";
  if (prob >= 65) return "65-70";
  if (prob >= 60) return "60-65";
  if (prob >= 55) return "55-60";
  if (prob >= 50) return "50-55";
  return "below-50";
}

function emptyHistogram() {
  return PROBABILITY_HISTOGRAM_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.id] = 0;
    return acc;
  }, {});
}

export function buildProbabilityHistogram(probabilities = []) {
  const histogram = emptyHistogram();
  for (const value of probabilities) {
    const bucket = assignProbabilityBucket(value);
    if (bucket && histogram[bucket] != null) histogram[bucket] += 1;
  }
  return PROBABILITY_HISTOGRAM_BUCKETS.map((bucket) => ({
    ...bucket,
    count: histogram[bucket.id] ?? 0,
  }));
}

function summarizeProbabilities(probabilities = []) {
  const values = probabilities.filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { min: null, max: null, average: null, spread: null, count: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    min: round1(min),
    max: round1(max),
    average: round1(average),
    spread: round1(max - min),
    count: values.length,
  };
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function resolveProbabilityPipelineValues(prop = {}, metrics = {}) {
  const projection = finite(metrics.projection ?? resolveProjectionValue(prop));
  const line = finite(prop.line);
  const edge = finite(metrics.edge ?? computeStandardEdge(projection, line));
  const edgePercent = finite(metrics.edgePercent ?? computeStandardEdgePercent(edge, line));
  const metricInput = { edge, edgePercent, projection };

  const statSpecific = computeStatSpecificProbability(prop, projection, line);
  const displayed = resolveDisplayedProbability(prop);
  const researchCapped = computeConservativeProbability(prop, metricInput, { verified: false });
  const verifiedCapped = computeConservativeProbability(prop, metricInput, { verified: true });

  const compressionFlags = [];
  if (displayed === RESEARCH_CAP) compressionFlags.push("research_cap_70");
  if (displayed != null && statSpecific != null && statSpecific > displayed + 1) {
    compressionFlags.push("stat_specific_higher_than_display");
  }
  if (researchCapped === RESEARCH_CAP && verifiedCapped != null && verifiedCapped > RESEARCH_CAP) {
    compressionFlags.push("verified_tier_would_score_higher");
  }
  if (displayed != null && displayed >= 68 && displayed <= 70) compressionFlags.push("cluster_band_68_70");

  return {
    displayed,
    statSpecific,
    researchCapped,
    verifiedCapped,
    compressionFlags,
    likelyResearchCap: displayed === RESEARCH_CAP && researchCapped === RESEARCH_CAP,
  };
}

function buildCompressionAudit(pool = [], probabilities = []) {
  const pipeline = pool.map((prop) => resolveProbabilityPipelineValues(prop));
  const exact70 = probabilities.filter((value) => value === RESEARCH_CAP).length;
  const band68to70 = probabilities.filter((value) => value >= 68 && value <= 70).length;
  const uniqueDisplayed = new Set(probabilities.map((value) => round1(value))).size;
  const researchCapHits = pipeline.filter((row) => row.likelyResearchCap).length;
  const statHigher = pipeline.filter((row) =>
    row.compressionFlags.includes("stat_specific_higher_than_display")
  ).length;
  const verifiedWouldScoreHigher = pipeline.filter((row) =>
    row.compressionFlags.includes("verified_tier_would_score_higher")
  ).length;

  const notes = [];
  if (researchCapHits > 0) {
    notes.push(`${researchCapHits} props capped at ${RESEARCH_CAP}% by research display cap`);
  }
  if (statHigher > 0) {
    notes.push(`${statHigher} props have stat-specific probability above displayed value`);
  }
  if (verifiedWouldScoreHigher > 0) {
    notes.push(`${verifiedWouldScoreHigher} props would score higher with verified-tier cap`);
  }
  if (uniqueDisplayed <= 3 && probabilities.length >= 10) {
    notes.push(`Only ${uniqueDisplayed} unique displayed probability values across pool`);
  }
  if (band68to70 / Math.max(probabilities.length, 1) >= 0.5) {
    notes.push(`${band68to70} props (${Math.round((band68to70 / probabilities.length) * 100)}%) cluster in 68-70% band`);
  }

  return {
    exact70Count: exact70,
    band68to70Count: band68to70,
    uniqueDisplayedValues: uniqueDisplayed,
    researchCapHits,
    statSpecificHigherCount: statHigher,
    verifiedWouldScoreHigherCount: verifiedWouldScoreHigher,
    roundingApplied: true,
    notes,
  };
}

export function buildProbabilityDistributionAudit(pool = [], topPool = pool) {
  const projectedProbabilities = pool
    .map(resolveDisplayedProbability)
    .filter((value) => Number.isFinite(value));
  const topProbabilities = topPool
    .map(resolveDisplayedProbability)
    .filter((value) => Number.isFinite(value));

  const projected = summarizeProbabilities(projectedProbabilities);
  const top20 = summarizeProbabilities(topProbabilities);

  return {
    projected: {
      ...projected,
      histogram: buildProbabilityHistogram(projectedProbabilities),
    },
    top20: {
      ...top20,
      histogram: buildProbabilityHistogram(topProbabilities),
    },
    compressionAudit: buildCompressionAudit(pool, projectedProbabilities),
  };
}
