/** Realistic MLB confidence calibration — avoids inflated uniform scores. */

import { isDebugModeEnabled } from "./devMode.js";
import { computeStandardEdgePercent } from "./standardPropMetrics.js";

export const MIN_DISPLAY_CONFIDENCE = 45;
export const MIN_BEST_PLAY_CONFIDENCE = 58;
export const MIN_GOBLIN_DEMON_CONFIDENCE = 45;
export const MIN_STREAK_CONFIDENCE = 54;

export const STANDARD_CONFIDENCE_CAP = 82;
export const ELITE_CONFIDENCE_CAP = 92;
export const STRONG_PLAY_MIN_CONFIDENCE = 68;
export const STRONG_PLAY_MIN_EDGE = 1.0;
export const STRONG_PLAY_MIN_SAMPLE = 5;
export const STRONG_PLAY_MIN_DQ = 52;

export const CONFIDENCE_TOOLTIP =
  "Confidence combines projection edge, matchup quality, recent form, and line difficulty.";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/** 45-54 Lean · 55-64 Solid · 65-74 Strong · 75+ Elite */
export function confidenceCalibrationTier(score) {
  const c = finiteOr(score, NaN);
  if (!Number.isFinite(c) || c < 45) return "Research Only";
  if (c <= 54) return "Lean";
  if (c <= 64) return "Solid";
  if (c <= 74) return "Strong";
  return "Elite";
}

export function confidenceBandLabel(score) {
  const tier = confidenceCalibrationTier(score);
  if (tier === "Elite") return "elite";
  if (tier === "Strong") return "strong";
  if (tier === "Solid") return "playable";
  if (tier === "Lean") return "lean";
  return "weak";
}

export function confidenceBandDisplay(score) {
  const tier = confidenceCalibrationTier(score);
  if (tier === "Elite") return "Elite";
  if (tier === "Strong") return "Strong";
  if (tier === "Solid") return "Solid";
  if (tier === "Lean") return "Lean";
  return "Research Only";
}

export function confidenceBandPalette(score) {
  const band = confidenceBandLabel(score);
  if (band === "elite") return { bg: "#14532d", border: "#22c55e", color: "#bbf7d0" };
  if (band === "strong") return { bg: "#166534", border: "#4ade80", color: "#dcfce7" };
  if (band === "playable") return { bg: "#422006", border: "#ca8a04", color: "#fef08a" };
  if (band === "lean") return { bg: "#1e3a8a", border: "#60a5fa", color: "#dbeafe" };
  return { bg: "#1e293b", border: "#64748b", color: "#94a3b8" };
}

export function resolveBandScore(prop = {}) {
  const playability = finiteOr(prop.playabilityScore, NaN);
  if (Number.isFinite(playability)) return Math.round(playability);
  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  return Number.isFinite(conf) ? Math.round(conf) : null;
}

function volatilityTierKey(source = {}) {
  if (typeof source === "string") {
    const key = source.toUpperCase();
    if (key.includes("LOW")) return "LOW";
    if (key.includes("HIGH")) return "HIGH";
    return "MEDIUM";
  }
  const tier = String(
    source?.tier || source?.label || source?.volatilityTier || source?.manualVolatilityTier || ""
  ).toUpperCase();
  if (tier.includes("LOW")) return "LOW";
  if (tier.includes("HIGH")) return "HIGH";
  return "MEDIUM";
}

/** Scale raw edge down in high-volatility spots; slight boost in stable spots. */
export function computeVolatilityAdjustedEdge(edge, volatility = {}) {
  const raw = Number(edge);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  const tier = volatilityTierKey(volatility);
  const score = finiteOr(volatility?.score, 0.5);
  let multiplier = 0.94;
  if (tier === "LOW" || score <= 0.4) multiplier = 1.04;
  else if (tier === "HIGH" || score >= 0.68) multiplier = 0.78;
  else if (score >= 0.55) multiplier = 0.88;
  return round(raw * multiplier, 2);
}

function computeEdgePercentLocal(prop = {}, edge = null) {
  const e = finiteOr(edge ?? prop.edge, 0);
  const line = finiteOr(prop.line, NaN);
  if (!Number.isFinite(line) || line <= 0) return 0;
  return computeStandardEdgePercent(e, line) ?? 0;
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

function booksOrModelSupport(prop = {}) {
  const books = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);
  if (books >= 2 && finiteOr(prop.sportsbookEdge, 0) >= 0) return true;
  const hit = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  return Number.isFinite(hit) && hit >= 0.62;
}

export function isEliteConfidenceEligible(prop = {}, edge = null) {
  const edgeVal = Math.abs(finiteOr(edge ?? prop.volatilityAdjustedEdge ?? prop.edge, 0));
  const edgePct = computeEdgePercentLocal(prop, edgeVal);
  const sample = Number(prop.sampleSize || 0);
  return (
    edgeVal >= 2.0 &&
    edgePct >= 18 &&
    sample >= 8 &&
    hasMeaningfulEnrichment(prop) &&
    !hasMajorRisk(prop) &&
    booksOrModelSupport(prop) &&
    volatilityTierKey(prop) !== "HIGH"
  );
}

function isRookieOrNewStarter(prop = {}) {
  const sample = Number(prop.sampleSize || 0);
  const games = Number(prop.gamesStarted ?? prop.starts ?? 0);
  if (sample > 0 && sample < 8) return true;
  if (games > 0 && games < 5) return true;
  if (prop.probableStarterConfirmed === false) return true;
  if (/rookie|debut|call[- ]?up|first start/i.test(String(prop.roleContext || prop.battingOrderNote || ""))) return true;
  return false;
}

function hasUncertainInnings(prop = {}) {
  const ip = finiteOr(prop.projectedInnings, NaN);
  if (String(prop.statType || "").toLowerCase().includes("strikeout") && !Number.isFinite(ip)) return true;
  if (/relief|bullpen|opener|uncertain|limited/i.test(String(prop.pitchCountTrend || prop.roleContext || ""))) return true;
  return false;
}

function hasInconsistentRecentForm(prop = {}) {
  const l5 = finiteOr(prop.last5Average, NaN);
  const season = finiteOr(prop.seasonAverage, NaN);
  const l5Hit = finiteOr(prop.last5HitRate, NaN);
  const l10Hit = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  if (Number.isFinite(l5) && Number.isFinite(season) && season > 0) {
    if (Math.abs(l5 - season) / season >= 0.28) return true;
  }
  if (Number.isFinite(l5Hit) && Number.isFinite(l10Hit) && Math.abs(l5Hit - l10Hit) >= 0.18) return true;
  if (/volatile|cold|slump|inconsistent/i.test(String(prop.strikeoutTrend || prop.formNote || ""))) return true;
  return false;
}

function hasBadMatchupVolatility(prop = {}) {
  const rating = String(prop.matchupRating || "");
  const vol = volatilityTierKey(prop);
  if (rating === "Tough" && vol === "HIGH") return true;
  if (/tough|bad|elite|mismatch/i.test(String(prop.matchupNote || prop.handednessMatchup || "")) && vol === "HIGH") {
    return true;
  }
  const rank = finiteOr(prop.opponentRank, NaN);
  if (Number.isFinite(rank) && rank <= 6 && vol === "HIGH") return true;
  return false;
}

function hasWeatherUncertainty(prop = {}) {
  const note = String(prop.weatherNote || prop.weatherData?.note || "");
  if (!note) return false;
  if (/uncertain|mixed|variable|delay|postpon|wind gust|shifting/i.test(note)) return true;
  if (/rain|shower|storm/i.test(note) && !/clear|dome|closed roof/i.test(note)) return true;
  return false;
}

/** Data support score (0-100) — separate from confidence; measures inputs only. */
export function computeGradingDataQuality(prop = {}, profile = {}) {
  let score = 28;
  const sample = Number(prop.sampleSize ?? profile?.sampleSize ?? 0);
  const verified = Boolean(prop.isVerifiedProjection || prop.hasVerifiedStats || profile?.hasGameLogs);
  if (verified) score += 18;
  if (sample >= 10) score += 16;
  else if (sample >= 8) score += 12;
  else if (sample >= 5) score += 8;
  else if (sample >= 3) score += 3;
  else score -= 6;

  if (prop.hasMatchup || profile?.hasMatchup || prop.matchupNote || profile?.matchupNote) score += 8;
  if (prop.sportsbookComparison?.books >= 2 || prop.lineComparison) score += 6;
  if (Number.isFinite(Number(prop.last5Average ?? profile?.last5Average))) score += 5;
  if (Number.isFinite(Number(prop.seasonAverage ?? profile?.seasonAverage))) score += 4;
  if (prop.weatherNote && !hasWeatherUncertainty(prop)) score += 3;
  if (profile?.probableStarterConfirmed === true || prop.probableStarterConfirmed === true) score += 3;

  if (isRookieOrNewStarter({ ...prop, ...profile })) score -= 8;
  if (hasUncertainInnings({ ...prop, ...profile })) score -= 6;
  if (hasWeatherUncertainty(prop)) score -= 5;
  if (profile?.sparse || profile?.fallback) score -= 12;

  return Math.round(clamp(score, 12, 92));
}

export function collectConfidencePenalties(prop = {}, profile = {}) {
  const merged = { ...profile, ...prop };
  const penalties = [];
  const sample = Number(merged.sampleSize || 0);

  if (sample > 0 && sample < 5) penalties.push({ amount: 8, label: "small MLB sample" });
  else if (sample >= 5 && sample < 8) penalties.push({ amount: 4, label: "limited sample depth" });

  if (isRookieOrNewStarter(merged)) penalties.push({ amount: 6, label: "rookie/new starter" });
  if (hasUncertainInnings(merged)) penalties.push({ amount: 5, label: "uncertain innings" });
  if (hasInconsistentRecentForm(merged)) penalties.push({ amount: 5, label: "inconsistent recent form" });
  if (hasBadMatchupVolatility(merged)) penalties.push({ amount: 6, label: "volatile tough matchup" });
  if (hasWeatherUncertainty(merged)) penalties.push({ amount: 4, label: "weather uncertainty" });
  if (!hasMeaningfulEnrichment(merged)) penalties.push({ amount: 7, label: "thin enrichment" });

  return penalties;
}

export function calibrateRealisticConfidence(rawConfidence, prop = {}, edge = null) {
  const raw = finiteOr(rawConfidence, NaN);
  if (!Number.isFinite(raw)) return null;
  if (typeof raw === "string") return raw;

  let score = Math.round(raw * 0.94 + 50 * 0.06);
  const edgeVal = Math.abs(finiteOr(edge ?? prop.volatilityAdjustedEdge ?? prop.edge, 0));
  const penalties = collectConfidencePenalties(prop);
  const penaltyTotal = penalties.reduce((sum, item) => sum + item.amount, 0);
  score -= Math.min(18, penaltyTotal);

  const elite = isEliteConfidenceEligible(prop, edgeVal);
  let maxCap = elite ? ELITE_CONFIDENCE_CAP : STANDARD_CONFIDENCE_CAP;
  const dq = computeGradingDataQuality(prop);
  if (dq < 45) maxCap = Math.min(maxCap, 58);
  else if (dq < 52) maxCap = Math.min(maxCap, 68);
  if (prop.displayFallback || prop.isFallback || prop.isFallbackProjection) maxCap = Math.min(maxCap, 62);

  score = clamp(score, 45, maxCap);
  return Math.round(score);
}

export function meetsStrongPlayRequirements(prop = {}) {
  if (prop.projectionUnavailable || prop.unverifiedGradeBlocked) return false;
  if (!prop.isVerifiedProjection && !prop.hasVerifiedStats) return false;
  if (!Number.isFinite(Number(prop.projection ?? prop.projectedValue))) return false;

  const sample = Number(prop.sampleSize || 0);
  if (sample < STRONG_PLAY_MIN_SAMPLE) return false;

  const edge = Math.abs(Number(prop.volatilityAdjustedEdge ?? prop.edge ?? 0));
  if (edge < STRONG_PLAY_MIN_EDGE) return false;

  const volTier = volatilityTierKey(prop);
  if (volTier === "HIGH") return false;
  const volNum = finiteOr(prop.volatility ?? prop.manualVolatilityScore, NaN);
  if (Number.isFinite(volNum) && volNum >= 3.2) return false;

  const conf = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  if (conf < STRONG_PLAY_MIN_CONFIDENCE) return false;

  const dq = Number(prop.gradingDataQuality ?? computeGradingDataQuality(prop));
  if (dq < STRONG_PLAY_MIN_DQ) return false;

  const matchupConfirmed =
    prop.matchupRating === "Favorable" ||
    prop.matchupRating === "Playable" ||
    Boolean(prop.hasMatchup) ||
    Boolean(prop.matchupNote && !/tough|bad|elite|mismatch/i.test(String(prop.matchupNote))) ||
    (Number.isFinite(Number(prop.opponentRank)) && Number(prop.opponentRank) >= 18);

  if (!matchupConfirmed) return false;
  if (hasBadMatchupVolatility(prop)) return false;
  if (hasWeatherUncertainty(prop) && edge < 1.4) return false;

  return true;
}

export function resolveStrongPlayTag(prop = {}) {
  return meetsStrongPlayRequirements(prop) ? "Strong Play" : null;
}

export function passesDisplayConfidenceFloor(prop = {}, floor = MIN_DISPLAY_CONFIDENCE) {
  if (isDebugModeEnabled()) return true;
  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  return Number.isFinite(conf) && conf >= floor;
}

export function filterByDisplayConfidenceFloor(props = [], floor = MIN_DISPLAY_CONFIDENCE) {
  return (props || []).filter((prop) => passesDisplayConfidenceFloor(prop, floor));
}
