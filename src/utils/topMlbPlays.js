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
  filterTopMlbPlayRankable,
  isRelaxedRankable,
  isTopMlbPlayRankable,
} from "./mlbRankableProp.js";
import { sortTopMlbPlays } from "./topMlbPlaysRanking.js";
import { resolveCuratedGoblinDemonBoards } from "./goblinDemonPairs.js";
import { buildDemoMlbProps, DEMO_FALLBACK_LABEL } from "./mlbDemoFallback.js";
import { preparePropsForRanking } from "./mlbPropPrep.js";
import { buildPipelineDebugSnapshot, logPipelineStage } from "./mlbPipelineDebug.js";
import { isGoblinProp, isDemonProp } from "./propLabels.js";

export const TOP_MLB_PLAYS_LIMIT = 20;
export const SECTION_BEST_PLAYS = 4;
export const SECTION_STREAK = 2;
export const SECTION_GOBLINS = 6;
export const SECTION_DEMONS = 6;
export const SECTION_UNDERS = 4;
export const SECTION_PARLAY = 4;
export const WAITING_FOR_PROJECTIONS_MESSAGE = "Waiting for verified projections…";
export const FALLBACK_PROJECTIONS_LABEL = "Fallback projections loaded";

function isPrizePicksOrUnderdog(prop = {}) {
  const src = normalizeSource(prop);
  return src === "prizepicks" || src === "underdog" || prop.isDemoData;
}

function mergeInputProps(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const mlbDisplay = filterResolvedSportProps(displayProps, "MLB", { selectedSportTab: "MLB" });
  const ppRaw = filterResolvedSportProps(rawProps || [], "MLB", { selectedSportTab: "MLB" });
  const udMlb = filterUnderdogPropsBySport(parsedUnderdogProps || [], "MLB");
  return dedupeLooseProps([...mlbDisplay, ...ppRaw, ...udMlb].filter(isLooseDisplayProp));
}

function buildTopMlbPlayPool(displayProps = [], rawProps = [], parsedUnderdogProps = [], { relaxed = false } = {}) {
  const merged = preparePropsForRanking(mergeInputProps(displayProps, rawProps, parsedUnderdogProps));

  logPipelineStage("pool.merged", { count: merged.length });

  const pool = [];
  merged.forEach((prop) => {
    if (prop.isDemoData) {
      pool.push(prop);
      return;
    }
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

function annotateTopPlay(prop, rank, { allowRelaxed = false } = {}) {
  const enriched = enrichPropWithSideEvaluation(prop);
  const rankable = allowRelaxed ? isRelaxedRankable(enriched) : isTopMlbPlayRankable(enriched);
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

function fillMinimum(existing = [], source = [], limit = 0, allowRelaxed = false) {
  const out = [...existing];
  const seen = new Set(out.map((p) => p.id));
  source.forEach((prop) => {
    if (out.length >= limit) return;
    const annotated = annotateTopPlay(prop, out.length + 1, { allowRelaxed });
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

function rankPool(pool = [], { relaxed = false } = {}) {
  const sorted = sortTopMlbPlays(pool, { relaxed });
  return prepareRanked(sorted, { allowRelaxed: relaxed });
}

function prepareRanked(sorted = [], { allowRelaxed = false } = {}) {
  return sorted
    .map((prop, idx) => annotateTopPlay(prop, idx + 1, { allowRelaxed }))
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

  logPipelineStage("fetch.input", {
    display: displayProps.length,
    raw: rawProps.length,
    underdog: parsedUnderdogProps.length,
  });

  const strictPool = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps, { relaxed: false });
  let ranked = rankPool(strictPool, { relaxed: false });
  let usedFallback = false;
  let fallbackLabel = "";

  logPipelineStage("rank.strict", { pool: strictPool.length, ranked: ranked.length });

  if (!ranked.length) {
    const relaxedPool = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps, { relaxed: true });
    ranked = rankPool(relaxedPool, { relaxed: true });
    usedFallback = ranked.length > 0;
    fallbackLabel = ranked.length ? FALLBACK_PROJECTIONS_LABEL : "";
    logPipelineStage("rank.relaxed", { pool: relaxedPool.length, ranked: ranked.length });
  }

  if (!ranked.length) {
    ranked = buildDemoMlbProps(12);
    usedFallback = true;
    fallbackLabel = DEMO_FALLBACK_LABEL;
    logPipelineStage("rank.demo", { count: ranked.length });
  }

  const payoutBoards = resolveCuratedGoblinDemonBoards(displayProps, rawProps, {
    goblinLimit: SECTION_GOBLINS,
    demonLimit: SECTION_DEMONS,
    parsedUnderdogProps,
  });

  let goblins = (payoutBoards.goblins || [])
    .map((prop) => annotateTopPlay(prop, 0, { allowRelaxed: true }))
    .filter(Boolean);
  let demons = (payoutBoards.demons || [])
    .map((prop) => annotateTopPlay(prop, 0, { allowRelaxed: true }))
    .filter(Boolean);

  if (!goblins.length) {
    goblins = ranked.filter(isGoblinProp).slice(0, SECTION_GOBLINS);
  }
  if (!demons.length) {
    demons = ranked.filter(isDemonProp).slice(0, SECTION_DEMONS);
  }

  goblins = fillMinimum(goblins, ranked, SECTION_GOBLINS, true);
  demons = fillMinimum(demons, ranked, SECTION_DEMONS, true);

  const bestPlays = ranked.slice(0, SECTION_BEST_PLAYS);
  const streakPlays = ranked.filter((p) => p.recommendedSide === "UNDER").slice(0, SECTION_STREAK);
  const safeUnders = fillMinimum(
    ranked.filter((p) => p.recommendedSide === "UNDER").slice(0, SECTION_UNDERS),
    ranked,
    SECTION_UNDERS,
    true
  );
  let parlayPicks = buildRankableParlayPicks(ranked, SECTION_PARLAY);
  parlayPicks = fillMinimum(parlayPicks, ranked, SECTION_PARLAY, true);

  const sections = [
    { id: "best-plays", title: "Best Plays", eyebrow: usedFallback ? fallbackLabel : "Top verified MLB edges", picks: bestPlays },
    { id: "streak-plays", title: "Streak Plays", eyebrow: "Strongest unders", picks: streakPlays },
    { id: "goblins", title: "Goblins", eyebrow: "Safer payout lines", picks: goblins },
    { id: "demons", title: "Demons", eyebrow: "Higher payout lines", picks: demons },
    { id: "safe-unders", title: "Safe Unders", eyebrow: "Unders prioritized", picks: safeUnders },
    { id: "4-man-builder", title: "4-Man Builder", eyebrow: "Low-correlation legs", picks: parlayPicks },
  ].map((section) => ({ ...section, picks: section.picks.filter(Boolean) }));

  const nonEmptySections = sections.filter((section) => section.picks.length > 0);
  const audit = auditTopMlbPlayRankableRejections(
    strictPool.map((prop) => enrichPropWithSideEvaluation(prop)),
    { relaxed: false }
  );

  const pipelineDebug = buildPipelineDebugSnapshot({
    rawProps: rawProps,
    parsedProps: mergeInputProps(displayProps, rawProps, parsedUnderdogProps),
    pool: strictPool,
    ranked,
    rejectedAudit: audit,
    sourceStatus,
    lastUpdated,
    usedFallback,
    fallbackLabel,
  });

  logPipelineStage("render.final", {
    sections: nonEmptySections.map((s) => ({ id: s.id, count: s.picks.length })),
    usedFallback,
  });

  return {
    waitingForProjections: false,
    usedFallback,
    fallbackLabel,
    pipelineDebug,
    sections: nonEmptySections.length ? nonEmptySections : sections,
  };
}
