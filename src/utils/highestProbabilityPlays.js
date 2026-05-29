/**
 * MLB Projection Candidates — strict verified qualification only.
 */

import { resolveProjectionValue } from "./projectionQuality.js";
import { normalizeSource } from "./normalizeSource.js";
import { buildPropDedupeKey } from "./displayPropScoring.js";
import { isFakeOrFallbackProp } from "./livePropRender.js";
import { isMinimalRenderableProp } from "./normalizeProp.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import {
  BEST_PLAYS_DEBUG_MODE,
  logBestPlaysPipelineStage,
  passesMinimalBestPlaysFilter,
  passesVerifiedBestPlaysFilter,
  resolveBestPlayInvalidReason,
  resolveBestPlayPlayerName,
  resolveBestPlayProjection,
  resolveBestPlayStatSpecificProjection,
  sanitizeProjectionValue,
} from "./bestPlaysPipelineDebug.js";
import { enrichPropsWithTeamLookup } from "./teamEnrichment.js";
import { buildVerificationDashboard } from "./verificationDashboard.js";
import { comparePickRank } from "./conservativeProjection.js";
import {
  buildMarketContextNote,
  enrichBestPlayRankingFields,
  resolveEdgeMagnitude,
  resolveLeanDirection,
} from "./bestPlayRanking.js";

export const HIGHEST_PROBABILITY_MIN_CONFIDENCE = 50;
export const HIGHEST_PROBABILITY_MIN_EDGE = 0.02;
export const HIGHEST_PROBABILITY_FALLBACK_MAX = 10;
export const HIGHEST_PROBABILITY_MAX_PLAYS = 10;
export const HIGHEST_PROBABILITY_TARGET_PLAYS = 5;
export const HIGHEST_PROBABILITY_MIN_VERIFIED_TO_SHOW = 1;

function isRenderableCandidate(prop = {}) {
  if (!prop || prop.isDemoData || isFakeOrFallbackProp(prop)) return false;
  if (resolvePropSport(prop) !== "MLB") return false;
  return isMinimalRenderableProp(prop);
}

export function enrichBestPlayCandidate(prop = {}) {
  return enrichBestPlayRankingFields(prop);
}

export function sortHighestProbabilityPlays(props = []) {
  return [...props].map((prop) => enrichBestPlayRankingFields(prop)).sort(comparePickRank);
}

function summarizeInvalidReasons(enriched = []) {
  return enriched.reduce((acc, prop) => {
    const reason = resolveBestPlayInvalidReason(prop) || "eligible";
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
}

function logRejectionSummary(enriched = []) {
  const reasons = summarizeInvalidReasons(enriched);
  const nonMlb = enriched.filter((p) => resolvePropSport(p) !== "MLB").length;
  const zeroProjection = enriched.filter((p) => {
    const proj = resolveBestPlayProjection(p);
    return proj == null || proj <= 0;
  }).length;
  console.info("[MLB Pipeline] verified plays rejection summary", {
    nonMlb,
    zeroProjection,
    reasons,
  });
}

export function selectTopProjectedFallback(props = [], max = HIGHEST_PROBABILITY_FALLBACK_MAX) {
  return [...(props || [])]
    .filter((prop) => {
      const proj = resolveBestPlayStatSpecificProjection(prop);
      return proj != null && proj > 0 && passesMinimalBestPlaysFilter(prop);
    })
    .sort((a, b) => {
      const confA = Number(a.displayConfidenceScore ?? a.confidenceScore ?? a.confidence ?? 0);
      const confB = Number(b.displayConfidenceScore ?? b.confidenceScore ?? b.confidence ?? 0);
      if (confB !== confA) return confB - confA;
      return resolveEdgeMagnitude(b) - resolveEdgeMagnitude(a);
    })
    .slice(0, max)
    .map((prop) => ({
      ...prop,
      verifiedFallbackPick: true,
      pickTierLabel: prop.pickTierLabel || "Research Candidate",
    }));
}

export function selectHighestProbabilityPlays(props = [], max = HIGHEST_PROBABILITY_MAX_PLAYS, options = {}) {
  const rawProps = props || [];

  logBestPlaysPipelineStage("RAW ODDS:", rawProps.length);

  const normalized = rawProps.filter(isRenderableCandidate);
  logBestPlaysPipelineStage("NORMALIZED:", normalized.length);

  const teamEnriched = enrichPropsWithTeamLookup(normalized, {
    seasonStats: options.seasonStats,
    statsMap: options.statsMap,
    fetchSport: options.fetchSport || "MLB",
  });
  const enriched = teamEnriched.map(enrichBestPlayCandidate);
  const verificationDashboard = buildVerificationDashboard(enriched);
  const withProjections = enriched.filter((p) => {
    const proj = resolveBestPlayStatSpecificProjection(p);
    return proj != null && proj > 0;
  }).length;
  logBestPlaysPipelineStage("WITH PROJECTIONS:", withProjections);

  const displayPool = enriched.filter((p) => {
    const proj = resolveBestPlayStatSpecificProjection(p);
    return proj != null && proj > 0 && passesMinimalBestPlaysFilter(p);
  });
  const verifiedPool = displayPool.filter((p) => passesVerifiedBestPlaysFilter(p));
  const researchCount = displayPool.length - verifiedPool.length;
  logBestPlaysPipelineStage("AFTER FILTER:", displayPool.length);
  logBestPlaysPipelineStage("VERIFIED:", verifiedPool.length);
  logBestPlaysPipelineStage("RESEARCH:", researchCount);

  const invalidReasons = summarizeInvalidReasons(enriched);
  logBestPlaysPipelineStage("INVALID REASONS:", invalidReasons);
  logRejectionSummary(enriched);

  const ranked = sortHighestProbabilityPlays(verifiedPool);
  const seen = new Set();
  const picks = [];

  for (const prop of ranked) {
    if (picks.length >= max) break;
    const key = buildPropDedupeKey(prop);
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({ ...prop, verified: prop.pickTierLabel === "Verified Play" || Boolean(prop.isDisplayPlayable) });
  }

  let usedVerifiedFallback = false;
  if (!picks.length) {
    const fallbackPool = displayPool.length ? displayPool : enriched;
    const fallbackPicks = selectTopProjectedFallback(fallbackPool, HIGHEST_PROBABILITY_FALLBACK_MAX);
    if (fallbackPicks.length) {
      picks.push(...fallbackPicks.slice(0, max));
      usedVerifiedFallback = true;
      logBestPlaysPipelineStage("VERIFIED FALLBACK:", fallbackPicks.length);
    }
  }

  if (options.withMeta) {
    return {
      picks,
      usedVerifiedFallback,
      strictEligible: picks.length,
      debugMode: BEST_PLAYS_DEBUG_MODE,
      invalidReasons,
      verificationDashboard,
      pipelineCounts: {
        rawProps: rawProps.length,
        normalized: normalized.length,
        withProjections,
        filtered: verifiedPool.length,
        displayPool: displayPool.length,
        researchPool: researchCount,
        verifiedPasses: verificationDashboard.verifiedPasses,
        verifiedFailures: verificationDashboard.verifiedFailures,
      },
    };
  }

  return picks;
}

export function validateHighestProbabilityRejectReason(prop = {}, options = {}) {
  void options;
  if (!isRenderableCandidate(prop)) return "Rejected: not renderable";
  if (!passesMinimalBestPlaysFilter(prop)) {
    return `Rejected: ${resolveBestPlayInvalidReason(prop) || "invalid prop"}`;
  }
  if (!passesVerifiedBestPlaysFilter(prop)) {
    return `Rejected: ${resolveBestPlayInvalidReason(prop) || "failed verified filter"}`;
  }
  return "";
}

export function isHighestProbabilityPlay(prop = {}, options = {}) {
  return !validateHighestProbabilityRejectReason(prop, options);
}

export function auditHighestProbabilityProps(props = [], options = {}) {
  void options;
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
    invalidReasons: {},
  };

  for (const prop of props || []) {
    const enriched = enrichBestPlayRankingFields(prop);
    const reason = resolveBestPlayInvalidReason(enriched);
    if (!reason) {
      counters.eligible += 1;
      counters.invalidReasons.eligible = (counters.invalidReasons.eligible || 0) + 1;
      continue;
    }

    counters.invalidReasons[reason] = (counters.invalidReasons[reason] || 0) + 1;
    if (/projection/.test(reason)) {
      counters.filteredMissingProjection += 1;
      counters.missingProjection += 1;
    } else if (/confidence/.test(reason)) {
      counters.filteredLowConfidence += 1;
      counters.lowConfidence += 1;
    } else if (/edge/.test(reason)) {
      counters.filteredWeakEdge += 1;
      counters.lowEdge += 1;
    } else if (/team/.test(reason)) {
      counters.filteredOther += 1;
    } else if (/line|stat|player/.test(reason)) {
      counters.filteredOther += 1;
    } else if (/non-MLB|sport/.test(reason)) {
      counters.filteredOther += 1;
    } else if (/player/.test(reason)) {
      counters.filteredBadMatch += 1;
      counters.badPlayerMatch += 1;
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
  const lean = prop.direction || prop.leanDirection || resolveLeanDirection(prop);
  const edgeMag = resolveEdgeMagnitude(prop);
  const probability = prop.verifiedProbability;
  const verifiedNote = Number.isFinite(probability) ? `${probability}%` : "";
  const leanNote = lean && lean !== "PASS" ? `${lean} · ${edgeMag.toFixed(1)} pt edge` : "";
  return [verifiedNote, leanNote, market, base].filter(Boolean).join(" · ");
}

export function formatHighestProbabilitySource(prop = {}) {
  const src = normalizeSource(prop);
  if (src === "prizepicks") return "PrizePicks";
  if (src === "underdog") return "Underdog";
  return prop.platform || prop.source || "MLB";
}
