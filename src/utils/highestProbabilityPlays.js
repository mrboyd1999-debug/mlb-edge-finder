/**
 * Highest Probability Props — relaxed Best Plays qualification and ranking.
 */

import { resolveProjectionValue } from "./projectionQuality.js";
import { normalizeSource } from "./normalizeSource.js";
import { buildPropDedupeKey } from "./displayPropScoring.js";
import { isFakeOrFallbackProp } from "./livePropRender.js";
import { isMinimalRenderableProp } from "./normalizeProp.js";
import {
  BEST_PLAYS_MIN_EDGE,
  BEST_PLAYS_MIN_GAMES,
  BEST_PLAYS_VERIFIED_THRESHOLD,
  buildMarketContextNote,
  enrichBestPlayRankingFields,
  passesBestPlaysFilter,
  resolveEdgeMagnitude,
  resolveLeanDirection,
} from "./bestPlayRanking.js";

export const HIGHEST_PROBABILITY_MIN_CONFIDENCE = BEST_PLAYS_VERIFIED_THRESHOLD;
export const HIGHEST_PROBABILITY_MIN_EDGE = BEST_PLAYS_MIN_EDGE;
export const HIGHEST_PROBABILITY_MAX_PLAYS = 10;
export const HIGHEST_PROBABILITY_TARGET_PLAYS = 5;
export const HIGHEST_PROBABILITY_MIN_VERIFIED_TO_SHOW = 1;

function isRenderableCandidate(prop = {}) {
  if (!prop || prop.isDemoData || isFakeOrFallbackProp(prop)) return false;
  if (prop.isLiveLineOnly) return false;
  return isMinimalRenderableProp(prop);
}

export function enrichBestPlayCandidate(prop = {}) {
  return enrichBestPlayRankingFields(prop);
}

export function filterBestPlayCandidates(props = []) {
  const enriched = (props || []).filter(isRenderableCandidate).map(enrichBestPlayCandidate);
  return enriched.filter(passesBestPlaysFilter);
}

export function sortHighestProbabilityPlays(props = []) {
  return [...props]
    .map((prop) => enrichBestPlayRankingFields(prop))
    .sort((a, b) => {
      const probA = Number(a.verifiedProbability ?? 0);
      const probB = Number(b.verifiedProbability ?? 0);
      if (probB !== probA) return probB - probA;

      const edgeA = Math.abs(Number(a.edgeScore ?? 0));
      const edgeB = Math.abs(Number(b.edgeScore ?? 0));
      if (edgeB !== edgeA) return edgeB - edgeA;

      return Number(b.games ?? b.sampleSize ?? 0) - Number(a.games ?? a.sampleSize ?? 0);
    });
}

export function selectHighestProbabilityPlays(props = [], max = HIGHEST_PROBABILITY_MAX_PLAYS, options = {}) {
  const rawProps = props || [];
  const enriched = rawProps.filter(isRenderableCandidate).map(enrichBestPlayCandidate);
  const filtered = enriched.filter(passesBestPlaysFilter);

  console.log({
    rawProps: rawProps.length,
    analyzed: enriched.length,
    filtered: filtered.length,
  });

  const ranked = sortHighestProbabilityPlays(filtered);
  const seen = new Set();
  const picks = [];

  for (const prop of ranked) {
    if (picks.length >= max) break;
    const key = buildPropDedupeKey(prop);
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(prop);
  }

  if (!picks.length && enriched.length) {
    const relaxed = enriched
      .filter((prop) => {
        const line = Number(prop.line);
        const projection = resolveProjectionValue(prop);
        return Number.isFinite(line) && line > 0 && projection != null && projection > 0;
      })
      .map(enrichBestPlayRankingFields)
      .sort((a, b) => Number(b.verifiedProbability ?? 0) - Number(a.verifiedProbability ?? 0));

    for (const prop of relaxed) {
      if (picks.length >= max) break;
      const key = buildPropDedupeKey(prop);
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ ...prop, verified: false });
    }

    console.log({
      rawProps: rawProps.length,
      analyzed: enriched.length,
      filtered: filtered.length,
      relaxedFallback: picks.length,
    });
  }

  if (options.withMeta) {
    return {
      picks,
      usedVerifiedFallback: picks.length > 0 && !picks.some((row) => row.verified),
      strictEligible: picks.filter((row) => row.verified).length,
    };
  }

  return picks;
}

export function validateHighestProbabilityRejectReason(prop = {}, options = {}) {
  void options;
  const enriched = enrichBestPlayRankingFields(prop);
  if (!isRenderableCandidate(prop)) return "Rejected: not renderable";
  if (!resolveProjectionValue(enriched)) return "Rejected: missing projection";
  if (!passesBestPlaysFilter(enriched)) return "Rejected: below Best Plays floor";
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
  };

  for (const prop of props || []) {
    const enriched = enrichBestPlayRankingFields(prop);
    if (passesBestPlaysFilter(enriched)) {
      counters.eligible += 1;
      continue;
    }

    const projection = resolveProjectionValue(enriched);
    const games = Number(enriched.games ?? enriched.sampleSize ?? 0);
    const edgeScore = Math.abs(Number(enriched.edgeScore ?? 0));

    if (!projection || projection <= 0 || !enriched.line) {
      counters.filteredMissingProjection += 1;
      counters.missingProjection += 1;
    } else if (games < BEST_PLAYS_MIN_GAMES) {
      counters.filteredBadMatch += 1;
      counters.missingLogs += 1;
    } else if (edgeScore < BEST_PLAYS_MIN_EDGE) {
      counters.filteredWeakEdge += 1;
      counters.filteredLowEdge += 1;
      counters.lowEdge += 1;
    } else if (enriched.verifiedProbability < BEST_PLAYS_VERIFIED_THRESHOLD) {
      counters.filteredLowConfidence += 1;
      counters.lowConfidence += 1;
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
  const verifiedNote =
    Number.isFinite(probability) && probability >= BEST_PLAYS_VERIFIED_THRESHOLD
      ? `${probability}% verified`
      : Number.isFinite(probability)
        ? `${probability}% lean`
        : "";
  const leanNote = lean && lean !== "PASS" ? `${lean} · ${edgeMag.toFixed(1)} pt edge` : "";
  return [verifiedNote, leanNote, market, base].filter(Boolean).join(" · ");
}

export function formatHighestProbabilitySource(prop = {}) {
  const src = normalizeSource(prop);
  if (src === "prizepicks") return "PrizePicks";
  if (src === "underdog") return "Underdog";
  return prop.platform || prop.source || "MLB";
}
