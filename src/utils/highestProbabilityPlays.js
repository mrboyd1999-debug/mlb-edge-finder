/**
 * Highest Probability Props — debug-first Best Plays qualification.
 */

import { resolveProjectionValue } from "./projectionQuality.js";
import { normalizeSource } from "./normalizeSource.js";
import { buildPropDedupeKey } from "./displayPropScoring.js";
import { isFakeOrFallbackProp } from "./livePropRender.js";
import { isMinimalRenderableProp } from "./normalizeProp.js";
import {
  BEST_PLAYS_DEBUG_MODE,
  BEST_PLAYS_DEBUG_SAMPLE_SIZE,
  logBestPlaysPipelineStage,
  passesMinimalBestPlaysFilter,
  resolveBestPlayInvalidReason,
  resolveBestPlayPlayerName,
  resolveBestPlayProjection,
  sanitizeProjectionValue,
} from "./bestPlaysPipelineDebug.js";
import {
  buildMarketContextNote,
  enrichBestPlayRankingFields,
  resolveEdgeMagnitude,
  resolveLeanDirection,
} from "./bestPlayRanking.js";

export const HIGHEST_PROBABILITY_MIN_CONFIDENCE = 65;
export const HIGHEST_PROBABILITY_MIN_EDGE = 0.015;
export const HIGHEST_PROBABILITY_MAX_PLAYS = BEST_PLAYS_DEBUG_MODE ? 25 : 10;
export const HIGHEST_PROBABILITY_TARGET_PLAYS = 5;
export const HIGHEST_PROBABILITY_MIN_VERIFIED_TO_SHOW = 1;

function isRenderableCandidate(prop = {}) {
  if (!prop || prop.isDemoData || isFakeOrFallbackProp(prop)) return false;
  return isMinimalRenderableProp(prop);
}

export function enrichBestPlayCandidate(prop = {}) {
  return enrichBestPlayRankingFields(prop);
}

export function sortHighestProbabilityPlays(props = []) {
  return [...props]
    .map((prop) => enrichBestPlayRankingFields(prop))
    .sort((a, b) => {
      const probA = Number(a.verifiedProbability ?? 0);
      const probB = Number(b.verifiedProbability ?? 0);
      if (probB !== probA) return probB - probA;
      const withProjA = resolveBestPlayProjection(a) != null ? 1 : 0;
      const withProjB = resolveBestPlayProjection(b) != null ? 1 : 0;
      if (withProjB !== withProjA) return withProjB - withProjA;
      return Number(b.line || 0) - Number(a.line || 0);
    });
}

function buildDebugSample(enriched = [], max = BEST_PLAYS_DEBUG_SAMPLE_SIZE) {
  return enriched.slice(0, max).map((prop) => ({
    ...enrichBestPlayRankingFields(prop),
    verified: false,
    debugMode: true,
    invalidReason: resolveBestPlayInvalidReason(prop),
  }));
}

function summarizeInvalidReasons(enriched = []) {
  return enriched.reduce((acc, prop) => {
    const reason = resolveBestPlayInvalidReason(prop) || "eligible";
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
}

export function selectHighestProbabilityPlays(props = [], max = HIGHEST_PROBABILITY_MAX_PLAYS, options = {}) {
  const rawProps = props || [];

  logBestPlaysPipelineStage("RAW ODDS:", rawProps.length);

  const normalized = rawProps.filter(isRenderableCandidate);
  logBestPlaysPipelineStage("NORMALIZED:", normalized.length);

  const enriched = normalized.map(enrichBestPlayCandidate);
  logBestPlaysPipelineStage(
    "WITH PROJECTIONS:",
    enriched.filter((p) => resolveBestPlayProjection(p) != null).length
  );

  const filtered = enriched.filter((p) => passesVerifiedBestPlaysFilter(p));
  logBestPlaysPipelineStage("AFTER FILTER:", filtered.length);

  const invalidReasons = summarizeInvalidReasons(enriched);
  logBestPlaysPipelineStage("INVALID REASONS:", invalidReasons);

  const ranked = sortHighestProbabilityPlays(filtered.length ? filtered : enriched);
  const seen = new Set();
  const picks = [];

  for (const prop of ranked) {
    if (picks.length >= max) break;
    const key = buildPropDedupeKey(prop);
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(prop);
  }

  if (!picks.length && BEST_PLAYS_DEBUG_MODE && enriched.length) {
    const sample = buildDebugSample(enriched, max);
    logBestPlaysPipelineStage("DEBUG SAMPLE:", sample.length);
    if (options.withMeta) {
      return {
        picks: sample,
        usedVerifiedFallback: true,
        strictEligible: 0,
        debugMode: true,
        invalidReasons,
        pipelineCounts: {
          rawProps: rawProps.length,
          normalized: normalized.length,
          withProjections: enriched.filter((p) => resolveBestPlayProjection(p) != null).length,
          filtered: filtered.length,
        },
      };
    }
    return sample;
  }

  if (options.withMeta) {
    return {
      picks,
      usedVerifiedFallback: picks.length > 0 && !picks.some((row) => row.verified),
      strictEligible: picks.filter((row) => row.verified).length,
      debugMode: BEST_PLAYS_DEBUG_MODE,
      invalidReasons,
      pipelineCounts: {
        rawProps: rawProps.length,
        normalized: normalized.length,
        withProjections: enriched.filter((p) => sanitizeProjectionValue(p.projection) != null).length,
        filtered: filtered.length,
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
    } else if (/line/.test(reason)) {
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
  const debugNote = prop.invalidReason ? `debug: ${prop.invalidReason}` : "";
  return [debugNote, verifiedNote, leanNote, market, base].filter(Boolean).join(" · ");
}

export function formatHighestProbabilitySource(prop = {}) {
  const src = normalizeSource(prop);
  if (src === "prizepicks") return "PrizePicks";
  if (src === "underdog") return "Underdog";
  return prop.platform || prop.source || "MLB";
}
