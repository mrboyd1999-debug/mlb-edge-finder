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
import { resolveCuratedGoblinDemonBoards } from "./goblinDemonPairs.js";
import { buildDemoMlbProps, DEMO_FALLBACK_LABEL } from "./mlbDemoFallback.js";
import { preparePropsForRanking } from "./mlbPropPrep.js";
import { buildPipelineDebugSnapshot, logPipelineStage } from "./mlbPipelineDebug.js";
import { filterDemonCandidates, filterGoblinCandidates } from "./goblinDemonClassifier.js";
import { normalizeUnifiedProps, countLiveUnifiedProps } from "./unifiedPropNormalizer.js";
import { computeLiveConfidence } from "./liveConfidenceEngine.js";
import { applyCrossSectionPlayerCap } from "./sectionPlayerDedupe.js";
import { buildLiveFetchFailureSummary } from "./liveFetchAudit.js";

export const TOP_MLB_PLAYS_LIMIT = 20;
export const SECTION_BEST_PLAYS = 4;
export const SECTION_STREAK = 2;
export const SECTION_GOBLINS = 6;
export const SECTION_DEMONS = 6;
export const SECTION_UNDERS = 4;
export const SECTION_PARLAY = 4;
export const MAX_PLAYER_APPEARANCES = 2;
export const WAITING_FOR_PROJECTIONS_MESSAGE = "Waiting for verified projections…";
export const FALLBACK_PROJECTIONS_LABEL = "Relaxed ranking applied";

function isPrizePicksOrUnderdog(prop = {}) {
  const src = normalizeSource(prop);
  return src === "prizepicks" || src === "underdog";
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

function shouldUseDemoFallback(liveVerifiedCount = 0, options = {}) {
  if (liveVerifiedCount > 0) return false;
  return Boolean(options.fetchTimedOut || options.liveFetchFailed || options.allSourcesEmpty);
}

function buildTopMlbPlayPool(displayProps = [], rawProps = [], parsedUnderdogProps = [], { relaxed = false } = {}) {
  const merged = preparePropsForRanking(mergeInputProps(displayProps, rawProps, parsedUnderdogProps));

  logPipelineStage("pool.merged", { count: merged.length, live: countLiveVerifiedProps(merged) });

  const pool = [];
  merged.forEach((prop) => {
    if (prop.isDemoData) return;
    if (!relaxed && unsupportedMarketRejectReason(prop)) return;
    if (!relaxed && validatePropSanityRejectReason(prop)) return;
    if (!isTopMlbPlayCandidate(prop)) return;
    if (!relaxed && !isPrizePicksOrUnderdog(prop)) return;
    if (!relaxed && !isVerifiedSportsbookProp(prop)) return;
    pool.push(prop);
  });

  logPipelineStage("pool.filtered", { count: pool.length, relaxed });
  return pool;
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
  const conf = computeLiveConfidence(prop) ?? 58;

  return {
    ...enriched,
    recommendedSide,
    side: recommendedSide === "OVER" ? "over" : "under",
    pick: recommendedSide === "OVER" ? "over" : "under",
    confidence: conf,
    confidenceScore: conf,
    edge: 0.1,
    sideEvaluation: {
      ...enriched.sideEvaluation,
      recommendedSide,
      pass: false,
      edge: 0.1,
      confidence: conf,
      reason: "Live platform line",
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

function playerKey(prop = {}) {
  return String(prop.playerName || prop.player || "")
    .trim()
    .toLowerCase();
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

  const strictPool = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps, { relaxed: false });
  let ranked = rankPool(strictPool, { relaxed: false });
  let usedFallback = false;
  let fallbackLabel = "";
  let isDemoBoard = false;

  logPipelineStage("rank.strict", { pool: strictPool.length, ranked: ranked.length });

  if (!ranked.length && liveVerifiedCount > 0) {
    const relaxedPool = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps, { relaxed: true });
    ranked = rankPool(relaxedPool, { relaxed: true });
    if (ranked.length) {
      usedFallback = true;
      fallbackLabel = FALLBACK_PROJECTIONS_LABEL;
    }
    logPipelineStage("rank.relaxed", { pool: relaxedPool.length, ranked: ranked.length });
  }

  if (!ranked.length && liveVerifiedCount > 0) {
    const liveLinePool = strictPool.filter(isLiveLineRankable);
    ranked = rankPool(liveLinePool, { relaxed: true, liveLine: true });
    if (ranked.length) {
      usedFallback = true;
      fallbackLabel = "Live platform lines";
    }
    logPipelineStage("rank.liveLine", { pool: liveLinePool.length, ranked: ranked.length });
  }

  if (!ranked.length && shouldUseDemoFallback(liveVerifiedCount, options)) {
    ranked = buildDemoMlbProps(12);
    usedFallback = true;
    isDemoBoard = true;
    fallbackLabel = DEMO_FALLBACK_LABEL;
    logPipelineStage("rank.demo", { count: ranked.length, reason: fetchFailureReasons.join("; ") || "no live props" });
  }

  const unifiedRanked = normalizeUnifiedProps(ranked, enrichForBoard);
  ranked = unifiedRanked;

  const payoutBoards = resolveCuratedGoblinDemonBoards(displayProps, rawProps, {
    goblinLimit: SECTION_GOBLINS,
    demonLimit: SECTION_DEMONS,
    parsedUnderdogProps,
  });

  const livePool = strictPool.filter((p) => !p.isDemoData);
  let goblins = filterGoblinCandidates(livePool.length ? livePool : ranked);
  let demons = filterDemonCandidates(livePool.length ? livePool : ranked);

  if (!goblins.length) {
    goblins = (payoutBoards.goblins || [])
      .map((prop) => annotateTopPlay(prop, 0, { allowRelaxed: true, allowLiveLine: true }))
      .filter(Boolean);
  }
  if (!demons.length) {
    demons = (payoutBoards.demons || [])
      .map((prop) => annotateTopPlay(prop, 0, { allowRelaxed: true, allowLiveLine: true }))
      .filter(Boolean);
  }

  goblins = fillMinimum(goblins, ranked, SECTION_GOBLINS, {
    allowRelaxed: true,
    allowLiveLine: true,
    allowDemo: isDemoBoard,
  });
  demons = fillMinimum(demons, ranked, SECTION_DEMONS, {
    allowRelaxed: true,
    allowLiveLine: true,
    allowDemo: isDemoBoard,
  });

  const bestPlays = ranked.slice(0, SECTION_BEST_PLAYS);
  const streakPlays = fillMinimum(
    ranked.filter((p) => p.recommendedSide === "UNDER").slice(0, SECTION_STREAK),
    ranked,
    SECTION_STREAK,
    { allowRelaxed: true, allowLiveLine: true, allowDemo: isDemoBoard }
  );
  const safeUnders = fillMinimum(
    ranked.filter((p) => p.recommendedSide === "UNDER").slice(0, SECTION_UNDERS),
    ranked,
    SECTION_UNDERS,
    { allowRelaxed: true, allowLiveLine: true, allowDemo: isDemoBoard }
  );
  let parlayPicks = buildRankableParlayPicks(ranked, SECTION_PARLAY);
  parlayPicks = fillMinimum(parlayPicks, ranked, SECTION_PARLAY, {
    allowRelaxed: true,
    allowLiveLine: true,
    allowDemo: isDemoBoard,
  });

  let sections = [
    {
      id: "best-plays",
      title: "Best Plays",
      eyebrow: isDemoBoard ? fallbackLabel : "Top verified MLB edges",
      picks: bestPlays,
    },
    { id: "streak-plays", title: "Streak Plays", eyebrow: "Strongest unders", picks: streakPlays },
    { id: "goblins", title: "Goblins", eyebrow: "Safer payout lines", picks: goblins },
    { id: "demons", title: "Demons", eyebrow: "Higher payout lines", picks: demons },
    { id: "safe-unders", title: "Safe Unders", eyebrow: "Unders prioritized", picks: safeUnders },
    { id: "4-man-builder", title: "4-Man Builder", eyebrow: "Low-correlation legs", picks: parlayPicks },
  ].map((section) => ({ ...section, picks: section.picks.filter(Boolean) }));

  sections = applyCrossSectionPlayerCap(sections, MAX_PLAYER_APPEARANCES);

  const nonEmptySections = sections.filter((section) => section.picks.length > 0);
  const audit = auditTopMlbPlayRankableRejections(
    strictPool.map((prop) => enrichPropWithSideEvaluation(prop)),
    { relaxed: false }
  );

  const pipelineDebug = buildPipelineDebugSnapshot({
    rawProps: rawProps,
    parsedProps: mergedInput,
    pool: strictPool,
    ranked,
    rejectedAudit: audit,
    sourceStatus,
    lastUpdated,
    usedFallback: isDemoBoard,
    fallbackLabel: isDemoBoard ? fallbackLabel : "",
    livePropCount: countLiveUnifiedProps(ranked),
    fetchFailureReasons,
    isLive: liveVerifiedCount > 0 && !isDemoBoard,
  });

  logPipelineStage("render.final", {
    sections: nonEmptySections.map((s) => ({ id: s.id, count: s.picks.length })),
    usedFallback: isDemoBoard,
    liveVerified: liveVerifiedCount,
  });

  return {
    waitingForProjections: false,
    usedFallback: isDemoBoard,
    fallbackLabel: isDemoBoard ? fallbackLabel : "",
    fetchFailureReasons,
    isLive: liveVerifiedCount > 0 && !isDemoBoard,
    pipelineDebug,
    sections: nonEmptySections.length ? nonEmptySections : sections,
  };
}
