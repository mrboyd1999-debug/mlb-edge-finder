/**
 * Projection sanity audit — market limits, outlier detection, confidence penalties.
 */

import { canonicalMarketKey } from "./marketNormalization.js";
import { resolveProjectionValue, resolveProjectionSourceLabel, resolveProjectionQuality, PROJECTION_QUALITY } from "./projectionQuality.js";
import { formatNumber } from "./formatters.js";

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

/** Market-specific outlier thresholds (fraction above season avg). */
export const MARKET_SANITY_RULES = {
  hitsAllowed: {
    label: "Hits Allowed",
    seasonOutlierPct: 0.25,
    last5OutlierPct: 0.35,
    last10OutlierPct: 0.3,
    maxAbsolute: 12,
  },
  earnedRuns: {
    label: "Earned Runs Allowed",
    seasonOutlierPct: 0.25,
    last5OutlierPct: 0.35,
    last10OutlierPct: 0.3,
    maxAbsolute: 8,
  },
  strikeouts: {
    label: "Strikeouts",
    seasonOutlierPct: 0.3,
    last5OutlierPct: 0.4,
    last10OutlierPct: 0.35,
    maxAbsolute: 15,
  },
  outs: {
    label: "Pitching Outs",
    seasonOutlierPct: 0.25,
    last5OutlierPct: 0.3,
    last10OutlierPct: 0.28,
    maxAbsolute: 21,
  },
  hits: {
    label: "Hits",
    seasonOutlierPct: 0.35,
    last5OutlierPct: 0.4,
    last10OutlierPct: 0.35,
    maxAbsolute: 4,
  },
  totalBases: {
    label: "Total Bases",
    seasonOutlierPct: 0.35,
    last5OutlierPct: 0.4,
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

export const PROJECTION_OUTLIER_FLAG = "PROJECTION OUTLIER";

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

function computeSanityScore({ projection, line, last5, last10, season, rule, flags = [] }) {
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
    score -= 10;
  }

  const last5Dev = deviationPct(projection, last5);
  if (last5Dev != null && last5Dev > 0.35) score -= 12;
  else if (last5Dev != null && last5Dev > 0.25) score -= 6;

  const last10Dev = deviationPct(projection, last10);
  if (last10Dev != null && last10Dev > 0.3) score -= 8;

  if (line != null && line > 0) {
    const lineGap = Math.abs(projection - line) / line;
    if (lineGap > 0.75) score -= 10;
  }

  return clamp(Math.round(score), 0, 100);
}

function resolveOutlierFlags({ projection, last5, last10, season, rule }) {
  const flags = [];
  if (!rule || projection == null) return flags;

  const seasonDev = deviationPct(projection, season);
  if (seasonDev != null && seasonDev > (rule.seasonOutlierPct ?? 0.25)) {
    flags.push(PROJECTION_OUTLIER_FLAG);
  }

  const last5Dev = deviationPct(projection, last5);
  if (
    last5Dev != null &&
    last5Dev > (rule.last5OutlierPct ?? 0.35) &&
    !flags.includes(PROJECTION_OUTLIER_FLAG)
  ) {
    flags.push(PROJECTION_OUTLIER_FLAG);
  }

  const last10Dev = deviationPct(projection, last10);
  if (
    last10Dev != null &&
    last10Dev > (rule.last10OutlierPct ?? 0.3) &&
    !flags.includes(PROJECTION_OUTLIER_FLAG)
  ) {
    flags.push(PROJECTION_OUTLIER_FLAG);
  }

  return flags;
}

function confidencePenaltyFromAudit(audit = {}) {
  if (!audit.isOutlier) {
    if (audit.sanityScore >= 80) return 0;
    if (audit.sanityScore >= 65) return 4;
    if (audit.sanityScore >= 55) return 8;
    return 12;
  }

  const seasonDev = audit.seasonDeviationPct;
  if (seasonDev != null && seasonDev > 0.5) return 28;
  if (seasonDev != null && seasonDev > 0.35) return 22;
  if (seasonDev != null && seasonDev > 0.25) return 18;
  return 15;
}

export function buildProjectionSanityAudit(prop = {}) {
  const marketKey = resolveMarketKey(prop);
  const rule = MARKET_SANITY_RULES[marketKey] || null;
  const projection = resolveProjectionValue(prop);
  const line = finite(prop.line);
  const { last5, last10, season } = resolveHistoricalAverages(prop);
  const sourceWeights = resolveSourceWeightPercents(prop, marketKey);
  const projectionSourceWeight = resolveProjectionSourceWeight(prop);
  const projectionSourceLabel = resolveProjectionSourceLabel(prop);

  if (!rule || projection == null) {
    return {
      marketKey,
      marketLabel: rule?.label || marketKey || "Unknown",
      supported: Boolean(rule),
      last5Average: last5,
      last10Average: last10,
      seasonAverage: season,
      projection,
      line,
      last5Label: last5 != null ? formatNumber(last5) : "—",
      last10Label: last10 != null ? formatNumber(last10) : "—",
      seasonLabel: season != null ? formatNumber(season) : "—",
      projectionLabel: formatNumber(projection),
      lineLabel: line != null ? formatNumber(line) : "—",
      seasonDeviationPct: deviationPct(projection, season),
      isOutlier: false,
      outlierFlags: [],
      sanityScore: rule && projection != null ? 85 : null,
      blocksTierA: false,
      confidencePenalty: 0,
      projectionSourceWeight,
      projectionSourceLabel,
      ...sourceWeights,
      summary: rule ? "" : "No sanity rules for this market.",
    };
  }

  const scoreFlags = [];
  const outlierFlags = resolveOutlierFlags({ projection, last5, last10, season, rule });
  const sanityScore = computeSanityScore({
    projection,
    line,
    last5,
    last10,
    season,
    rule,
    flags: scoreFlags,
  });
  const seasonDeviationPct = deviationPct(projection, season);
  const isOutlier = outlierFlags.includes(PROJECTION_OUTLIER_FLAG);
  const audit = {
    marketKey,
    marketLabel: rule.label,
    supported: true,
    last5Average: last5,
    last10Average: last10,
    seasonAverage: season,
    projection,
    line,
    last5Label: last5 != null ? formatNumber(last5) : "—",
    last10Label: last10 != null ? formatNumber(last10) : "—",
    seasonLabel: season != null ? formatNumber(season) : "—",
    projectionLabel: formatNumber(projection),
    lineLabel: line != null ? formatNumber(line) : "—",
    seasonDeviationPct: seasonDeviationPct != null ? round1(seasonDeviationPct * 100) : null,
    isOutlier,
    outlierFlags,
    sanityScore,
    blocksTierA: isOutlier || sanityScore < 55,
    projectionSourceWeight,
    projectionSourceLabel,
    ...sourceWeights,
    scoreFlags,
  };
  audit.confidencePenalty = confidencePenaltyFromAudit(audit);
  audit.summary = isOutlier
    ? `${PROJECTION_OUTLIER_FLAG}: projection ${audit.projectionLabel} vs season ${audit.seasonLabel}${
        seasonDeviationPct != null ? ` (+${audit.seasonDeviationPct}%)` : ""
      }`
    : sanityScore < 70
      ? `Projection drift flagged — sanity score ${sanityScore}/100`
      : `Projection aligned with recent form — sanity score ${sanityScore}/100`;
  return audit;
}

export function applySanityConfidencePenalty(confidence, audit = {}) {
  const base = finite(confidence);
  if (base == null) return confidence;
  const penalty = finite(audit.confidencePenalty) ?? 0;
  if (penalty <= 0) return Math.round(base);
  return clamp(Math.round(base - penalty), 28, 100);
}

export function demoteTierForProjectionSanity(tier, audit = {}) {
  if (!tier || !audit.blocksTierA || tier !== "A") return tier;
  return "B";
}

export function attachProjectionSanityAudit(prop = {}, options = {}) {
  const audit = options.audit || buildProjectionSanityAudit(prop);
  const rawConfidence =
    options.confidence ??
    prop.displayConfidenceScore ??
    prop.confidenceScore ??
    prop.confidence;
  const adjustedConfidence = applySanityConfidencePenalty(rawConfidence, audit);
  const verifiedTier = demoteTierForProjectionSanity(prop.verifiedTier, audit);

  return {
    ...prop,
    projectionSanityAudit: audit,
    projectionSanityScore: audit.sanityScore,
    projectionOutlier: audit.isOutlier,
    projectionOutlierFlag: audit.isOutlier ? PROJECTION_OUTLIER_FLAG : "",
    displayConfidenceScore: adjustedConfidence,
    confidenceScore: adjustedConfidence,
    confidence: adjustedConfidence,
    verifiedTier: verifiedTier ?? prop.verifiedTier,
    verifiedTierLabel: verifiedTier ? `Tier ${verifiedTier}` : prop.verifiedTierLabel,
  };
}
