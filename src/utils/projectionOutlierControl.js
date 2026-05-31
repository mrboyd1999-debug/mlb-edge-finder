/**
 * Projection outlier control — line-scale caps and soft metric penalties.
 */

import { resolvePropMarketKey } from "./marketNormalization.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function resolveLast10Average(prop = {}) {
  const direct = finite(prop.last10Average ?? prop.last10HitRate ?? prop.recentHitRate);
  if (direct == null) return null;
  if (direct <= 1 && direct >= 0) return direct;
  return direct;
}

function isHitterProp(prop = {}) {
  const market = resolvePropMarketKey(prop);
  return !["strikeouts", "outs", "earnedRuns", "hitsAllowed", "pitchingOuts"].includes(market);
}

function isHrrMarket(prop = {}) {
  const market = resolvePropMarketKey(prop);
  return market === "hrr" || /hits.*runs.*rbi|h\+r\+rbi|hrr/i.test(String(prop.statType || prop.market || ""));
}

export function applyProjectionOutlierControl(prop = {}) {
  const line = finite(prop.line);
  let projection = finite(prop.projection ?? prop.projectedValue);
  if (line == null || line <= 0 || projection == null || projection <= 0) return prop;

  let projectionCapped = Boolean(prop.projectionCapApplied);
  let capNote = prop.projectionCapNote || null;
  let outlierLabel = prop.projectionOutlierLabel || null;
  let confidencePenalty = 0;
  let probabilityPenalty = 0;

  if (!prop.projectionCapApplied && isHrrMarket(prop) && Math.abs(line - 1.5) < 0.01 && projection > 2.7) {
    const last10Avg = resolveLast10Average(prop);
    if (last10Avg == null || last10Avg < projection) {
      projection = 2.7;
      projectionCapped = true;
      capNote = "Projection capped for line-scale safety.";
    }
  }

  if (isHitterProp(prop) && projection > line * 2) {
    outlierLabel = "Projection Outlier";
    if (!prop.projectionOutlierPenaltiesApplied) {
      confidencePenalty = 5;
      probabilityPenalty = 3;
    }
  }

  const next = { ...prop };
  const largeEdgeWarning =
    isHitterProp(prop) && projection > line * 2
      ? "Large relative edge — verify projection source and line scale."
      : null;
  if (largeEdgeWarning) {
    next.projectionLargeEdgeWarning = largeEdgeWarning;
  }
  if (projection !== finite(prop.projection ?? prop.projectedValue)) {
    next.projection = projection;
    next.projectedValue = projection;
  }
  if (projectionCapped && !prop.projectionCapApplied) {
    next.projectionClamped = true;
    next.projectionCapApplied = true;
    next.projectionCapNote = capNote;
    next.projectionCapReason = capNote;
  }
  if (outlierLabel && !prop.projectionOutlierLabel) {
    next.projectionOutlierDetected = true;
    next.projectionOutlierLabel = outlierLabel;
  }

  if (confidencePenalty > 0) {
    const confidence = finite(
      next.finalConfidence ?? next.displayConfidenceScore ?? next.confidenceScore ?? next.confidence
    );
    if (confidence != null) {
      const adjusted = Math.max(0, Math.round(confidence - confidencePenalty));
      next.displayConfidenceScore = adjusted;
      next.confidenceScore = adjusted;
      next.confidence = adjusted;
      next.finalConfidence = adjusted;
    }
    next.projectionOutlierPenaltiesApplied = true;
  }

  if (probabilityPenalty > 0) {
    const probability = finite(next.finalProbability ?? next.probabilityScore ?? next.verifiedProbability);
    if (probability != null) {
      const adjusted = Math.max(0, Math.round(probability - probabilityPenalty));
      next.probabilityScore = adjusted;
      next.verifiedProbability = adjusted;
      next.finalProbability = adjusted;
    }
    next.projectionOutlierPenaltiesApplied = true;
  }

  if (capNote || outlierLabel || next.projectionLargeEdgeWarning) {
    next.projectionOutlierAudit = {
      projectionCapped,
      capNote,
      outlierLabel,
      largeEdgeWarning: next.projectionLargeEdgeWarning || null,
      confidencePenalty,
      probabilityPenalty,
      line,
      projection: round1(projection),
    };
  }

  return next;
}
