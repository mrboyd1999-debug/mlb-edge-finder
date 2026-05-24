/** Realistic MLB confidence calibration — avoids inflated uniform scores. */

import { isDebugModeEnabled } from "./devMode.js";

export const MIN_DISPLAY_CONFIDENCE = 55;

export const CONFIDENCE_TOOLTIP =
  "Confidence combines projection edge, matchup quality, recent form, and line difficulty.";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function confidenceBandLabel(confidence) {
  const c = finiteOr(confidence, 50);
  if (c >= 76) return "elite";
  if (c >= 68) return "strong";
  if (c >= 59) return "playable";
  return "weak";
}

export function confidenceBandDisplay(confidence) {
  const band = confidenceBandLabel(confidence);
  if (band === "elite") return "Elite";
  if (band === "strong") return "Strong";
  if (band === "playable") return "Playable";
  return "Research";
}

export function confidenceBandPalette(confidence) {
  const band = confidenceBandLabel(confidence);
  if (band === "elite") return { bg: "#1e3a8a", border: "#60a5fa", color: "#dbeafe" };
  if (band === "strong") return { bg: "#14532d", border: "#22c55e", color: "#bbf7d0" };
  if (band === "playable") return { bg: "#422006", border: "#ca8a04", color: "#fef08a" };
  return { bg: "#1e293b", border: "#64748b", color: "#94a3b8" };
}

function computeEdgePercentLocal(prop = {}, edge = null) {
  const e = Math.abs(finiteOr(edge ?? prop.edge, 0));
  const line = finiteOr(prop.line, 0);
  if (line <= 0) return 0;
  return (e / line) * 100;
}

function hasMajorRisk(prop = {}) {
  if (prop.blowoutRisk || /blowout/i.test(String(prop.riskFlags || ""))) return true;
  if (/questionable|gtd|doubtful|out/i.test(String(prop.injuryStatus || prop.statusNote || ""))) return true;
  if (prop.backToBack || /back-to-back|b2b/i.test(String(prop.formNote || ""))) return true;
  return false;
}

export function hasMeaningfulEnrichment(prop = {}) {
  return Boolean(
    prop.sportsDataSeason ||
    prop.sportsDataRecentGames?.length ||
    prop.hasSportsDataEnrichment ||
    Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0) >= 5 ||
    Number.isFinite(Number(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate)) ||
    prop.matchupNote ||
    prop.formNote
  );
}

export function isEliteConfidenceEligible(prop = {}, edge = null) {
  const edgeVal = Math.abs(finiteOr(edge ?? prop.edge, 0));
  const edgePct = computeEdgePercentLocal(prop, edgeVal);
  return (
    edgeVal >= 2.5 &&
    edgePct >= 22 &&
    hasMeaningfulEnrichment(prop) &&
    !hasMajorRisk(prop) &&
    booksOrModelSupport(prop)
  );
}

function booksOrModelSupport(prop = {}) {
  const books = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);
  if (books >= 2 && finiteOr(prop.sportsbookEdge, 0) >= 0) return true;
  const hit = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  return Number.isFinite(hit) && hit >= 0.62;
}

export function calibrateRealisticConfidence(rawConfidence, prop = {}, edge = null) {
  let score = Math.round(finiteOr(rawConfidence, 54));
  const edgeVal = finiteOr(edge ?? prop.edge, 0);
  const sampleSize = Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0);

  if (!hasMeaningfulEnrichment(prop)) score -= 7;
  else if (sampleSize > 0 && sampleSize < 5) score -= 4;

  if (!Number.isFinite(Number(prop.modelProbability ?? prop.modelSignal?.modelProbability))) {
    score -= 3;
  }

  if (prop.displayFallback || prop.isFallbackMlbPick) score -= 5;

  const enrichmentQuality = finiteOr(prop.dataQualityScore, NaN);
  if (Number.isFinite(enrichmentQuality)) {
    score += clamp((enrichmentQuality - 52) * 0.08, -5, 4);
  }

  score = Math.round(score * 0.78 + 56 * 0.22);

  const elite = isEliteConfidenceEligible(prop, edgeVal);
  const maxCap = elite ? 82 : 75;
  score = clamp(score, 50, maxCap);

  if (!elite && score > 75) score = 75;
  if (elite && score >= 74) score = clamp(score, 76, 82);

  return score;
}

export function passesDisplayConfidenceFloor(prop = {}) {
  if (isDebugModeEnabled()) return true;
  return finiteOr(prop.confidenceScore ?? prop.confidence, 0) >= MIN_DISPLAY_CONFIDENCE;
}

export function filterByDisplayConfidenceFloor(props = []) {
  return (props || []).filter(passesDisplayConfidenceFloor);
}
