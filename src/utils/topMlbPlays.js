import { isLooseDisplayProp, dedupeLooseProps } from "./safeModePipeline.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { filterUnderdogPropsBySport, filterResolvedSportProps } from "./underdogSportDetection.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";
import { enrichPropWithSideEvaluation } from "./sideEvaluationEngine.js";
import { normalizeSource } from "./normalizeSource.js";
import { isTopMlbPlayCandidate } from "./projectionQuality.js";
import { validatePropSanityRejectReason } from "./propSanity.js";
import { unsupportedMarketRejectReason } from "./mlbAllowedMarkets.js";
import {
  auditTopMlbPlayRankableRejections,
  isLiveLineRankable,
  isRelaxedRankable,
  isRelaxedRankableOrLiveLine,
  isTopMlbPlayRankable,
} from "./mlbRankableProp.js";
import { sortTopMlbPlays } from "./topMlbPlaysRanking.js";
import { LIVE_BOARD_UNAVAILABLE_MESSAGE } from "./liveBoardLoading.js";
import { preparePropsForRanking } from "./mlbPropPrep.js";
import { buildPipelineDebugSnapshot, logPipelineStage } from "./mlbPipelineDebug.js";
import { countLiveUnifiedProps } from "./unifiedPropNormalizer.js";
import { buildLiveFetchFailureSummary } from "./liveFetchAudit.js";
import { isMinimalRenderableProp } from "./normalizeProp.js";
import { filterQualityMlbProps, auditQualityMlbProps } from "./mlbPropQualityFilter.js";
import { isFakeOrFallbackProp } from "./livePropRender.js";
import {
  HIGHEST_PROBABILITY_MAX_PLAYS,
  HIGHEST_PROBABILITY_TARGET_PLAYS,
  HIGHEST_PROBABILITY_MIN_VERIFIED_TO_SHOW,
  selectHighestProbabilityPlays,
  auditHighestProbabilityProps,
  buildHighestProbabilityQualifyReason,
} from "./highestProbabilityPlays.js";
import {
  logProjectionFilterSummary,
  resetProjectionFilterCounters,
  areProjectionsComplete,
  syncBestPlaysFilterAudit,
} from "../services/mlbProjectionPipelineLog.js";

export const TOP_MLB_PLAYS_LIMIT = HIGHEST_PROBABILITY_MAX_PLAYS;
export const SECTION_BEST_PLAYS = HIGHEST_PROBABILITY_MAX_PLAYS;
export const MAX_PLAYER_APPEARANCES = 2;
export const WAITING_FOR_PROJECTIONS_MESSAGE = "Waiting for verified projections…";
export const FALLBACK_PROJECTIONS_LABEL = "Relaxed ranking applied";

function isPrizePicksOrUnderdog(prop = {}) {
  const src = normalizeSource(prop);
  return src === "prizepicks" || src === "underdog";
}

function isSportsDataProjectionProp(prop = {}) {
  return Boolean(prop?.isSportsDataFallback) || normalizeSource(prop) === "sportsdataio";
}

function mergeInputProps(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const mlbDisplay = filterResolvedSportProps(displayProps, "MLB", { selectedSportTab: "MLB" });
  const ppRaw = filterResolvedSportProps(rawProps || [], "MLB", { selectedSportTab: "MLB" });
  const udMlb = filterUnderdogPropsBySport(parsedUnderdogProps || [], "MLB");
  return dedupeLooseProps([...mlbDisplay, ...ppRaw, ...udMlb].filter(isLooseDisplayProp));
}

function countLiveVerifiedProps(props = []) {
  return (props || []).filter((prop) => !prop.isDemoData && isVerifiedSportsbookProp(prop)).length;
}

function buildBestPlaysCandidatePool(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const merged = preparePropsForRanking(mergeInputProps(displayProps, rawProps, parsedUnderdogProps));
  const pool = merged.filter((prop) => !isFakeOrFallbackProp(prop) && isMinimalRenderableProp(prop));
  logPipelineStage("pool.bestPlaysCandidates", { count: pool.length, live: countLiveVerifiedProps(pool) });
  return pool;
}

function buildTopMlbPlayPool(displayProps = [], rawProps = [], parsedUnderdogProps = [], { relaxed = false } = {}) {
  const merged = preparePropsForRanking(mergeInputProps(displayProps, rawProps, parsedUnderdogProps));

  logPipelineStage("pool.merged", { count: merged.length, live: countLiveVerifiedProps(merged) });

  const pool = [];
  merged.forEach((prop) => {
    if (isFakeOrFallbackProp(prop)) return;
    if (!isMinimalRenderableProp(prop)) return;
    if (!relaxed && unsupportedMarketRejectReason(prop)) return;
    if (!relaxed && validatePropSanityRejectReason(prop)) return;
    pool.push(prop);
  });

  logPipelineStage("pool.filtered", { count: pool.length, relaxed });
  const qualityAudit = auditQualityMlbProps(pool);
  const qualityFiltered = filterQualityMlbProps(pool);
  logPipelineStage("pool.quality", { in: pool.length, out: qualityFiltered.length, ...qualityAudit });
  qualityFiltered._qualityAudit = qualityAudit;
  return qualityFiltered;
}

export function auditTopMlbPlayPool(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const candidates = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps, { relaxed: true });
  const enriched = candidates.map((prop) => enrichPropWithSideEvaluation(prop));
  const strict = auditTopMlbPlayRankableRejections(enriched, { relaxed: false });
  const relaxedAudit = auditTopMlbPlayRankableRejections(enriched, { relaxed: true });
  return { strict, relaxed: relaxedAudit, accepted: strict.accepted, rejected: strict.rejected, reasons: strict.reasons };
}

function enrichLiveLineProp(prop = {}) {
  const enriched = enrichPropWithSideEvaluation(prop);
  if (!enriched.sideEvaluation?.pass) return enriched;

  const platformSide = String(prop.side || prop.pick || prop.bestPick || "under").toLowerCase();
  const recommendedSide = platformSide.includes("over") ? "OVER" : "UNDER";

  return {
    ...enriched,
    recommendedSide,
    side: recommendedSide === "OVER" ? "over" : "under",
    pick: recommendedSide === "OVER" ? "over" : "under",
    confidence: null,
    confidenceScore: null,
    edge: null,
    sideEvaluation: {
      ...enriched.sideEvaluation,
      recommendedSide,
      pass: false,
      edge: null,
      confidence: null,
      reason: "Live platform line — no verified projection",
    },
    isLiveLineOnly: true,
  };
}

function enrichForBoard(prop = {}) {
  const withEval = enrichPropWithSideEvaluation(prop);
  if (!withEval.sideEvaluation?.pass) return withEval;
  if (isLiveLineRankable(prop)) return enrichLiveLineProp(prop);
  return withEval;
}

function annotateTopPlay(prop, rank, { allowRelaxed = false, allowLiveLine = false } = {}) {
  const enriched = enrichForBoard(prop);
  const rankable =
    enriched.isDemoData ||
    enriched.isSportsDataFallback ||
    (allowLiveLine && isLiveLineRankable(enriched)) ||
    (allowRelaxed ? isRelaxedRankableOrLiveLine(enriched) : isTopMlbPlayRankable(enriched));
  if (!rankable && !enriched.isDemoData) return null;
  return withPlayerImageUrl({
    ...enriched,
    topMlbPlayRank: rank,
    reason:
      enriched.analyticsReason ||
      enriched.sideEvaluation?.reason ||
      enriched.premiumWhySummary ||
      buildAnalyticsReason(enriched) ||
      "",
  });
}

function dedupeSectionPicks(picks = []) {
  const seen = new Set();
  const out = [];
  picks.forEach((prop) => {
    const key = prop.id || `${prop.playerName}|${prop.statType}|${prop.line}|${prop.source}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(prop);
  });
  return out;
}

function fillMinimum(existing = [], source = [], limit = 0, { allowRelaxed = false, allowLiveLine = false, allowDemo = false } = {}) {
  const out = [...existing];
  const seen = new Set(out.map((p) => p.id));
  source.forEach((prop) => {
    if (out.length >= limit) return;
    if (!allowDemo && prop.isDemoData) return;
    const annotated = annotateTopPlay(prop, out.length + 1, { allowRelaxed, allowLiveLine });
    if (!annotated || seen.has(annotated.id)) return;
    seen.add(annotated.id);
    out.push(annotated);
  });
  return out.slice(0, limit);
}

function pickHighestBy(props = [], field = "edge") {
  const sorted = [...props].sort((a, b) => {
    const av = Number(a[field] ?? a.confidenceScore ?? a.confidence ?? 0);
    const bv = Number(b[field] ?? b.confidenceScore ?? b.confidence ?? 0);
    return bv - av;
  });
  return sorted[0] || null;
}

function playerKey(prop = {}) {
  return String(prop.playerName || prop.player || "")
    .trim()
    .toLowerCase();
}

function pickSafestPlays(ranked = [], limit = SECTION_BEST_PLAYS, annotateOpts = {}) {
  return [...ranked]
    .filter((prop) => {
      const conf = Number(prop.confidenceScore ?? prop.confidence ?? 0);
      return Number.isFinite(conf) && conf >= GOBLIN_MIN_CONFIDENCE - 8;
    })
    .sort(
      (a, b) =>
        Number(b.confidenceScore ?? b.confidence ?? 0) - Number(a.confidenceScore ?? a.confidence ?? 0) ||
        Math.abs(Number(b.edge ?? 0)) - Math.abs(Number(a.edge ?? 0))
    )
    .slice(0, limit)
    .map((prop, idx) => annotateTopPlay(prop, idx + 1, annotateOpts))
    .filter(Boolean);
}

function statKey(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "")
    .trim()
    .toLowerCase();
}

export function buildRankableParlayPicks(ranked = [], limit = SECTION_PARLAY) {
  const selected = [];
  const usedPlayers = new Set();
  const usedStats = new Set();

  ranked.forEach((prop) => {
    if (selected.length >= limit) return;
    const pk = playerKey(prop);
    const sk = statKey(prop);
    if (usedPlayers.has(pk) || usedStats.has(`${pk}|${sk}`)) return;
    usedPlayers.add(pk);
    usedStats.add(`${pk}|${sk}`);
    selected.push({
      ...prop,
      categorySource: "parlayBuilder",
      recommendationType: "4-Man Builder",
    });
  });

  return selected;
}

function rankPool(pool = [], { relaxed = false, liveLine = false } = {}) {
  const enriched = pool.map((prop) => enrichForBoard(prop));
  const filtered = enriched.filter((prop) => {
    if (prop.isDemoData) return true;
    if (liveLine && isLiveLineRankable(prop)) return true;
    return relaxed ? isRelaxedRankableOrLiveLine(prop) : isTopMlbPlayRankable(prop);
  });
  const sorted = sortTopMlbPlays(filtered, { relaxed: relaxed || liveLine });
  return prepareRanked(sorted, { allowRelaxed: relaxed || liveLine, allowLiveLine: liveLine });
}

function prepareRanked(sorted = [], { allowRelaxed = false, allowLiveLine = false } = {}) {
  return sorted
    .map((prop, idx) => annotateTopPlay(prop, idx + 1, { allowRelaxed, allowLiveLine }))
    .filter(Boolean);
}

export function resolveTopMlbPlays(displayProps = [], rawProps = [], parsedUnderdogProps = [], limit = TOP_MLB_PLAYS_LIMIT) {
  const board = resolveTopMlbPlaySections(displayProps, rawProps, parsedUnderdogProps);
  return dedupeSectionPicks(board.sections.flatMap((section) => section.picks)).slice(0, limit);
}

function annotateHighestProbabilityPlay(prop, rank) {
  if (!prop) return null;
  return withPlayerImageUrl({
    ...prop,
    topMlbPlayRank: rank,
    qualifyReason: buildHighestProbabilityQualifyReason(prop),
    reason: buildHighestProbabilityQualifyReason(prop),
  });
}

export function resolveTopMlbPlaySections(
  displayProps = [],
  rawProps = [],
  parsedUnderdogProps = [],
  options = {}
) {
  const sourceStatus = options.sourceStatus || {};
  const lastUpdated = options.lastUpdated || "";
  const mergedInput = mergeInputProps(displayProps, rawProps, parsedUnderdogProps);
  const liveVerifiedCount = countLiveVerifiedProps(mergedInput);
  const fetchFailureReasons =
    options.fetchFailureReasons?.length > 0
      ? options.fetchFailureReasons
      : buildLiveFetchFailureSummary(options.debugInfo?.sources || sourceStatus);

  logPipelineStage("fetch.input", {
    display: displayProps.length,
    raw: rawProps.length,
    underdog: parsedUnderdogProps.length,
    liveVerified: liveVerifiedCount,
  });

  const candidatePool = buildBestPlaysCandidatePool(displayProps, rawProps, parsedUnderdogProps);
  const strictPool = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps, { relaxed: false });
  const qualityAudit = strictPool._qualityAudit || auditQualityMlbProps(candidatePool);
  resetProjectionFilterCounters();
  const playAudit = auditHighestProbabilityProps(candidatePool);
  syncBestPlaysFilterAudit(playAudit);
  const filterDiagnostics = {
    ...playAudit,
    qualityFilter: qualityAudit,
  };
  const strictEligible = playAudit.eligible || 0;
  const selection = selectHighestProbabilityPlays(candidatePool, HIGHEST_PROBABILITY_MAX_PLAYS, {
    withMeta: true,
  });
  let highestPicks = (selection.picks || []).map((prop, idx) => annotateHighestProbabilityPlay(prop, idx + 1));

  filterDiagnostics.usedVerifiedFallback = Boolean(selection.usedVerifiedFallback);

  filterDiagnostics.selected = highestPicks.length;
  filterDiagnostics.eligible = strictEligible;
  filterDiagnostics.filteredOut =
    playAudit.filteredMissingProjection +
    playAudit.filteredLowConfidence +
    playAudit.filteredWeakEdge +
    playAudit.filteredBadMatch +
    playAudit.filteredOther;
  logProjectionFilterSummary("Best Plays filter diagnostics");

  logPipelineStage("rank.highestProbability", { pool: strictPool.length, ranked: highestPicks.length });

  const sections = [
    {
      id: "highest-probability",
      title: "Highest Probability Props",
      eyebrow: "Top MLB prop edges ranked by verified probability · MED confidence allowed",
      picks: highestPicks.filter(Boolean),
    },
  ];

  const audit = auditTopMlbPlayRankableRejections(
    strictPool.map((prop) => enrichPropWithSideEvaluation(prop)),
    { relaxed: false }
  );

  const pipelineDebug = buildPipelineDebugSnapshot({
    rawProps: rawProps,
    parsedProps: mergedInput,
    pool: strictPool,
    ranked: highestPicks,
    rejectedAudit: audit,
    sourceStatus,
    lastUpdated,
    usedFallback: false,
    fallbackLabel: "",
    livePropCount: countLiveUnifiedProps(highestPicks) || displayProps.length,
    fetchFailureReasons,
    isLive: liveVerifiedCount > 0,
  });

  logPipelineStage("render.final", {
    sections: sections.map((s) => ({ id: s.id, count: s.picks.length })),
    usedFallback: false,
    liveVerified: liveVerifiedCount,
  });

  return {
    waitingForProjections: highestPicks.length === 0 && !areProjectionsComplete(),
    usedFallback: false,
    fallbackLabel: "",
    filterDiagnostics,
    showFilterDiagnostics: highestPicks.length < HIGHEST_PROBABILITY_TARGET_PLAYS,
    fetchFailureReasons:
      fetchFailureReasons.length || highestPicks.length
        ? fetchFailureReasons
        : liveVerifiedCount === 0
          ? [LIVE_BOARD_UNAVAILABLE_MESSAGE]
          : fetchFailureReasons,
    isLive: liveVerifiedCount > 0,
    pipelineDebug,
    sections,
  };
}
