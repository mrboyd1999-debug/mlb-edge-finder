/**
 * Projection sanity audit — history alignment, mismatch detection, Tier A gates.
 */

import { canonicalMarketKey } from "./marketNormalization.js";
import {
  resolveProjectionValue,
  resolveProjectionSourceLabel,
  resolveProjectionQuality,
  PROJECTION_QUALITY,
} from "./projectionQuality.js";
import { resolveCalibrationHitRates } from "./probabilityCalibration.js";
import { formatNumber } from "./formatters.js";
import {
  MAX_SANITY_WITHOUT_HISTORY,
  TIER_A_MIN_SANITY_SCORE,
  resolveHistoricalDataPresent,
  resolveHitRateValidationPresent,
} from "./tierHistoricalValidation.js";
import { classifyVerifiedTier, enforceVerifiedTierFields } from "./verifiedTierSystem.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function pctWeight(weight) {
  if (weight == null || !Number.isFinite(Number(weight))) return null;
  return Math.round(Number(weight) * 100);
}

export const PROJECTION_OUTLIER_FLAG = "PROJECTION OUTLIER";
export const PROJECTION_MISMATCH_FLAG = "ProjectionMismatch";
export const PROJECTION_OUTLIER_WARNING = "⚠ Projection Outlier";
export { TIER_A_MIN_SANITY_SCORE } from "./tierHistoricalValidation.js";
export const PROBABILITY_MISMATCH_THRESHOLD = 20;

/** Market-specific absolute drift limits. */
export const MARKET_SANITY_RULES = {
  hitsAllowed: {
    label: "Hits Allowed",
    seasonOutlierPct: 0.25,
    last10OutlierPct: 0.25,
    maxAbsolute: 12,
  },
  earnedRuns: {
    label: "Earned Runs Allowed",
    seasonOutlierPct: 0.25,
    last10OutlierPct: 0.25,
    maxAbsolute: 8,
  },
  strikeouts: {
    label: "Strikeouts",
    seasonOutlierPct: 0.3,
    last10OutlierPct: 0.3,
    maxAbsolute: 15,
  },
  outs: {
    label: "Pitching Outs",
    seasonOutlierPct: 0.25,
    last10OutlierPct: 0.25,
    maxAbsolute: 21,
  },
  hits: {
    label: "Hits",
    seasonOutlierPct: 0.35,
    last10OutlierPct: 0.35,
    maxAbsolute: 4,
  },
  totalBases: {
    label: "Total Bases",
    seasonOutlierPct: 0.35,
    last10OutlierPct: 0.35,
    maxAbsolute: 8,
  },
};

const DEFAULT_SOURCE_WEIGHTS = {
  hitsAllowed: { recentForm: 0.45, season: 0.3, opponent: 0.15, matchup: 0.1 },
  earnedRuns: { recentForm: 0.35, season: 0.3, opponent: 0.2, matchup: 0.15 },
  strikeouts: { recentForm: 0.35, season: 0.25, opponent: 0.25, matchup: 0.15 },
  outs: { recentForm: 0.35, season: 0.3, opponent: 0.2, matchup: 0.15 },
};

function resolveMarketKey(prop = {}) {
  return canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
}

function breakdownWeight(prop = {}, labelPattern) {
  const rows = Array.isArray(prop.projectionBreakdown) ? prop.projectionBreakdown : [];
  const row = rows.find((item) => labelPattern.test(String(item?.label || "")));
  return row?.weight != null ? Number(row.weight) : null;
}

function resolveHistoricalAverages(prop = {}) {
  const inputs = prop.pitcherInputs || {};
  const breakdown = prop.projectionBreakdown || [];
  const last5Row = breakdown.find((r) => /last\s*5/i.test(String(r.label || "")));
  const seasonRow = breakdown.find((r) => /season/i.test(String(r.label || "")));
  const last10Row = breakdown.find((r) => /last\s*10/i.test(String(r.label || "")));

  return {
    last5: finite(prop.last5Average) ?? finite(inputs.last5Average) ?? finite(last5Row?.value),
    last10: finite(prop.last10Average) ?? finite(inputs.last10Average) ?? finite(last10Row?.value),
    season: finite(prop.seasonAverage) ?? finite(inputs.seasonAverage) ?? finite(seasonRow?.value),
  };
}

function resolveSourceWeightPercents(prop = {}, marketKey = "") {
  const defaults = DEFAULT_SOURCE_WEIGHTS[marketKey] || { recentForm: 0.35, season: 0.3, opponent: 0.2, matchup: 0.15 };
  const last5Weight = breakdownWeight(prop, /last\s*5|recent\s*form/i);
  const last10Weight = breakdownWeight(prop, /last\s*10/i);
  const recentForm =
    last5Weight != null || last10Weight != null
      ? (last5Weight ?? 0) + (last10Weight ?? 0)
      : defaults.recentForm;
  const season = breakdownWeight(prop, /season/i) ?? defaults.season;
  const opponent = breakdownWeight(prop, /opponent/i) ?? defaults.opponent;
  const matchup =
    breakdownWeight(prop, /innings|matchup|workload|pitch\s*count/i) ?? defaults.matchup;

  return {
    recentFormPct: pctWeight(recentForm),
    seasonPct: pctWeight(season),
    opponentPct: pctWeight(opponent),
    matchupPct: pctWeight(matchup),
  };
}

function resolveProjectionSourceWeight(prop = {}) {
  const quality = resolveProjectionQuality(prop);
  if (quality === PROJECTION_QUALITY.VERIFIED) return 95;
  if (quality === PROJECTION_QUALITY.ESTIMATED) return 72;
  return 35;
}

function deviationPct(projection, baseline) {
  if (projection == null || baseline == null || baseline <= 0) return null;
  return (projection - baseline) / baseline;
}

function estimateHitRateFromAverage(avg, line) {
  const baseline = finite(avg);
  const ln = finite(line);
  if (baseline == null || ln == null || ln <= 0) return null;
  const gap = (baseline - ln) / ln;
  return clamp(round1(50 + gap * 38), 15, 92);
}

function resolveRecommendedSide(prop = {}, projection = null, line = null) {
  const side = String(prop.recommendedSide || prop.bestPick || prop.side || prop.pick || "").toUpperCase();
  if (side === "OVER" || side === "MORE" || side === "HIGHER") return "OVER";
  if (side === "UNDER" || side === "LESS" || side === "LOWER") return "UNDER";
  if (projection != null && line != null) return projection >= line ? "OVER" : "UNDER";
  return "OVER";
}

function resolveSideHitRate(overRate, side = "OVER") {
  if (overRate == null) return null;
  if (side === "UNDER") return round1(100 - overRate);
  return round1(overRate);
}

function resolveOverRates(prop = {}, line = null, side = "OVER") {
  const rates = resolveCalibrationHitRates(prop, line);
  return {
    recentOverRate: resolveSideHitRate(rates.last10HitRate, side),
    seasonOverRate: resolveSideHitRate(rates.seasonHitRate, side),
    last5OverRate: resolveSideHitRate(rates.last5HitRate, side),
    rawLast10OverRate: rates.last10HitRate,
    rawSeasonOverRate: rates.seasonHitRate,
  };
}

function resolveProjectionProbability(prop = {}, projection = null, line = null, side = "OVER") {
  const overProb =
    estimateHitRateFromAverage(projection, line) ??
    finite(prop.probabilityScore ?? prop.verifiedProbability);
  if (overProb == null) return null;
  return side === "UNDER" ? round1(100 - overProb) : round1(overProb);
}

function computeAgreementSanityScore(projectionProbability, recentOverRate, seasonOverRate) {
  if (projectionProbability == null) return null;
  const diffs = [];
  if (recentOverRate != null) diffs.push(Math.abs(projectionProbability - recentOverRate));
  if (seasonOverRate != null) diffs.push(Math.abs(projectionProbability - seasonOverRate));
  if (!diffs.length) return 85;
  const avgDiff = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  return clamp(Math.round(100 - avgDiff * 2), 0, 100);
}

function hasProjectionMismatch(projectionProbability, recentOverRate, seasonOverRate) {
  if (projectionProbability == null) return false;
  if (recentOverRate != null && Math.abs(projectionProbability - recentOverRate) > PROBABILITY_MISMATCH_THRESHOLD) {
    return true;
  }
  if (seasonOverRate != null && Math.abs(projectionProbability - seasonOverRate) > PROBABILITY_MISMATCH_THRESHOLD) {
    return true;
  }
  return false;
}

function computeAverageDriftScore({ projection, line, last5, last10, season, rule, flags = [] }) {
  let score = 100;
  if (projection == null) return 0;

  if (rule?.maxAbsolute != null && projection > rule.maxAbsolute) {
    score -= 35;
    flags.push(`Above market max (${rule.maxAbsolute})`);
  }

  const seasonDev = deviationPct(projection, season);
  if (seasonDev != null) {
    if (seasonDev > 0.5) score -= 40;
    else if (seasonDev > 0.35) score -= 28;
    else if (seasonDev > 0.25) score -= 18;
    else if (seasonDev > 0.15) score -= 8;
    else if (seasonDev < -0.35) score -= 12;
  } else {
    score -= 8;
  }

  const last10Dev = deviationPct(projection, last10);
  if (last10Dev != null && last10Dev > 0.25) score -= 14;
  else if (last10Dev != null && last10Dev > 0.15) score -= 6;

  const last5Dev = deviationPct(projection, last5);
  if (last5Dev != null && last5Dev > 0.25) score -= 8;

  if (line != null && line > 0) {
    const lineGap = Math.abs(projection - line) / line;
    if (lineGap > 0.75) score -= 8;
  }

  return clamp(Math.round(score), 0, 100);
}

function resolveAverageOutlier({ projection, last10, season, rule }) {
  if (projection == null) return false;
  const seasonDev = deviationPct(projection, season);
  const last10Dev = deviationPct(projection, last10);
  const seasonThreshold = rule?.seasonOutlierPct ?? 0.25;
  const last10Threshold = rule?.last10OutlierPct ?? 0.25;

  if (seasonDev != null && seasonDev > seasonThreshold) return true;
  if (last10Dev != null && last10Dev > last10Threshold) return true;
  return false;
}

function confidencePenaltyFromAudit(audit = {}) {
  let penalty = 0;
  if (audit.projectionMismatch) penalty += 20;
  if (audit.isOutlier) penalty += 12;
  if (audit.sanityScore != null && audit.sanityScore < TIER_A_MIN_SANITY_SCORE) penalty += 8;

  if (penalty > 0) return clamp(penalty, 0, 32);

  if (audit.sanityScore >= 85) return 0;
  if (audit.sanityScore >= 75) return 4;
  if (audit.sanityScore >= 65) return 8;
  return 12;
}

function playabilityPenaltyFromAudit(audit = {}) {
  if (audit.projectionMismatch) return 20;
  if (audit.isOutlier) return 15;
  if (audit.sanityScore != null && audit.sanityScore < TIER_A_MIN_SANITY_SCORE) return 12;
  if (audit.sanityScore != null && audit.sanityScore < 80) return 6;
  return 0;
}

function formatPctLabel(value) {
  return value != null ? `${Math.round(Number(value))}%` : "—";
}

export function buildProjectionSanityAudit(prop = {}) {
  const marketKey = resolveMarketKey(prop);
  const rule = MARKET_SANITY_RULES[marketKey] || null;
  const projection = resolveProjectionValue(prop);
  const line = finite(prop.line);
  const supported = projection != null && line != null && line > 0;
  const { last5, last10, season } = resolveHistoricalAverages(prop);
  const sourceWeights = resolveSourceWeightPercents(prop, marketKey);
  const projectionSourceWeight = resolveProjectionSourceWeight(prop);
  const projectionSourceLabel = resolveProjectionSourceLabel(prop);
  const recommendedSide = resolveRecommendedSide(prop, projection, line);
  const overRates = supported ? resolveOverRates(prop, line, recommendedSide) : {};
  const historical = resolveHistoricalDataPresent(prop);
  const hitRateValidation = resolveHitRateValidationPresent(prop);
  const projectionProbability = supported
    ? resolveProjectionProbability(prop, projection, line, recommendedSide)
    : null;

  if (!supported) {
    return {
      marketKey,
      marketLabel: rule?.label || marketKey || "Unknown",
      supported: false,
      last5Average: last5,
      last10Average: last10,
      seasonAverage: season,
      projection,
      line,
      last5Label: last5 != null ? formatNumber(last5) : "—",
      last10Label: last10 != null ? formatNumber(last10) : "—",
      seasonLabel: season != null ? formatNumber(season) : "—",
      projectionLabel: projection != null ? formatNumber(projection) : "—",
      lineLabel: line != null ? formatNumber(line) : "—",
      recentOverRate: null,
      seasonOverRate: null,
      projectionProbability: null,
      recentOverRateLabel: "—",
      seasonOverRateLabel: "—",
      projectionProbabilityLabel: "—",
      projectionMismatch: false,
      mismatchFlags: [],
      isOutlier: false,
      outlierFlags: [],
      outlierWarning: "",
      sanityScore: null,
      blocksTierA: true,
      confidencePenalty: 0,
      playabilityPenalty: 0,
      projectionSourceWeight,
      projectionSourceLabel,
      recommendedSide,
      ...sourceWeights,
      summary: "Projection or line unavailable for validation.",
    };
  }

  const scoreFlags = [];
  const agreementScore = computeAgreementSanityScore(
    projectionProbability,
    overRates.recentOverRate,
    overRates.seasonOverRate
  );
  const averageDriftScore = computeAverageDriftScore({
    projection,
    line,
    last5,
    last10,
    season,
    rule,
    flags: scoreFlags,
  });
  let sanityScore =
    agreementScore != null
      ? clamp(Math.round(agreementScore * 0.7 + averageDriftScore * 0.3), 0, 100)
      : averageDriftScore;

  if (!historical.present) {
    sanityScore = Math.min(sanityScore, MAX_SANITY_WITHOUT_HISTORY);
  }

  const projectionMismatch = hasProjectionMismatch(
    projectionProbability,
    overRates.recentOverRate,
    overRates.seasonOverRate
  );
  const isAverageOutlier = resolveAverageOutlier({ projection, last10, season, rule });
  const isOutlier = isAverageOutlier || projectionMismatch;
  const mismatchFlags = projectionMismatch ? [PROJECTION_MISMATCH_FLAG] : [];
  const outlierFlags = [];
  if (isAverageOutlier) outlierFlags.push(PROJECTION_OUTLIER_WARNING);
  if (projectionMismatch && !outlierFlags.length) outlierFlags.push(PROJECTION_MISMATCH_FLAG);

  const seasonDeviationPct = deviationPct(projection, season);
  const last10DeviationPct = deviationPct(projection, last10);
  const blocksTierA =
    !historical.present ||
    !hitRateValidation.present ||
    sanityScore < TIER_A_MIN_SANITY_SCORE ||
    isOutlier ||
    projectionMismatch;

  const audit = {
    marketKey,
    marketLabel: rule?.label || marketKey || "Prop",
    supported: true,
    historicalDataPresent: historical.present,
    historicalMissing: historical.missingLabels,
    hitRateValidated: hitRateValidation.present,
    hitRateMissing: hitRateValidation.missingLabels,
    last5Average: last5,
    last10Average: last10,
    seasonAverage: season,
    projection,
    line,
    last5Label: last5 != null ? formatNumber(last5) : "—",
    last10Label: last10 != null ? formatNumber(last10) : "—",
    seasonLabel: season != null ? formatNumber(season) : "—",
    projectionLabel: formatNumber(projection),
    lineLabel: formatNumber(line),
    recentOverRate: overRates.recentOverRate,
    seasonOverRate: overRates.seasonOverRate,
    last5OverRate: overRates.last5OverRate,
    projectionProbability,
    recentOverRateLabel: formatPctLabel(overRates.recentOverRate),
    seasonOverRateLabel: formatPctLabel(overRates.seasonOverRate),
    projectionProbabilityLabel: formatPctLabel(projectionProbability),
    recentOverRateGap:
      projectionProbability != null && overRates.recentOverRate != null
        ? round1(Math.abs(projectionProbability - overRates.recentOverRate))
        : null,
    seasonOverRateGap:
      projectionProbability != null && overRates.seasonOverRate != null
        ? round1(Math.abs(projectionProbability - overRates.seasonOverRate))
        : null,
    projectionMismatch,
    mismatchFlags,
    seasonDeviationPct: seasonDeviationPct != null ? round1(seasonDeviationPct * 100) : null,
    last10DeviationPct: last10DeviationPct != null ? round1(last10DeviationPct * 100) : null,
    isOutlier,
    isAverageOutlier,
    outlierFlags,
    outlierWarning: isAverageOutlier ? PROJECTION_OUTLIER_WARNING : "",
    sanityScore,
    agreementScore,
    averageDriftScore,
    blocksTierA,
    recommendedSide,
    projectionSourceWeight,
    projectionSourceLabel,
    ...sourceWeights,
    scoreFlags,
  };

  audit.confidencePenalty = confidencePenaltyFromAudit(audit);
  audit.playabilityPenalty = playabilityPenaltyFromAudit(audit);

  if (projectionMismatch) {
    audit.summary = `${PROJECTION_MISMATCH_FLAG}: projection probability ${audit.projectionProbabilityLabel} vs recent ${audit.recentOverRateLabel} / season ${audit.seasonOverRateLabel}`;
  } else if (isAverageOutlier) {
    audit.summary = `${PROJECTION_OUTLIER_WARNING}: projection ${audit.projectionLabel} vs season ${audit.seasonLabel}${
      audit.seasonDeviationPct != null ? ` (+${audit.seasonDeviationPct}%)` : ""
    }`;
  } else if (sanityScore < TIER_A_MIN_SANITY_SCORE) {
    audit.summary = `Projection drift flagged — sanity score ${sanityScore}/100 (Tier A needs ≥${TIER_A_MIN_SANITY_SCORE})`;
  } else {
    audit.summary = `Projection aligned with history — sanity score ${sanityScore}/100`;
  }

  return audit;
}

export function applySanityConfidencePenalty(confidence, audit = {}) {
  const base = finite(confidence);
  if (base == null) return confidence;
  const penalty = finite(audit.confidencePenalty) ?? 0;
  if (penalty <= 0) return Math.round(base);
  return clamp(Math.round(base - penalty), 28, 100);
}

export function applySanityPlayabilityPenalty(playability, audit = {}) {
  const base = finite(playability);
  if (base == null) return playability;
  const penalty = finite(audit.playabilityPenalty) ?? 0;
  if (penalty <= 0) return Math.round(base);
  return clamp(Math.round(base - penalty), 0, 100);
}

export function demoteTierForProjectionSanity(tier, audit = {}) {
  if (!tier || tier !== "A") return tier;
  if (audit.blocksTierA || (audit.sanityScore != null && audit.sanityScore < TIER_A_MIN_SANITY_SCORE)) {
    return "B";
  }
  return tier;
}

export function passesTierASanityGate(audit = {}) {
  if (!audit.supported) return false;
  return !audit.blocksTierA && (audit.sanityScore ?? 0) >= TIER_A_MIN_SANITY_SCORE;
}

export function attachProjectionSanityAudit(prop = {}, options = {}) {
  const audit = options.audit || buildProjectionSanityAudit(prop);
  const rawConfidence =
    options.confidence ??
    prop.displayConfidenceScore ??
    prop.confidenceScore ??
    prop.confidence;
  const rawPlayability = options.playability ?? prop.playabilityScore;
  const adjustedConfidence = applySanityConfidencePenalty(rawConfidence, audit);
  const adjustedPlayability = applySanityPlayabilityPenalty(rawPlayability, audit);

  const merged = {
    ...prop,
    projectionSanityAudit: audit,
    projectionSanityScore: audit.sanityScore,
    projectionMismatch: audit.projectionMismatch,
    projectionMismatchFlag: audit.projectionMismatch ? PROJECTION_MISMATCH_FLAG : "",
    projectionOutlier: audit.isOutlier,
    projectionOutlierFlag: audit.outlierWarning || audit.outlierFlags?.[0] || "",
    historicalDataPresent: audit.historicalDataPresent ?? false,
    displayConfidenceScore: adjustedConfidence,
    confidenceScore: adjustedConfidence,
    confidence: adjustedConfidence,
    playabilityScore: adjustedPlayability,
  };
  return enforceVerifiedTierFields(merged);
}
