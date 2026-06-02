/**
 * Projection sanity layer — caps aggressive projections without auto-rejecting props.
 */

import { resolvePropMarketKey } from "./marketNormalization.js";
import { applyProjectionOutlierControl } from "./projectionOutlierControl.js";

export function hasAggressiveProjectionWarning(prop = {}) {
  return Boolean(
    prop.projectionAggressiveWarning ||
      prop.projectionLargeEdgeWarning ||
      (prop.projectionSanityStatus === "outlier" &&
        /aggressive|large relative edge/i.test(String(prop.projectionWarning || "")))
  );
}

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveLast10Average(prop = {}) {
  const direct = finite(prop.last10Average ?? prop.last10HitRate ?? prop.recentHitRate);
  if (direct == null) return null;
  if (direct <= 1 && direct >= 0) return direct;
  return direct;
}

function isHrrMarket(prop = {}) {
  const market = resolvePropMarketKey(prop);
  return market === "hrr" || /hits.*runs.*rbi|h\+r\+rbi|hrr/i.test(String(prop.statType || prop.market || ""));
}

function applyConfidencePenalty(prop = {}, penalty = 0) {
  if (!penalty) return prop;
  const confidence = finite(
    prop.finalConfidence ?? prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence
  );
  if (confidence == null) return prop;
  const adjusted = Math.max(0, Math.round(confidence - penalty));
  return {
    ...prop,
    displayConfidenceScore: adjusted,
    confidenceScore: adjusted,
    confidence: adjusted,
    finalConfidence: adjusted,
  };
}

function applyProbabilityPenalty(prop = {}, penalty = 0) {
  if (!penalty) return prop;
  const probability = finite(prop.finalProbability ?? prop.probabilityScore ?? prop.verifiedProbability);
  if (probability == null) return prop;
  const adjusted = Math.max(0, Math.round(probability - penalty));
  return {
    ...prop,
    probabilityScore: adjusted,
    verifiedProbability: adjusted,
    finalProbability: adjusted,
  };
}

/** Apply market-aware projection caps and soft confidence/probability penalties. */
export function applyProjectionSanity(prop = {}) {
  const line = finite(prop.line);
  const rawProjection = finite(prop.rawProjection ?? prop.projection ?? prop.projectedValue);
  if (line == null || line <= 0 || rawProjection == null || rawProjection <= 0) {
    return prop.rawProjection != null ? prop : { ...prop, rawProjection: rawProjection ?? null };
  }

  let adjusted = rawProjection;
  let projectionSanityStatus = "ok";
  let projectionWarning = prop.projectionWarning || "";
  let capReason = "";
  let confidencePenalty = 0;
  let probabilityPenalty = 0;

  const market = resolvePropMarketKey(prop);
  const last10Avg = resolveLast10Average(prop);

  if (isHrrMarket(prop) && Math.abs(line - 1.5) < 0.01 && adjusted > 2.2) {
    if (last10Avg == null || last10Avg < adjusted) {
      adjusted = 2.2;
      projectionSanityStatus = "capped";
      capReason = "HRR line 1.5 capped at 2.2 unless last10 supports projection";
      projectionWarning = projectionWarning || "HRR projection capped for line-scale safety";
    }
  }

  if (market === "totalBases" && Math.abs(line - 1.5) < 0.01 && adjusted > 2.7) {
    if (last10Avg == null || last10Avg < adjusted) {
      adjusted = 2.7;
      projectionSanityStatus = "capped";
      capReason = capReason || "Total Bases line 1.5 capped at 2.7 unless last10 supports projection";
      projectionWarning = projectionWarning || "Total Bases projection capped for line-scale safety";
    }
  }

  if (market === "totalBases" && adjusted > line * 1.9) {
    projectionSanityStatus = projectionSanityStatus === "capped" ? "capped" : "outlier";
    projectionWarning = projectionWarning || "Large relative edge";
    confidencePenalty = Math.max(confidencePenalty, 3);
    probabilityPenalty = Math.max(probabilityPenalty, 2);
  }

  if (market === "homeRuns" && adjusted >= 2) {
    adjusted = Math.min(adjusted, 1.25);
    projectionSanityStatus = "capped";
    capReason = capReason || "Home run count projection scaled to realistic range";
    projectionWarning = projectionWarning || "HR projection scaled to realistic range";
  }

  if (isHrrMarket(prop) && adjusted > line * 2) {
    if (last10Avg == null || last10Avg < adjusted) {
      projectionSanityStatus = projectionSanityStatus === "ok" ? "outlier" : projectionSanityStatus;
      projectionWarning = projectionWarning || "Large relative edge";
      confidencePenalty = Math.max(confidencePenalty, 3);
      probabilityPenalty = Math.max(probabilityPenalty, 2);
    }
  }

  if (adjusted > line * 1.75) {
    projectionSanityStatus = projectionSanityStatus === "ok" ? "outlier" : projectionSanityStatus;
    projectionWarning = projectionWarning || "Aggressive projection";
    confidencePenalty = Math.max(confidencePenalty, 4);
    probabilityPenalty = Math.max(probabilityPenalty, 3);
  }

  let next = {
    ...prop,
    rawProjection,
    adjustedProjection: adjusted,
    projection: adjusted,
    projectedValue: adjusted,
    projectionSanityStatus,
    projectionWarning: projectionWarning || "",
    projectionAggressiveWarning: adjusted > line * 1.75,
    projectionLargeEdgeWarning:
      prop.projectionLargeEdgeWarning ||
      (adjusted > line * 1.75 ? "Projection exceeds 1.75x line without full historical support" : ""),
    projectionCapReason: capReason || prop.projectionCapReason || "",
    projectionConfidence: prop.projectionConfidence || projectionSanityStatus,
  };

  if (capReason && !next.projectionCapNote) {
    next.projectionCapApplied = true;
    next.projectionCapNote = capReason;
  }

  next = applyConfidencePenalty(next, confidencePenalty);
  next = applyProbabilityPenalty(next, probabilityPenalty);
  next = applyProjectionOutlierControl(next);
  return next;
}
