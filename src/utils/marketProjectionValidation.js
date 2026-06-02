/**
 * Phase 15 — market-specific projection validation against historical ranges.
 */

import { resolvePropMarketKey } from "./marketNormalization.js";

export const PROJECTION_OUTLIER_DETECTED = "Projection Outlier Detected";
export const PROJECTION_OUTLIER_THRESHOLD = 0.3;

export const MARKET_PROJECTION_RULES = {
  hrr: {
    label: "Hits+Runs+RBIs",
    baseline: "season",
    maxMultiplier: 1.35,
    requiresOutlierSupport: true,
  },
  totalBases: {
    label: "Total Bases",
    baseline: "last10",
    maxMultiplier: 1.3,
    requiresOutlierSupport: false,
  },
  strikeouts: {
    label: "Strikeouts",
    baseline: "season",
    maxMultiplier: 1.25,
    requiresOutlierSupport: false,
  },
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function resolveHistoricalAverages(prop = {}) {
  const inputs = prop?.pitcherInputs || {};
  const breakdown = Array.isArray(prop?.projectionBreakdown) ? prop.projectionBreakdown : [];
  const last5Row = breakdown.find((row) => /last\s*5/i.test(String(row.label || "")));
  const seasonRow = breakdown.find((row) => /season/i.test(String(row.label || "")));
  const last10Row = breakdown.find((row) => /last\s*10/i.test(String(row.label || "")));

  return {
    last5: finite(prop.last5Average) ?? finite(inputs.last5Average) ?? finite(last5Row?.value),
    last10: finite(prop.last10Average) ?? finite(inputs.last10Average) ?? finite(last10Row?.value),
    season: finite(prop.seasonAverage) ?? finite(inputs.seasonAverage) ?? finite(seasonRow?.value),
  };
}

function resolveBaselineAverage(rule, averages = {}) {
  if (!rule) return null;
  const key = rule.baseline;
  const value = finite(averages[key]);
  if (value != null && value > 0) return value;
  return (
    [finite(averages.season), finite(averages.last10), finite(averages.last5)].find(
      (entry) => entry != null && entry > 0
    ) ?? null
  );
}

function deviationPct(projection, baseline) {
  if (projection == null || baseline == null || baseline <= 0) return null;
  return (projection - baseline) / baseline;
}

export function resolveProjectionValidationConfidence(projection, seasonAverage) {
  const dev = deviationPct(projection, seasonAverage);
  if (dev == null) return "LOW";
  const absDev = Math.abs(dev);
  if (absDev <= 0.15) return "HIGH";
  if (absDev <= 0.3) return "MEDIUM";
  return "LOW";
}

export function resolveProjectionRisk(projection, line) {
  const proj = finite(projection);
  const ln = finite(line);
  if (proj == null || ln == null || ln <= 0) return "NORMAL";
  const diffPct = (Math.abs(proj - ln) / ln) * 100;
  if (diffPct >= 50) return "AGGRESSIVE";
  if (diffPct >= 25) return "NORMAL";
  return "SAFE";
}

function resolveOutlierSupport(prop = {}, averages = {}) {
  const reasons = [];
  const { last5, last10, season } = averages;

  if (
    prop.battingOrderBoost ||
    (finite(prop.lineupSlot) != null && finite(prop.lineupSlot) <= 3) ||
    /leadoff|cleanup|top.?of.?order|batting.?order/i.test(
      String(prop.usageContext || prop.matchupNote || "")
    )
  ) {
    reasons.push("batting order boost");
  }

  const opponentRank = finite(prop.opponentRank);
  if (opponentRank != null && opponentRank >= 22) reasons.push("opponent weakness");
  if (/weak pitching|fade|bullpen|pitching staff/i.test(String(prop.matchupNote || prop.opponentContext || ""))) {
    reasons.push("opponent weakness");
  }

  if (last10 != null && season != null && last10 > season * 1.08) reasons.push("hot streak");
  if (last5 != null && season != null && last5 > season * 1.1) reasons.push("hot streak");
  if (finite(prop.last10HitRate) >= 70 || finite(prop.recentHitRate) >= 0.7) reasons.push("hot streak");

  if (
    /short porch|favorable|wind out|hitter friendly|park factor|bandbox/i.test(
      String(prop.parkFactorNote || prop.parkNote || prop.venueNote || "")
    )
  ) {
    reasons.push("park factor");
  }

  return { supported: reasons.length > 0, reasons };
}

export function resolveMarketProjectionCap(prop = {}, averages = {}, marketKey = "") {
  const rule = MARKET_PROJECTION_RULES[marketKey];
  if (!rule) return null;
  const baseline = resolveBaselineAverage(rule, averages);
  if (baseline == null || baseline <= 0) return null;
  return round1(baseline * rule.maxMultiplier);
}

/**
 * Validate and optionally clamp projection to market-specific historical cap.
 */
export function validateMarketProjection(prop = {}, rawProjection = null) {
  const marketKey = resolvePropMarketKey(prop);
  const rule = marketKey ? MARKET_PROJECTION_RULES[marketKey] : null;
  const raw = finite(rawProjection ?? prop.projection ?? prop.projectedValue);
  const line = finite(prop.line);
  const averages = resolveHistoricalAverages(prop);
  const seasonAverage = averages.season;
  const baseline = resolveBaselineAverage(rule, averages);
  const marketCap = resolveMarketProjectionCap(prop, averages, marketKey);
  const outlierSupport = rule?.requiresOutlierSupport ? resolveOutlierSupport(prop, averages) : { supported: false, reasons: [] };
  const seasonDeviationPct =
    seasonAverage != null && raw != null ? round1(deviationPct(raw, seasonAverage) * 100) : null;
  const outlierDetected =
    seasonAverage != null && raw != null && raw > seasonAverage * (1 + PROJECTION_OUTLIER_THRESHOLD);

  if (!rule || raw == null || marketCap == null) {
    const projectionConfidence = resolveProjectionValidationConfidence(raw, seasonAverage ?? baseline);
    const projectionRisk = resolveProjectionRisk(raw, line);
    return {
      marketKey: marketKey || "",
      marketLabel: rule?.label || marketKey || "",
      supported: Boolean(rule),
      rawProjection: raw,
      validatedProjection: raw,
      marketCap,
      baselineAverage: baseline,
      seasonAverage,
      projectionConfidence,
      projectionRisk,
      seasonDeviationPct,
      outlierDetected,
      outlierWarning: outlierDetected ? PROJECTION_OUTLIER_DETECTED : "",
      projectionClamped: false,
      outlierSupported: outlierSupport.supported,
      outlierSupportReasons: outlierSupport.reasons,
      clampReason: "",
    };
  }

  let validatedProjection = raw;
  let projectionClamped = false;
  let clampReason = "";

  if (raw > marketCap + 1e-9) {
    if (rule.requiresOutlierSupport && outlierSupport.supported) {
      const supportedCap = round1(
        Math.max(
          marketCap,
          finite(averages.last10) != null && finite(averages.last10) > 0
            ? finite(averages.last10) * 1.25
            : 0,
          finite(averages.last5) != null && finite(averages.last5) > 0
            ? finite(averages.last5) * 1.3
            : 0
        )
      );
      validatedProjection = Math.min(raw, supportedCap);
      projectionClamped = validatedProjection < raw - 1e-9;
      if (projectionClamped) {
        clampReason = `${rule.label} projection capped at supported outlier max ${supportedCap}`;
      }
    } else {
      validatedProjection = marketCap;
      projectionClamped = true;
      clampReason = rule.requiresOutlierSupport
        ? `${rule.label} projection capped at season avg × ${rule.maxMultiplier} (no outlier support)`
        : `${rule.label} projection capped at ${rule.baseline} avg × ${rule.maxMultiplier}`;
    }
  }

  validatedProjection = round1(validatedProjection);
  const projectionConfidence = resolveProjectionValidationConfidence(
    validatedProjection,
    seasonAverage ?? baseline
  );
  const projectionRisk = resolveProjectionRisk(validatedProjection, line);

  return {
    marketKey,
    marketLabel: rule.label,
    supported: true,
    rawProjection: raw,
    validatedProjection,
    marketCap,
    baselineAverage: baseline,
    seasonAverage,
    projectionConfidence,
    projectionRisk,
    seasonDeviationPct,
    outlierDetected,
    outlierWarning: outlierDetected ? PROJECTION_OUTLIER_DETECTED : "",
    projectionClamped,
    outlierSupported: outlierSupport.supported,
    outlierSupportReasons: outlierSupport.reasons,
    clampReason,
  };
}

export function attachMarketProjectionValidation(prop = {}, rawProjection = null) {
  const validation = validateMarketProjection(prop, rawProjection);
  const validatedProjection = validation.validatedProjection ?? validation.rawProjection;
  return {
    ...prop,
    rawProjection: validation.rawProjection,
    projection: validatedProjection,
    projectedValue: validatedProjection,
    projectionValidation: validation,
    projectionValidationConfidence: validation.projectionConfidence,
    projectionRisk: validation.projectionRisk,
    projectionOutlierDetected: validation.outlierDetected,
    projectionOutlierWarning: validation.outlierWarning,
    projectionClamped: validation.projectionClamped,
  };
}
