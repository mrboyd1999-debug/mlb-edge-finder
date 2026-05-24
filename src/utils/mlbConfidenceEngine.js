/** Realistic MLB confidence calibration — avoids inflated uniform scores. */

import { isDebugModeEnabled } from "./devMode.js";

export const MIN_DISPLAY_CONFIDENCE = 55;
export const MIN_BEST_PLAY_CONFIDENCE = 55;
export const MIN_GOBLIN_DEMON_CONFIDENCE = 50;
export const MIN_STREAK_CONFIDENCE = 50;

export const CONFIDENCE_TOOLTIP =
  "Confidence combines projection edge, matchup quality, recent form, and line difficulty.";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function confidenceBandLabel(score) {
  const c = finiteOr(score, 50);
  if (c >= 80) return "strong";
  if (c >= 70) return "playable";
  if (c >= 60) return "lean";
  return "weak";
}

export function confidenceBandDisplay(score) {
  const band = confidenceBandLabel(score);
  if (band === "strong") return "Strong Play";
  if (band === "playable") return "Playable";
  if (band === "lean") return "Lean";
  return "Research Only";
}

export function confidenceBandPalette(score) {
  const band = confidenceBandLabel(score);
  if (band === "strong") return { bg: "#14532d", border: "#22c55e", color: "#bbf7d0" };
  if (band === "playable") return { bg: "#422006", border: "#ca8a04", color: "#fef08a" };
  if (band === "lean") return { bg: "#1e3a8a", border: "#60a5fa", color: "#dbeafe" };
  return { bg: "#1e293b", border: "#64748b", color: "#94a3b8" };
}

/** Prefer playability when present; otherwise confidence. */
export function resolveBandScore(prop = {}) {
  const playability = finiteOr(prop.playabilityScore, NaN);
  if (Number.isFinite(playability)) return Math.round(playability);
  return Math.round(finiteOr(prop.confidenceScore ?? prop.confidence, 50));
}

function computeEdgePercentLocal(prop = {}, edge = null) {
  const e = finiteOr(edge ?? prop.edge, NaN);
  const projection = finiteOr(prop.projection ?? prop.projectedValue, NaN);
  if (!Number.isFinite(e) || !Number.isFinite(projection) || projection <= 0) return 0;
  return Math.round((e / projection) * 100);
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
  let score = Math.round(finiteOr(rawConfidence, 50));
  const edgeVal = finiteOr(edge ?? prop.edge, 0);
  const sampleSize = Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0);

  if (!hasMeaningfulEnrichment(prop)) score -= 7;
  else if (sampleSize > 0 && sampleSize < 5) score -= 4;

  if (!Number.isFinite(Number(prop.modelProbability ?? prop.modelSignal?.modelProbability))) {
    score -= 3;
  }

  if (prop.displayFallback || prop.isFallbackMlbPick || prop.isFallback) score -= 5;

  const enrichmentQuality = finiteOr(prop.dataQualityScore, NaN);
  if (Number.isFinite(enrichmentQuality)) {
    score += clamp((enrichmentQuality - 52) * 0.08, -5, 4);
  }

  score = Math.round(score * 0.78 + 50 * 0.22);

  const elite = isEliteConfidenceEligible(prop, edgeVal);
  let maxCap = elite ? 82 : 75;
  if (!hasMeaningfulEnrichment(prop)) maxCap = Math.min(maxCap, 65);
  if (!Number.isFinite(Number(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate)) && sampleSize < 5) {
    maxCap = Math.min(maxCap, 65);
  }
  if (
    !prop.sportsDataSeason &&
    !prop.sportsDataRecentGames?.length &&
    Number.isFinite(Number(prop.projection ?? prop.projectedValue)) &&
    !prop.matchupNote
  ) {
    maxCap = Math.min(maxCap, 60);
  }
  if (prop.estimatedProjection || prop.projectionSource === "fallback-player-stats") {
    maxCap = Math.min(maxCap, 65);
  }
  if (prop.displayFallback || prop.isFallback) {
    maxCap = Math.min(maxCap, 55);
  }

  score = clamp(score, 50, maxCap);

  if (!elite && score > 75) score = 75;
  if (elite && score >= 74) score = clamp(score, 76, 82);

  return score;
}

export function passesDisplayConfidenceFloor(prop = {}, floor = MIN_DISPLAY_CONFIDENCE) {
  if (isDebugModeEnabled()) return true;
  return finiteOr(prop.confidenceScore ?? prop.confidence, 50) >= floor;
}

export function filterByDisplayConfidenceFloor(props = [], floor = MIN_DISPLAY_CONFIDENCE) {
  return (props || []).filter((prop) => passesDisplayConfidenceFloor(prop, floor));
}
