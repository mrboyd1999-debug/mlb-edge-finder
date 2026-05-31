/**
 * Unified display fields — one confidence, risk, provider label, and card copy everywhere.
 */

import { normalizeSource } from "./normalizeSource.js";
import {
  classifyPropTier,
  hasPositiveEdge,
  resolvePropConfidence,
  resolvePropProbability,
  resolveSideForTier,
} from "./tierClassification.js";
import { hasSportsDataIoData } from "./verificationStatus.js";
import { resolveProjectionValue } from "./projectionQuality.js";
import { formatEdgeDisplay } from "./conservativeProjection.js";
import { formatNumber } from "./formatters.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function resolveNormalizedConfidence(prop = {}) {
  const value = resolvePropConfidence(prop);
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function resolveNormalizedProbability(prop = {}) {
  const value = resolvePropProbability(prop);
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function computePropRiskLevel(prop = {}) {
  const confidence = resolveNormalizedConfidence(prop);
  const probability = resolveNormalizedProbability(prop);
  const line = finite(prop.line);
  const projection = finite(prop.projection ?? prop.projectedValue);
  const edge = finite(prop.edge);
  const tier = classifyPropTier(prop);
  const isResearch = tier === "C";

  if (line == null || line <= 0 || projection == null || projection <= 0) return "HIGH";
  if (edge != null && edge <= 0) return "HIGH";
  if (!hasPositiveEdge(prop)) return "HIGH";

  let level = "HIGH";
  if (confidence != null && confidence >= 65 && probability != null && probability >= 55 && edge > 0) {
    level = "MEDIUM";
  }
  if (confidence != null && confidence >= 75 && probability != null && probability >= 65 && edge > 0) {
    level = "LOW";
  }

  if (isResearch && (confidence == null || confidence < 75 || probability == null || probability < 65)) {
    if (level === "LOW") level = "MEDIUM";
    if (confidence == null || confidence < 65) level = "HIGH";
  }

  return level;
}

export function resolveRiskExplanation(riskLevel = "") {
  const key = String(riskLevel || "").toUpperCase();
  if (key === "LOW") return "Strong confidence, positive edge, and stable probability.";
  if (key === "MEDIUM") return "Playable but still needs review due to moderate confidence or probability.";
  return "High risk — avoid unless using for research only.";
}

function resolveSideLabel(prop = {}) {
  const side = resolveSideForTier(prop);
  if (side === "OVER") return "Higher";
  if (side === "UNDER") return "Lower";
  const lean = String(prop.bestPick || prop.lean || prop.side || "").trim();
  return lean || "Pass";
}

function hasOddsApiLine(prop = {}) {
  return Boolean(
    prop.sportsbookLine != null ||
      prop.bestAvailableLine != null ||
      prop.oddsApiLine != null ||
      Number(prop.sportsbookBooksCount) > 0 ||
      /odds/i.test(String(prop.projectionSource || ""))
  );
}

export function resolveProviderDisplayLabel(prop = {}, context = {}) {
  const sportsDataConnected = Boolean(
    context.sportsDataConnected ??
      (hasSportsDataIoData(prop) || /sportsdata/i.test(String(prop.projectionSource || "")))
  );
  const oddsConnected = Boolean(context.oddsApiConnected ?? hasOddsApiLine(prop));
  const src = normalizeSource(prop);
  const cached = Boolean(
    prop.fromCache ||
      prop.cacheLayer ||
      prop.usingCachedLine ||
      String(prop.lineSourceBadge || "").toUpperCase() === "CACHED" ||
      /cached/i.test(String(prop.statusLabel || ""))
  );

  if (sportsDataConnected && oddsConnected) return "Verified via SportsDataIO + Odds API";
  if (sportsDataConnected) return "Verified via SportsDataIO";
  if (oddsConnected) return "Line verified via Odds API";
  if (src === "underdog" && cached) return "Line from Underdog cache";
  if (src === "underdog") return "Line from Underdog";
  if (src === "prizepicks") return null;

  const fallback = String(prop.providerLabel || prop.projectionSourceLabel || "").trim();
  if (/live_provider|cache_provider|fallback|null|undefined/i.test(fallback)) return null;
  if (fallback) return fallback;
  return null;
}

export function buildCardDescription(prop = {}) {
  const projection = resolveProjectionValue(prop);
  const confidence = resolveNormalizedConfidence(prop);
  const probability = resolveNormalizedProbability(prop);
  const edgeLabels = prop.displayEdgeLabel ? { displayEdgeLabel: prop.displayEdgeLabel } : formatEdgeDisplay(prop);
  const edgeText = edgeLabels?.displayEdgeLabel ?? (finite(prop.edge) != null ? formatNumber(prop.edge) : null);
  const side = resolveSideLabel(prop);
  const parts = [];

  if (projection != null && projection > 0) parts.push(`Projects ${formatNumber(projection)}`);
  if (edgeText && edgeText !== "—") parts.push(`${side} ${edgeText} edge`);
  if (confidence != null) parts.push(`${confidence}% confidence`);
  if (probability != null) parts.push(`${probability}% probability`);

  return parts.length ? parts.join(" · ") : "";
}

export function attachPropDisplayFields(prop = {}, context = {}) {
  const confidenceNormalized = resolveNormalizedConfidence(prop);
  const probabilityNormalized = resolveNormalizedProbability(prop);
  const riskLevel = computePropRiskLevel(prop);
  const providerLabel = resolveProviderDisplayLabel(prop, context);
  const cardDescription = buildCardDescription({
    ...prop,
    displayConfidenceScore: confidenceNormalized,
    probabilityScore: probabilityNormalized,
  });

  return {
    ...prop,
    confidenceNormalized,
    confidence: confidenceNormalized,
    displayConfidenceScore: confidenceNormalized,
    probabilityNormalized,
    riskLevel,
    riskExplanation: resolveRiskExplanation(riskLevel),
    providerLabel,
    cardDescription,
    qualificationReason: cardDescription || prop.qualificationReason || "",
  };
}
