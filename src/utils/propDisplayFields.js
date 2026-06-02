/**
 * Unified display fields — one confidence, risk, provider label, and card copy everywhere.
 */

import { normalizeSource } from "./normalizeSource.js";
import { attachLineSourceFields } from "./normalizeProp.js";
import { attachPayoutCategoryFields } from "./payoutCategory.js";
import { formatPitcherLabel } from "./pitcherDisplay.js";
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

export function applyConfidenceSanityCap(confidence, probability, prop = {}) {
  void probability;
  if (!Number.isFinite(confidence)) return confidence;
  const min = prop.isEmergencyPlay ? 25 : 60;
  return Math.round(Math.max(min, Math.min(95, confidence)));
}

export function resolveNormalizedConfidence(prop = {}) {
  const raw = finite(
    prop.finalConfidence ??
      prop.displayConfidenceScore ??
      prop.confidenceScore ??
      prop.confidence
  );
  if (!Number.isFinite(raw) || raw <= 0) {
    return prop.isEmergencyPlay ? 25 : null;
  }
  const probability = resolveNormalizedProbability(prop);
  const capped = applyConfidenceSanityCap(raw, probability, prop);
  return Math.round(Math.max(prop.isEmergencyPlay ? 25 : 1, Math.min(100, capped)));
}

export function resolveNormalizedProbability(prop = {}) {
  const value = finite(
    prop.finalProbability ??
      prop.probabilityScore ??
      prop.verifiedProbability ??
      prop.probability ??
      prop.displayProbability
  );
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function hasRenderableRankingMetrics(prop = {}) {
  const projection = resolveProjectionValue(prop);
  const probability = resolveNormalizedProbability(prop);
  const confidence = resolveNormalizedConfidence(prop);
  const edgeLabels = prop.displayEdgeLabel
    ? { displayEdgeLabel: prop.displayEdgeLabel }
    : formatEdgeDisplay(prop);
  const edgeLabel = edgeLabels?.displayEdgeLabel;

  if (projection == null || projection <= 0) return false;
  if (probability == null) return false;
  if (confidence == null || confidence <= 0) return false;
  if (!edgeLabel || edgeLabel === "—") return false;
  return true;
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

function hasPrizePicksLine(prop = {}) {
  const comparison = prop.lineComparison || {};
  return finite(comparison.prizePicksLine ?? prop.prizePicksLine ?? prop.ppLine) != null;
}

function hasUnderdogLine(prop = {}) {
  const comparison = prop.lineComparison || {};
  return finite(comparison.underdogLine ?? prop.underdogLine ?? prop.udLine) != null;
}

export function resolveProviderDisplayLabel(prop = {}, context = {}) {
  const withLines = attachLineSourceFields(prop);
  const sportsDataConnected = Boolean(
    context.sportsDataConnected ??
      (hasSportsDataIoData(prop) || /sportsdata/i.test(String(prop.projectionSource || "")))
  );
  const oddsConnected = Boolean(context.oddsApiConnected ?? hasOddsApiLine(withLines));
  const hasPp = hasPrizePicksLine(withLines);
  const hasUd = hasUnderdogLine(withLines);
  const providers = Array.isArray(withLines.providers) ? withLines.providers : [];
  const cached = Boolean(
    prop.fromCache ||
      prop.cacheLayer ||
      prop.usingCachedLine ||
      String(prop.lineSourceBadge || "").toUpperCase() === "CACHED" ||
      /cached/i.test(String(prop.statusLabel || ""))
  );

  const lineParts = providers.length
    ? providers
    : (() => {
        const parts = [];
        if (hasPp) parts.push("PrizePicks");
        if (hasUd) parts.push("Underdog");
        if (oddsConnected) parts.push("Odds API");
        return parts;
      })();

  if (lineParts.length >= 2) return `Verified via ${lineParts.join(" + ")}`;
  if (hasPp) return "Verified via PrizePicks";
  if (hasUd) return cached ? "Line from Underdog cache" : "Verified via Underdog";
  if (oddsConnected) return "Line verified via Odds API";

  if (sportsDataConnected && oddsConnected) return "Verified via SportsDataIO + Odds API";
  if (sportsDataConnected) return "Verified via SportsDataIO";

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

export function resolveProviderLineFields(prop = {}) {
  const withLines = attachLineSourceFields(prop);
  const comparison = withLines.lineComparison || prop.lineComparison || {};
  const prizePicksLine = finite(comparison.prizePicksLine ?? withLines.prizePicksLine ?? prop.prizePicksLine ?? prop.ppLine);
  const underdogLine = finite(comparison.underdogLine ?? withLines.underdogLine ?? prop.underdogLine ?? prop.udLine);
  const activeLine = finite(withLines.lineUsed ?? prop.lineUsed ?? prop.line);
  return {
    prizePicksLine,
    underdogLine,
    activeLine,
    prizePicksLineLabel: prizePicksLine != null ? formatNumber(prizePicksLine) : null,
    underdogLineLabel: underdogLine != null ? formatNumber(underdogLine) : null,
    activeLineLabel: activeLine != null ? formatNumber(activeLine) : null,
  };
}

export function resolvePitcherCardLabel(prop = {}) {
  return formatPitcherLabel(prop);
}

export { formatPitcherLabel } from "./pitcherDisplay.js";

export function attachPropDisplayFields(prop = {}, context = {}) {
  const withLines = attachLineSourceFields(prop);
  const withPayout = attachPayoutCategoryFields(withLines);
  const confidenceNormalized = resolveNormalizedConfidence(withPayout);
  const probabilityNormalized = resolveNormalizedProbability(withPayout);
  const riskLevel = computePropRiskLevel(withPayout);
  const providerLabel = resolveProviderDisplayLabel(withPayout, context);
  const lineFields = resolveProviderLineFields(withPayout);
  const cardDescription = buildCardDescription({
    ...prop,
    displayConfidenceScore: confidenceNormalized,
    probabilityScore: probabilityNormalized,
  });

  return {
    ...withPayout,
    ...lineFields,
    lineUsed: withPayout.lineUsed ?? lineFields.activeLine,
    lineUsedLabel: lineFields.activeLineLabel,
    confidenceNormalized,
    confidence: confidenceNormalized,
    displayConfidenceScore: confidenceNormalized,
    probabilityNormalized,
    riskLevel,
    riskExplanation: resolveRiskExplanation(riskLevel),
    providerLabel,
    pitcherCardLabel: formatPitcherLabel(withPayout),
    cardDescription,
    qualificationReason: cardDescription || prop.qualificationReason || "",
  };
}
