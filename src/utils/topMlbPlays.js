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
import { highestProbabilityLabel, qualifiesAsHighestProbabilityPick } from "./conservativeProjection.js";
import {
  HIGHEST_PROBABILITY_MAX_PLAYS,
  HIGHEST_PROBABILITY_TARGET_PLAYS,
  HIGHEST_PROBABILITY_MIN_VERIFIED_TO_SHOW,
  selectHighestProbabilityPlays,
  auditHighestProbabilityProps,
  buildHighestProbabilityQualifyReason,
} from "./highestProbabilityPlays.js";
import { NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE } from "./verifiedTierSystem.js";
import {
  logProjectionFilterSummary,
  resetProjectionFilterCounters,
  areProjectionsComplete,
  syncBestPlaysFilterAudit,
} from "../services/mlbProjectionPipelineLog.js";
import { enrichMlbPropsBatch } from "../services/mlb/mlbEnrichmentPipeline.js";
import { enrichPropsWithTeamLookup } from "./teamEnrichment.js";
import { attachHistoricalStatsToProps } from "./historicalStatsLoader.js";
import {
  mergeProjectionsOntoProps,
  logPipelineMergeDiagnostics,
} from "../services/mlb/projectionMergePipeline.js";
import { enrichBestPlayRankingFields } from "./bestPlayRanking.js";
import { resolveBestPlayProjection, PROJECTION_JOIN_DEBUG, passesVerifiedBestPlaysFilter } from "./bestPlaysPipelineDebug.js";
import { compareBestPlaysRank } from "./bestPlayRankingScore.js";
import {
  dedupeByPlayerMarketBestScore,
  buildTopSectionPicks,
  compareHighestEdgePlaysRank,
  compareValueSidePlaysRank,
  TOP_SECTION_LIMIT,
  passesTopFiveBestPlayGate,
  buildSafestPlaysSection,
  buildValueUndersSection,
  selectOverallPlay,
  buildOverallPlayExplanation,
  buildTopBestPlaysPicks,
} from "./boardQuality.js";
import {
  selectStartupProjectionCandidates,
  STARTUP_PROJECTION_CANDIDATE_LIMIT,
} from "./startupPerformance.js";

export const TOP_MLB_PLAYS_LIMIT = HIGHEST_PROBABILITY_MAX_PLAYS;
export const SECTION_BEST_PLAYS = HIGHEST_PROBABILITY_MAX_PLAYS;
export const TOP_BEST_PLAYS_LIMIT = 10;
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

function buildNormalizedBestPlaysPool(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const merged = mergeInputProps(displayProps, rawProps, parsedUnderdogProps);
  return merged.filter((prop) => !isFakeOrFallbackProp(prop) && isMinimalRenderableProp(prop));
}

function buildBestPlaysCandidatePool(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const pool = buildNormalizedBestPlaysPool(displayProps, rawProps, parsedUnderdogProps);
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

export { dedupeByPlayerMarketBestScore } from "./boardQuality.js";

export function buildRankableParlayPicks(ranked = [], limit = SECTION_BEST_PLAYS) {
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
  const label =
    prop.verifiedTier === "A" && prop.isHighestProbabilityPick
      ? "Highest Probability Pick"
      : highestProbabilityLabel(prop);
  return withPlayerImageUrl({
    ...prop,
    topMlbPlayRank: rank,
    highestProbabilityLabel: label,
    isHighestProbabilityPick: prop.verifiedTier === "A" && Boolean(prop.isHighestProbabilityPick),
    qualifyReason: prop.rankingReason || buildHighestProbabilityQualifyReason(prop),
    reason: prop.rankingReason || buildHighestProbabilityQualifyReason(prop),
    bettingLabel: label,
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

  const normalizedPool = buildBestPlaysCandidatePool(displayProps, rawProps, parsedUnderdogProps);

  const mergeContext = {
    seasonStats: options.sportsDataSeasonStats || [],
    statsMap: options.statsMap || null,
  };
  const initialMerge = mergeProjectionsOntoProps(normalizedPool, mergeContext);
  const mergeDiagnostics = logPipelineMergeDiagnostics(
    "[MLB Best Plays Pipeline] post-merge diagnostics",
    initialMerge.props,
    initialMerge.debug
  );

  const enrichment = enrichMlbPropsBatch(initialMerge.props, {
    ...mergeContext,
    skipInitialMerge: true,
    initialMergeDebug: initialMerge.debug,
    options: options.projectionOptions || {},
  });
  const enrichedPool = enrichment.props || initialMerge.props;
  const mergeDebug = enrichment.debug?.merge || initialMerge.debug;

  const withProjections = enrichedPool.filter((p) => {
    const proj = resolveBestPlayProjection(p);
    return proj != null && proj > 0;
  }).length;
  void withProjections;

  const preparedPool = enrichPropsWithTeamLookup(preparePropsForRanking(enrichedPool), {
    seasonStats: mergeContext.seasonStats,
    statsMap: mergeContext.statsMap,
    fetchSport: "MLB",
  });
  const historicalPool = attachHistoricalStatsToProps(preparedPool, mergeContext);
  const projectionCandidateLimit = options.lightweight
    ? STARTUP_PROJECTION_CANDIDATE_LIMIT
    : Number.POSITIVE_INFINITY;
  const engineProjectedPool = selectStartupProjectionCandidates(
    enrichedPool,
    Number.isFinite(projectionCandidateLimit) ? projectionCandidateLimit : enrichedPool.length
  );

  const strictPool = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps, { relaxed: false });
  const qualityAudit = strictPool._qualityAudit || auditQualityMlbProps(historicalPool);
  resetProjectionFilterCounters();
  const playAudit = auditHighestProbabilityProps(historicalPool);
  syncBestPlaysFilterAudit(playAudit);
  const filterDiagnostics = {
    ...playAudit,
    qualityFilter: qualityAudit,
    enrichmentDebug: enrichment.debug,
    mergeDiagnostics,
  };
  const strictEligible = playAudit.eligible || 0;
  const selection = selectHighestProbabilityPlays(historicalPool, HIGHEST_PROBABILITY_MAX_PLAYS, {
    withMeta: true,
    seasonStats: mergeContext.seasonStats,
    statsMap: mergeContext.statsMap,
    fetchSport: "MLB",
    projectedPool: engineProjectedPool,
    skipHeavyAudit: Boolean(options.lightweight),
  });
  let highestPicks = (selection.picks || []).map((prop, idx) => annotateHighestProbabilityPlay(prop, idx + 1));
  let verifiedPicks = (selection.verifiedPicks || []).map((prop, idx) =>
    annotateHighestProbabilityPlay(prop, idx + 1)
  );
  const researchPicks = (selection.researchPicks || []).map((prop, idx) =>
    annotateHighestProbabilityPlay(prop, idx + 1)
  );
  const topProbabilityPicks = (selection.topProbabilityPicks || []).map((prop, idx) =>
    annotateHighestProbabilityPlay(prop, idx + 1)
  );
  const highestProbabilityPicks = (selection.highestProbabilityPicks || []).map((prop, idx) =>
    annotateHighestProbabilityPlay({ ...prop, topVerifiedRank: 1 }, idx + 1)
  );
  const topEdgePicks = (selection.topEdgePicks || []).map((prop, idx) =>
    annotateHighestProbabilityPlay(prop, idx + 1)
  );
  const topVerifiedPicks = (selection.topVerifiedPicks || []).map((prop, idx) =>
    annotateHighestProbabilityPlay({ ...prop, topVerifiedRank: prop.topVerifiedRank ?? idx + 1 }, idx + 1)
  );
  const noTierAPlays = Boolean(selection.noTierAPlays);

  filterDiagnostics.usedVerifiedFallback = Boolean(selection.usedVerifiedFallback);
  filterDiagnostics.verificationDashboard = selection.verificationDashboard || null;
  filterDiagnostics.verificationAudit = selection.verificationAudit || null;
  filterDiagnostics.verifiedPicksCount = verifiedPicks.length;
  filterDiagnostics.researchPicksCount = researchPicks.length;
  filterDiagnostics.topProbabilityCount = topProbabilityPicks.length;
  filterDiagnostics.topEdgeCount = topEdgePicks.length;
  filterDiagnostics.topVerifiedCount = topVerifiedPicks.length;
  filterDiagnostics.highestProbabilityCount = highestProbabilityPicks.length;
  filterDiagnostics.noTierAPlays = noTierAPlays;

  verifiedPicks = dedupeByPlayerMarketBestScore(verifiedPicks);
  highestPicks = dedupeByPlayerMarketBestScore(highestPicks);

  const boardQualityPool = dedupeByPlayerMarketBestScore(
    historicalPool.filter(passesVerifiedBestPlaysFilter).map((prop) => enrichBestPlayRankingFields(prop))
  );

  const projectedCount =
    engineProjectedPool.length ||
    Number(selection.pipelineCounts?.withProjections ?? selection.pipelineCounts?.engineProjectedCount ?? 0) ||
    boardQualityPool.filter((prop) => {
      const projection = Number(prop.projection ?? prop.projectedValue);
      return Number.isFinite(projection) && projection > 0;
    }).length;

  const bestPlaysResult = buildTopBestPlaysPicks(boardQualityPool, {
    limit: TOP_BEST_PLAYS_LIMIT,
    projectedCount,
    maxPerPlayer: MAX_PLAYER_APPEARANCES,
  });
  const topBestPlayPicks = bestPlaysResult.picks.map((prop, idx) =>
    annotateHighestProbabilityPlay(prop, idx + 1)
  );

  filterDiagnostics.bestPlayFilterAudit = bestPlaysResult.diagnostics;
  filterDiagnostics.bestPlayRejectionSamples = bestPlaysResult.rejectionSamples;
  filterDiagnostics.bestPlayQualifiedStrict = bestPlaysResult.qualifiedStrict;
  filterDiagnostics.bestPlayProjectedCount = projectedCount;
  filterDiagnostics.bestPlayUsedFallback = bestPlaysResult.usedFallback;

  const overallPlayCandidate = selectOverallPlay(boardQualityPool);
  const overallPlay = overallPlayCandidate
    ? {
        ...annotateHighestProbabilityPlay(overallPlayCandidate, 1),
        overallPlayExplanation: buildOverallPlayExplanation(overallPlayCandidate),
      }
    : null;

  const safestSectionResult = buildSafestPlaysSection(boardQualityPool, { limit: TOP_SECTION_LIMIT });
  const topSafestPicks = safestSectionResult.picks.map((prop, idx) =>
    annotateHighestProbabilityPlay(prop, idx + 1)
  );

  const topHighestEdgePicks = buildTopSectionPicks(boardQualityPool, {
    compareFn: compareHighestEdgePlaysRank,
    limit: TOP_SECTION_LIMIT,
    filterFn: passesTopFiveBestPlayGate,
  }).map((prop, idx) => annotateHighestProbabilityPlay(prop, idx + 1));

  const valueUndersResult = buildValueUndersSection(boardQualityPool, { limit: TOP_SECTION_LIMIT });
  const topValueUnders = valueUndersResult.picks.map((prop, idx) =>
    annotateHighestProbabilityPlay(prop, idx + 1)
  );

  const topValueOvers = buildTopSectionPicks(boardQualityPool, {
    compareFn: compareValueSidePlaysRank,
    side: "OVER",
    limit: TOP_SECTION_LIMIT,
    filterFn: passesTopFiveBestPlayGate,
  }).map((prop, idx) => annotateHighestProbabilityPlay(prop, idx + 1));

  filterDiagnostics.selected = highestPicks.length;
  filterDiagnostics.eligible = strictEligible;
  filterDiagnostics.debugMode = Boolean(selection.debugMode);
  filterDiagnostics.pipelineCounts = selection.pipelineCounts || null;
  filterDiagnostics.invalidReasons = selection.invalidReasons || playAudit.invalidReasons || null;
  filterDiagnostics.filteredOut =
    playAudit.filteredMissingProjection +
    playAudit.filteredLowConfidence +
    playAudit.filteredWeakEdge +
    playAudit.filteredBadMatch +
    playAudit.filteredOther;
  logProjectionFilterSummary("Best Plays filter diagnostics");

  logPipelineStage("rank.highestProbability", { pool: strictPool.length, ranked: highestPicks.length });

  let sectionPicks = verifiedPicks.filter(Boolean).slice(0, 10);
  let sectionTitle = "Top Verified Plays";
  let sectionEyebrow = "Sorted by playability, confidence, probability, then edge";
  let sectionEmptyMessage = sectionPicks.length
    ? ""
    : NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE;

  const sections = [
    {
      id: "top-10-best-plays",
      title: "Best Plays",
      eyebrow: "Top 10 · Tier A/B · Full data · Confidence 65+ · Max 2 props per player",
      emptyMessage:
        topBestPlayPicks.length || (bestPlaysResult.diagnostics?.fullData ?? 0) > 0
          ? ""
          : NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE,
      fallbackNotice: bestPlaysResult.fallbackNotice || "",
      picks: topBestPlayPicks,
    },
    {
      id: "top-5-safest",
      title: "Safest Plays",
      eyebrow: "Tier A/B · Full data · Confidence 75+ · Playability 70+ · Sanity 80+ · Probability 70+",
      emptyMessage: topSafestPicks.length ? "" : NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE,
      fallbackNotice: safestSectionResult.fallbackNotice || "",
      picks: topSafestPicks,
    },
    {
      id: "top-5-highest-edge",
      title: "Top 5 Highest Edge Plays",
      eyebrow: "Largest validated projection edge vs line",
      emptyMessage: topHighestEdgePicks.length ? "" : NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE,
      picks: topHighestEdgePicks,
    },
    {
      id: "top-5-value-unders",
      title: "Value Unders",
      eyebrow: "Projection below line · Confidence 65+ · Playability 60+",
      emptyMessage: topValueUnders.length ? "" : NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE,
      picks: topValueUnders,
      cardVariant: "valueUnder",
    },
    {
      id: "top-5-value-overs",
      title: "Top 5 Value Overs",
      eyebrow: "Best over recommendations by edge and probability",
      emptyMessage: topValueOvers.length ? "" : NO_HIGH_QUALITY_VERIFIED_PLAYS_MESSAGE,
      picks: topValueOvers,
    },
    {
      id: "verified-plays",
      title: sectionTitle,
      eyebrow: sectionEyebrow,
      emptyMessage: sectionEmptyMessage,
      picks: sectionPicks,
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
    overallPlay,
  };
}
