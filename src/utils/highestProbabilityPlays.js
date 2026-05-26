/**
 * Highest Probability Props — strict Best Plays gate for verified MLB edges only.
 */

import { resolveProjectionValue } from "./projectionQuality.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";
import { isManualAnalyzerProp } from "./manualPropBuilder.js";
import { isPitcherStrikeoutMarket } from "./topMlbPlaysRanking.js";
import { isMlbPitcherMarket } from "../modules/mlbPitcherData.js";
import { normalizeSource } from "./normalizeSource.js";
import { buildPropDedupeKey } from "./displayPropScoring.js";

export const HIGHEST_PROBABILITY_MIN_CONFIDENCE = 65;
export const HIGHEST_PROBABILITY_MIN_EDGE = 0.5;
export const HIGHEST_PROBABILITY_MAX_PLAYS = 10;
export const HIGHEST_PROBABILITY_TARGET_PLAYS = 5;
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
  const hasTeamContext = Boolean(
    String(prop.team || "").trim() ||
      String(prop.opponent || "").trim() ||
      String(prop.matchup || "").trim()
  );
  if (!hasTeamContext && !prop.mlbId && !prop.playerId) return true;
  return statsMatchingFailed(prop);
}

export function validateHighestProbabilityRejectReason(prop = {}) {
  if (!prop || prop.isDemoData) return "Rejected: demo prop";
  if (prop.manualEntry || isManualAnalyzerProp(prop) || prop.isLiveLineOnly) {
    return "Rejected: manual or live-line-only prop";
  }
  if (prop.isFallback || prop.displayFallback) return "Rejected: fallback prop";
  if (projectionIsMissing(prop)) return "Rejected: missing projection";
  if (statsMatchingFailed(prop)) return "Rejected: player stats not matched";
  if (pitcherStrikeoutRequirementsFailed(prop)) return "Rejected: pitcher game logs insufficient";
  if (hitterRequirementsFailed(prop)) return "Rejected: hitter sample or team match insufficient";

  const edge = finiteOr(prop.edge, NaN);
  if (!Number.isFinite(edge) || edge < HIGHEST_PROBABILITY_MIN_EDGE) {
    return "Rejected: edge below +0.5";
  }

  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(conf) || conf < HIGHEST_PROBABILITY_MIN_CONFIDENCE) {
    return "Rejected: confidence below 65%";
  }

  if (!hasQualificationExplanation(prop)) return "Rejected: no projection explanation";

  if (prop.passPlay || prop.noEdge) return "Rejected: model pass";

  return "";
}

export function isHighestProbabilityPlay(prop = {}) {
  return !validateHighestProbabilityRejectReason(prop);
}

export function sortHighestProbabilityPlays(props = []) {
  return [...props].sort((a, b) => {
    const confA = finiteOr(a.confidenceScore ?? a.confidence, 0);
    const confB = finiteOr(b.confidenceScore ?? b.confidence, 0);
    if (confB !== confA) return confB - confA;

    const edgeA = Math.max(0, finiteOr(a.edge, 0));
    const edgeB = Math.max(0, finiteOr(b.edge, 0));
    if (edgeB !== edgeA) return edgeB - edgeA;

    const verifiedA = isVerifiedSportsbookProp(a) ? 1 : 0;
    const verifiedB = isVerifiedSportsbookProp(b) ? 1 : 0;
    if (verifiedB !== verifiedA) return verifiedB - verifiedA;

    const sampleA = Number(a.sampleSize || 0);
    const sampleB = Number(b.sampleSize || 0);
    return sampleB - sampleA;
  });
}

export function selectHighestProbabilityPlays(props = [], max = HIGHEST_PROBABILITY_MAX_PLAYS) {
  const seen = new Set();
  const eligible = [];
  for (const prop of props || []) {
    if (!isHighestProbabilityPlay(prop)) continue;
    const key = buildPropDedupeKey(prop);
    if (seen.has(key)) continue;
    seen.add(key);
    eligible.push(prop);
  }
  return sortHighestProbabilityPlays(eligible).slice(0, max);
}

export function auditHighestProbabilityProps(props = []) {
  const counters = {
    filteredMissingProjection: 0,
    filteredLowConfidence: 0,
    filteredBadMatch: 0,
    filteredLowEdge: 0,
    filteredOther: 0,
    eligible: 0,
    attempted: (props || []).length,
  };

  for (const prop of props || []) {
    const reason = validateHighestProbabilityRejectReason(prop);
    if (!reason) {
      counters.eligible += 1;
      continue;
    }
    const text = reason.toLowerCase();
    if (/projection|missing|unavailable|insufficient stats|game log|zero edge|too close/.test(text)) {
      counters.filteredMissingProjection += 1;
    } else if (/confidence/.test(text)) {
      counters.filteredLowConfidence += 1;
    } else if (/match|player|team|role|pitcher|hitter/.test(text)) {
      counters.filteredBadMatch += 1;
    } else if (/edge/.test(text)) {
      counters.filteredLowEdge += 1;
    } else {
      counters.filteredOther += 1;
    }
  }

  return counters;
}

export function buildHighestProbabilityQualifyReason(prop = {}) {
  return (
    prop.analyticsReason ||
    prop.whyThisPick ||
    prop.qualificationReason ||
    (prop.modelReasons || []).slice(0, 2).join(" · ") ||
    prop.reason ||
    ""
  );
}

export function formatHighestProbabilitySource(prop = {}) {
  const src = normalizeSource(prop);
  if (src === "prizepicks") return "PrizePicks";
  if (src === "underdog") return "Underdog";
  return prop.platform || prop.source || "MLB";
}
