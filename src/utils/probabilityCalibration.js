/**
 * Probability calibration — edge-driven blend capped at realistic MLB hit rates.
 */

export const CALIBRATION_MIN_PROBABILITY = 50;
export const CALIBRATION_MAX_VERIFIED = 95;
export const CALIBRATION_MAX_RESEARCH = 95;

export const CALIBRATION_HISTOGRAM_BUCKETS = [
  { id: "50-55", label: "50-55%", min: 50, max: 55 },
  { id: "55-60", label: "55-60%", min: 55, max: 60 },
  { id: "60-65", label: "60-65%", min: 60, max: 65 },
  { id: "65-70", label: "65-70%", min: 65, max: 70 },
  { id: "70-75", label: "70-75%", min: 70, max: 75 },
  { id: "75-80", label: "75-80%", min: 75, max: 80 },
  { id: "80-85", label: "80-85%", min: 80, max: 85 },
  { id: "85-90", label: "85-90%", min: 85, max: 90 },
  { id: "90-95", label: "90-95%", min: 90, max: 95 },
];

const PROBABILITY_WEIGHTS = {
  recent: 0.4,
  season: 0.2,
  confidence: 0.25,
  playability: 0.15,
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHitRatePercent(value) {
  const num = finite(value);
  if (num == null) return null;
  if (num <= 1) return round1(num * 100);
  return round1(num);
}

function estimateHitRateFromAverage(avg, line) {
  const baseline = finite(avg);
  const ln = finite(line);
  if (baseline == null || ln == null || ln <= 0) return null;
  const gap = (baseline - ln) / ln;
  return clamp(round1(50 + gap * 38), 15, 92);
}

export function resolveCalibrationHitRates(prop = {}, line = null) {
  const ln = finite(line ?? prop.line);
  const last5 =
    normalizeHitRatePercent(prop.last5HitRate) ??
    estimateHitRateFromAverage(prop.last5Average ?? prop.recentForm, ln);
  const last10 =
    normalizeHitRatePercent(prop.last10HitRate) ??
    normalizeHitRatePercent(prop.recentHitRate) ??
    estimateHitRateFromAverage(prop.last10Average, ln);
  const season =
    normalizeHitRatePercent(prop.seasonHitRate) ??
    normalizeHitRatePercent(prop.historicalHitRate) ??
    estimateHitRateFromAverage(prop.seasonAverage, ln);

  return {
    last5HitRate: last5,
    last10HitRate: last10,
    seasonHitRate: season,
    last5Label: last5 != null ? `${last5}%` : "—",
    last10Label: last10 != null ? `${last10}%` : "—",
    seasonLabel: season != null ? `${season}%` : "—",
  };
}


function resolveProjectionValue(prop = {}) {
  const proj = finite(prop.projection ?? prop.projectedValue);
  if (proj == null || proj <= 0) return null;
  return proj;
}

function hasMissingMatchupData(prop = {}) {
  if (prop.matchupConfidence === "LOW") return false;
  return !prop.matchupNote && !prop.handednessMatchup && !String(prop.opponent || "").trim();
}

function isLowMatchupProp(prop = {}) {
  if (prop.matchupConfidence === "HIGH" || prop.matchupConfidence === "MEDIUM" || prop.matchupConfidence === "FORM") {
    return false;
  }
  if (prop.formBaseline != null || prop.formConfidenceScore != null) return false;
  if (prop.matchupNote || prop.handednessMatchup) return false;
  return prop.matchupConfidence === "LOW" || (!prop.matchupNote && !prop.handednessMatchup);
}

function hasMissingOpponentData(prop = {}) {
  const opponent = String(prop.opponent || "").trim();
  return (
    !opponent &&
    prop.opponentRank == null &&
    prop.opponentAllowed == null &&
    !prop.opponentContext
  );
}

export function computeMatchupAdjustment(prop = {}) {
  let adj = 0;

  const matchupScore = finite(prop.matchupScore ?? prop.matchupAudit?.matchupScore);
  if (matchupScore != null) adj += (matchupScore - 50) * 0.16;

  const rank = finite(prop.opponentRank);
  if (rank != null) {
    if (rank >= 24) adj += 6;
    else if (rank >= 20) adj += 2.5;
    else if (rank <= 8) adj -= 5;
    else if (rank <= 12) adj -= 2;
  } else if (hasMissingOpponentData(prop)) {
    adj -= 4;
  } else if (String(prop.opponent || "").trim()) {
    adj += 1.5;
  }

  const confidence = String(prop.matchupConfidence || "").toUpperCase();
  if (confidence === "HIGH") adj += 3;
  else if (confidence === "MEDIUM" || confidence === "FORM") adj += 1;
  else if (isLowMatchupProp(prop)) adj -= 5;
  else if (hasMissingMatchupData(prop)) adj -= 7;

  const form = finite(prop.formConfidenceScore);
  if (form != null) adj += (form - 50) * 0.07;

  const note = String(prop.matchupNote || prop.handednessMatchup || "").toLowerCase();
  if (/favorable|boost|plus|weak pitching|short porch|wind out/i.test(note)) adj += 2;
  if (/tough|suppress|elite|deGrom|skubal/i.test(note)) adj -= 2;

  return round1(clamp(adj, -14, 16));
}

function resolveProbabilityConfidence(prop = {}, options = {}) {
  return (
    finite(options.confidence) ??
    finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence) ??
    50
  );
}

function resolveProbabilityPlayability(prop = {}, options = {}) {
  return (
    finite(options.playability) ??
    finite(prop.playabilityScore ?? prop.playabilityBreakdown?.finalPlayability) ??
    resolveProbabilityConfidence(prop, options)
  );
}

export function computeCalibratedProbability(prop = {}, metrics = {}, options = {}) {
  const projection = finite(metrics.projection ?? resolveProjectionValue(prop));
  const line = finite(prop.line);
  if (projection == null || line == null || line <= 0) return null;

  const confidence = resolveProbabilityConfidence(prop, options);
  const playability = resolveProbabilityPlayability(prop, options);
  const hitRates = resolveCalibrationHitRates(prop, line);
  const recentHitRate = hitRates.last10HitRate ?? hitRates.last5HitRate ?? confidence;
  const seasonHitRate = hitRates.seasonHitRate ?? recentHitRate;

  const recentContribution = round2(recentHitRate * PROBABILITY_WEIGHTS.recent);
  const seasonContribution = round2(seasonHitRate * PROBABILITY_WEIGHTS.season);
  const confidenceContribution = round2(confidence * PROBABILITY_WEIGHTS.confidence);
  const playabilityContribution = round2(playability * PROBABILITY_WEIGHTS.playability);
  const base = round2(
    recentContribution + seasonContribution + confidenceContribution + playabilityContribution
  );
  const edgeBonus = round1(Math.abs(projection - line) * 8);

  const verified = Boolean(options.verified);
  const ceiling = verified ? CALIBRATION_MAX_VERIFIED : CALIBRATION_MAX_RESEARCH;
  const probability = clamp(round2(base + edgeBonus), CALIBRATION_MIN_PROBABILITY, ceiling);

  const inputs = {
    recentHitRate: `${round1(recentHitRate)}%`,
    seasonHitRate: `${round1(seasonHitRate)}%`,
    confidence: `${round1(confidence)}%`,
    playability: `${round1(playability)}%`,
    edgeBonus: `+${round1(edgeBonus)}`,
    finalProbability: `${round1(probability)}%`,
    last5HitRate: hitRates.last5Label,
    last10HitRate: hitRates.last10Label,
    seasonHitRate: hitRates.seasonLabel,
    recentContribution,
    last10Contribution: recentContribution,
    seasonContribution,
    confidenceContribution,
    playabilityContribution,
    edgeContribution: edgeBonus,
    projectionVsLine:
      projection != null && line != null
        ? `${round1(projection - line) > 0 ? "+" : ""}${round1(projection - line)}`
        : "—",
  };

  return {
    probability,
    inputs,
    hitRates,
    breakdown: {
      base,
      recentHitRate,
      seasonHitRate,
      confidence,
      playability,
      recentContribution,
      last10Contribution: recentContribution,
      seasonContribution,
      confidenceContribution,
      playabilityContribution,
      edgeBonus,
      edgeContribution: edgeBonus,
      rawTotal: probability,
      ceiling,
      blendWeights: PROBABILITY_WEIGHTS,
    },
  };
}

export function assignCalibratedProbabilityBucket(probability) {
  const prob = finite(probability);
  if (prob == null) return null;
  if (prob >= 90) return "90-95";
  if (prob >= 85) return "85-90";
  if (prob >= 80) return "80-85";
  if (prob >= 75) return "75-80";
  if (prob >= 70) return "70-75";
  if (prob >= 65) return "65-70";
  if (prob >= 60) return "60-65";
  if (prob >= 55) return "55-60";
  if (prob >= 50) return "50-55";
  return "below-50";
}

export function buildCalibratedProbabilityHistogram(probabilities = []) {
  const counts = CALIBRATION_HISTOGRAM_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.id] = 0;
    return acc;
  }, {});

  for (const value of probabilities) {
    const bucket = assignCalibratedProbabilityBucket(value);
    if (bucket && counts[bucket] != null) counts[bucket] += 1;
  }

  return CALIBRATION_HISTOGRAM_BUCKETS.map((bucket) => ({
    ...bucket,
    count: counts[bucket.id] ?? 0,
  }));
}

export function summarizeCalibrationInputs(pool = []) {
  const rows = (pool || [])
    .map((prop) => prop.probabilityCalibration?.inputs || prop.probabilityAudit)
    .filter(Boolean);
  if (!rows.length) {
    return {
      count: 0,
      last5HitRate: "—",
      last10HitRate: "—",
      seasonHitRate: "—",
      edgeContribution: "—",
      matchupAdjustment: "—",
    };
  }

  const numeric = (values) => {
    const nums = values.filter((value) => Number.isFinite(value));
    if (!nums.length) return null;
    return round1(nums.reduce((sum, value) => sum + value, 0) / nums.length);
  };

  return {
    count: rows.length,
    last5HitRate: numeric(rows.map((row) => row.recentContribution ?? row.last5Contribution)) ?? "—",
    last10HitRate: numeric(rows.map((row) => row.last10Contribution)) ?? "—",
    seasonHitRate: numeric(rows.map((row) => row.seasonContribution)) ?? "—",
    edgeContribution: numeric(rows.map((row) => row.edgeContribution)) ?? "—",
    matchupAdjustment:
      numeric(rows.map((row) => row.matchupAdjustmentValue ?? row.matchupAdjustment)) ?? "—",
  };
}

// Legacy exports used by older edge contribution audit paths.
export function computeEdgeContribution(edge, edgePercent, hitRates = {}, lean = "pass") {
  void edge;
  void hitRates;
  void lean;
  const pct = finite(edgePercent);
  if (pct == null) return 0;
  return round1(Math.abs(pct) * 0.08);
}
