/**
 * Highest Probability Props — Best Plays qualification and diversified ranking.
 */

import { resolveProjectionValue } from "./projectionQuality.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";
import { isManualAnalyzerProp } from "./manualPropBuilder.js";
import { isPitcherStrikeoutMarket } from "./topMlbPlaysRanking.js";
import { isMlbPitcherMarket } from "../modules/mlbPitcherData.js";
import { normalizeSource } from "./normalizeSource.js";
import { buildPropDedupeKey } from "./displayPropScoring.js";
import {
  buildMarketContextNote,
  computeBestPlayRankScore,
  enrichBestPlayRankingFields,
  resolveEdgeMagnitude,
  resolveLeanDirection,
} from "./bestPlayRanking.js";

export const HIGHEST_PROBABILITY_MIN_CONFIDENCE = 58;
export const HIGHEST_PROBABILITY_MIN_EDGE = 0.3;
export const HIGHEST_PROBABILITY_MAX_PLAYS = 10;
export const HIGHEST_PROBABILITY_TARGET_PLAYS = 5;
export const HIGHEST_PROBABILITY_MIN_VERIFIED_TO_SHOW = 3;
export const MIN_PITCHER_START_SAMPLE = 3;
export const MIN_HITTER_GAME_SAMPLE = 5;

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isHitterMarket(prop = {}) {
  return !isMlbPitcherMarket(prop.statType || prop.market || prop.propType || "");
}

function projectionIsMissing(prop = {}) {
  const raw = prop.projection ?? prop.projectedValue;
  if (raw === "--" || raw === "—" || raw == null || raw === "") return true;
  const value = resolveProjectionValue(prop);
  return value == null || value <= 0;
}

function hasQualificationExplanation(prop = {}) {
  const parts = [
    prop.whyThisPick,
    prop.analyticsReason,
    prop.qualificationReason,
    prop.marketContext,
    prop.reason,
    ...(Array.isArray(prop.modelReasons) ? prop.modelReasons : []),
    ...(Array.isArray(prop.reasons) ? prop.reasons : []),
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const text = parts.join(" · ");
  if (text.length < 12) return false;
  return !/^(projection unavailable|awaiting|insufficient|no verified|data unavailable)/i.test(text);
}

function statsMatchingFailed(prop = {}) {
  if (prop.fallbackProfile || prop.sparseProfile) return true;
  if (prop.unverifiedGradeBlocked || prop.projectionUnavailable) return true;
  if (!prop.isVerifiedProjection) return true;
  if (!prop.hasVerifiedStats && !prop.hasGameLogs) return true;
  return false;
}

function pitcherStrikeoutRequirementsFailed(prop = {}) {
  if (!isPitcherStrikeoutMarket(prop)) return false;
  const sample = Number(prop.sampleSize || 0);
  if (sample < MIN_PITCHER_START_SAMPLE) return true;
  if (prop.last5Average == null && prop.seasonAverage == null) return true;
  const source = String(prop.projectionSource || "").toLowerCase();
  if (/missing|fallback|line-neutral|manual|estimated/.test(source)) return true;
  const hasLogs = Boolean(
    prop.hasGameLogs || (sample >= MIN_PITCHER_START_SAMPLE && prop.last5Average != null)
  );
  if (!hasLogs) return true;
  return false;
}

function hitterRequirementsFailed(prop = {}) {
  if (!isHitterMarket(prop)) return false;
  const sample = Number(prop.sampleSize || 0);
  const hasLast10 = Number.isFinite(Number(prop.last10Average));
  if (sample < MIN_HITTER_GAME_SAMPLE && !hasLast10) return true;
  return statsMatchingFailed(prop);
}

function isVerifiedProjectionProp(prop = {}) {
  return (
    prop.isVerifiedProjection &&
    !prop.projectionUnavailable &&
    !prop.unverifiedGradeBlocked &&
    resolveProjectionValue(prop) != null
  );
}

export function validateHighestProbabilityRejectReason(prop = {}, options = {}) {
  const minConfidence = options.minConfidence ?? HIGHEST_PROBABILITY_MIN_CONFIDENCE;
  const minEdge = options.minEdge ?? HIGHEST_PROBABILITY_MIN_EDGE;
  const relaxedVerified = options.relaxedVerified === true;

  if (!prop || prop.isDemoData) return "Rejected: demo prop";
  if (prop.manualEntry || isManualAnalyzerProp(prop) || prop.isLiveLineOnly) {
    return "Rejected: manual or live-line-only prop";
  }
  if (prop.isFallback || prop.displayFallback) return "Rejected: fallback prop";
  if (projectionIsMissing(prop)) return "Rejected: missing projection";
  if (statsMatchingFailed(prop)) return "Rejected: player stats not matched";
  if (pitcherStrikeoutRequirementsFailed(prop)) return "Rejected: pitcher game logs insufficient";
  if (hitterRequirementsFailed(prop)) return "Rejected: hitter sample or team match insufficient";

  const edgeMag = resolveEdgeMagnitude(prop);
  const lean = resolveLeanDirection(prop);
  if (lean === "PASS") return "Rejected: projection too close to line";
  if (!Number.isFinite(edgeMag) || edgeMag < minEdge) {
    return relaxedVerified
      ? `Rejected: edge magnitude below ${minEdge}`
      : `Rejected: edge below +${minEdge}`;
  }

  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(conf) || conf < minConfidence) {
    return relaxedVerified
      ? `Rejected: confidence below ${minConfidence}%`
      : `Rejected: confidence below ${minConfidence}%`;
  }

  if (!relaxedVerified && !hasQualificationExplanation(prop)) return "Rejected: no projection explanation";
  if (prop.passPlay || prop.noEdge) return "Rejected: model pass";

  return "";
}

export function isHighestProbabilityPlay(prop = {}, options = {}) {
  return !validateHighestProbabilityRejectReason(prop, options);
}

export function sortHighestProbabilityPlays(props = []) {
  return [...props]
    .map((prop) => enrichBestPlayRankingFields(prop))
    .sort((a, b) => {
      const rankA = finiteOr(a.rankScore, computeBestPlayRankScore(a));
      const rankB = finiteOr(b.rankScore, computeBestPlayRankScore(b));
      if (rankB !== rankA) return rankB - rankA;

      const edgeA = resolveEdgeMagnitude(a);
      const edgeB = resolveEdgeMagnitude(b);
      if (edgeB !== edgeA) return edgeB - edgeA;

      const confA = finiteOr(a.confidenceScore ?? a.confidence, 0);
      const confB = finiteOr(b.confidenceScore ?? b.confidence, 0);
      if (confB !== confA) return confB - confA;

      const verifiedA = isVerifiedSportsbookProp(a) ? 1 : 0;
      const verifiedB = isVerifiedSportsbookProp(b) ? 1 : 0;
      if (verifiedB !== verifiedA) return verifiedB - verifiedA;

      return Number(b.sampleSize || 0) - Number(a.sampleSize || 0);
    });
}

function pickDiversifiedBestPlays(ranked = [], max = HIGHEST_PROBABILITY_MAX_PLAYS) {
  const picks = [];
  const seen = new Set();
  const add = (prop) => {
    if (!prop || picks.length >= max) return;
    const key = buildPropDedupeKey(prop);
    if (seen.has(key)) return;
    seen.add(key);
    picks.push(prop);
  };

  const overs = ranked.filter((p) => p.leanDirection === "OVER");
  const unders = ranked.filter((p) => p.leanDirection === "UNDER");
  const byEdge = [...ranked].sort((a, b) => resolveEdgeMagnitude(b) - resolveEdgeMagnitude(a));
  const byConf = [...ranked].sort(
    (a, b) => finiteOr(b.confidenceScore ?? b.confidence, 0) - finiteOr(a.confidenceScore ?? a.confidence, 0)
  );

  add(overs.sort((a, b) => resolveEdgeMagnitude(b) - resolveEdgeMagnitude(a))[0]);
  add(unders.sort((a, b) => resolveEdgeMagnitude(b) - resolveEdgeMagnitude(a))[0]);
  add(byConf[0]);
  add(byEdge[0]);
  ranked.forEach((prop) => add(prop));
  return picks.slice(0, max);
}

function selectVerifiedProjectionFallback(props = [], max = HIGHEST_PROBABILITY_MAX_PLAYS) {
  const verified = (props || [])
    .filter(isVerifiedProjectionProp)
    .map((prop) => enrichBestPlayRankingFields(prop))
    .filter((prop) => resolveLeanDirection(prop) && resolveLeanDirection(prop) !== "PASS")
    .sort((a, b) => computeBestPlayRankScore(b) - computeBestPlayRankScore(a));

  if (verified.length < HIGHEST_PROBABILITY_MIN_VERIFIED_TO_SHOW) return [];
  return pickDiversifiedBestPlays(verified, max);
}

export function selectHighestProbabilityPlays(props = [], max = HIGHEST_PROBABILITY_MAX_PLAYS, options = {}) {
  const seen = new Set();
  const eligible = [];
  for (const prop of props || []) {
    const enriched = enrichBestPlayRankingFields(prop);
    if (!isHighestProbabilityPlay(enriched, options)) continue;
    const key = buildPropDedupeKey(enriched);
    if (seen.has(key)) continue;
    seen.add(key);
    eligible.push(enriched);
  }

  const ranked = sortHighestProbabilityPlays(eligible);
  const strictPicks = ranked.length ? pickDiversifiedBestPlays(ranked, max) : [];

  if (strictPicks.length >= HIGHEST_PROBABILITY_MIN_VERIFIED_TO_SHOW) {
    if (options.withMeta) {
      return { picks: strictPicks, usedVerifiedFallback: false, strictEligible: strictPicks.length };
    }
    return strictPicks;
  }

  const verifiedFallback = selectVerifiedProjectionFallback(props, max);
  if (verifiedFallback.length >= HIGHEST_PROBABILITY_MIN_VERIFIED_TO_SHOW) {
    if (options.withMeta) {
      return { picks: verifiedFallback, usedVerifiedFallback: true, strictEligible: strictPicks.length };
    }
    return verifiedFallback;
  }

  if (options.withMeta) {
    return { picks: strictPicks, usedVerifiedFallback: false, strictEligible: strictPicks.length };
  }
  return strictPicks;
}

export function auditHighestProbabilityProps(props = [], options = {}) {
  const counters = {
    filteredMissingProjection: 0,
    filteredLowConfidence: 0,
    filteredBadMatch: 0,
    filteredLowEdge: 0,
    filteredWeakEdge: 0,
    filteredOther: 0,
    eligible: 0,
    attempted: (props || []).length,
    missingProjection: 0,
    missingLogs: 0,
    lowConfidence: 0,
    lowEdge: 0,
    badPlayerMatch: 0,
  };

  for (const prop of props || []) {
    const enriched = enrichBestPlayRankingFields(prop);
    const reason = validateHighestProbabilityRejectReason(enriched, options);
    if (!reason) {
      counters.eligible += 1;
      continue;
    }
    const text = reason.toLowerCase();
    if (/projection|missing|unavailable|insufficient stats|zero edge|too close/.test(text)) {
      counters.filteredMissingProjection += 1;
      counters.missingProjection += 1;
    } else if (/confidence/.test(text)) {
      counters.filteredLowConfidence += 1;
      counters.lowConfidence += 1;
    } else if (/match|player|team|role|pitcher|hitter|stats not matched/.test(text)) {
      counters.filteredBadMatch += 1;
      counters.badPlayerMatch += 1;
    } else if (/edge/.test(text)) {
      counters.filteredLowEdge += 1;
      counters.filteredWeakEdge += 1;
      counters.lowEdge += 1;
    } else if (/game log|sample|team match/.test(text)) {
      counters.missingLogs += 1;
      counters.filteredOther += 1;
    } else {
      counters.filteredOther += 1;
    }
  }

  return counters;
}

export function buildHighestProbabilityQualifyReason(prop = {}) {
  const market = buildMarketContextNote(prop) || prop.marketContext || "";
  const base =
    prop.analyticsReason ||
    prop.whyThisPick ||
    prop.qualificationReason ||
    (prop.modelReasons || []).slice(0, 2).join(" · ") ||
    prop.reason ||
    "";
  const lean = prop.leanDirection || resolveLeanDirection(prop);
  const edgeMag = resolveEdgeMagnitude(prop);
  const leanNote = lean && lean !== "PASS" ? `${lean} lean · ${edgeMag.toFixed(1)} pt edge` : "";
  return [leanNote, market, base].filter(Boolean).join(" · ");
}

export function formatHighestProbabilitySource(prop = {}) {
  const src = normalizeSource(prop);
  if (src === "prizepicks") return "PrizePicks";
  if (src === "underdog") return "Underdog";
  return prop.platform || prop.source || "MLB";
}
