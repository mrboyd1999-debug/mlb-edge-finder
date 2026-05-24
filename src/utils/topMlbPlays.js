import { isLooseDisplayProp, dedupeLooseProps } from "./safeModePipeline.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { filterUnderdogPropsBySport, filterResolvedSportProps } from "./underdogSportDetection.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";
import { enrichPropWithSideEvaluation } from "./sideEvaluationEngine.js";
import { normalizeSource } from "./normalizeSource.js";
import { annotateProjectionFields, isTopMlbPlayCandidate } from "./projectionQuality.js";
import { auditPropSanityRejections, validatePropSanityRejectReason } from "./propSanity.js";
import { unsupportedMarketRejectReason } from "./mlbAllowedMarkets.js";
import {
  auditTopMlbPlayRankableRejections,
  isTopMlbPlayRankable,
} from "./mlbRankableProp.js";
import { sortTopMlbPlays } from "./topMlbPlaysRanking.js";
import { resolveCuratedGoblinDemonBoards } from "./goblinDemonPairs.js";

export const TOP_MLB_PLAYS_LIMIT = 20;
export const TOP_MLB_SECTION_LIMIT = 4;
export const WAITING_FOR_PROJECTIONS_MESSAGE = "Waiting for verified projections…";

function isPrizePicksOrUnderdog(prop = {}) {
  const src = normalizeSource(prop);
  return src === "prizepicks" || src === "underdog";
}

function buildTopMlbPlayPool(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const mlbDisplay = filterResolvedSportProps(displayProps, "MLB", { selectedSportTab: "MLB" })
    .filter(isVerifiedSportsbookProp)
    .filter(isPrizePicksOrUnderdog);
  const ppRaw = filterResolvedSportProps(rawProps || [], "MLB", { selectedSportTab: "MLB" })
    .filter(isVerifiedSportsbookProp)
    .filter((prop) => normalizeSource(prop) === "prizepicks");
  const udMlb = filterUnderdogPropsBySport(parsedUnderdogProps || [], "MLB").filter(isVerifiedSportsbookProp);
  const merged = dedupeLooseProps(
    [...mlbDisplay, ...ppRaw, ...udMlb].filter(isLooseDisplayProp).map(annotateProjectionFields)
  );

  const pool = [];
  merged.forEach((prop) => {
    if (unsupportedMarketRejectReason(prop)) return;
    if (validatePropSanityRejectReason(prop)) return;
    if (!isTopMlbPlayCandidate(prop)) return;
    pool.push(prop);
  });

  return pool;
}

export function auditTopMlbPlayPool(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const candidates = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps);
  const sanity = auditPropSanityRejections(candidates);
  const rankable = auditTopMlbPlayRankableRejections(
    candidates.map((prop) => enrichPropWithSideEvaluation(prop))
  );
  return {
    sanity,
    rankable,
    reasons: {
      ...(sanity.reasons || {}),
      ...Object.fromEntries(
        Object.entries(rankable.reasons || {}).map(([k, v]) => [`[rank] ${k}`, v])
      ),
    },
    accepted: rankable.accepted,
    rejected: rankable.rejected,
  };
}

function annotateTopPlay(prop, rank) {
  const enriched = enrichPropWithSideEvaluation(annotateProjectionFields(prop));
  if (!isTopMlbPlayRankable(enriched)) return null;
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

export function buildRankableParlayPicks(ranked = [], limit = 4) {
  const selected = [];
  const usedPlayers = new Set();
  const usedStats = new Set();

  ranked.forEach((prop) => {
    if (selected.length >= limit) return;
    if (!isTopMlbPlayRankable(prop)) return;
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

export function resolveTopMlbPlays(
  displayProps = [],
  rawProps = [],
  parsedUnderdogProps = [],
  limit = TOP_MLB_PLAYS_LIMIT
) {
  const { sections } = resolveTopMlbPlaySections(displayProps, rawProps, parsedUnderdogProps);
  return dedupeSectionPicks(sections.flatMap((section) => section.picks)).slice(0, limit);
}

export function resolveTopMlbPlaySections(
  displayProps = [],
  rawProps = [],
  parsedUnderdogProps = [],
  sectionLimit = TOP_MLB_SECTION_LIMIT
) {
  const pool = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps);
  const ranked = sortTopMlbPlays(pool)
    .slice(0, TOP_MLB_PLAYS_LIMIT)
    .map((prop, idx) => annotateTopPlay(prop, idx + 1))
    .filter(Boolean);

  if (!ranked.length) {
    return { waitingForProjections: true, sections: [] };
  }

  const payoutBoards = resolveCuratedGoblinDemonBoards(displayProps, rawProps, {
    goblinLimit: sectionLimit,
    demonLimit: sectionLimit,
    parsedUnderdogProps,
  });

  const goblins = (payoutBoards.goblins || [])
    .map((prop) => annotateTopPlay(prop))
    .filter(Boolean)
    .slice(0, sectionLimit);
  const demons = (payoutBoards.demons || [])
    .map((prop) => annotateTopPlay(prop))
    .filter(Boolean)
    .slice(0, sectionLimit);
  const safeUnders = ranked.filter((p) => p.recommendedSide === "UNDER").slice(0, sectionLimit);
  const parlayPicks = buildRankableParlayPicks(ranked, 4);

  const sections = [
    { id: "best-plays", title: "Best Plays", eyebrow: "Top verified MLB edges", picks: ranked.slice(0, sectionLimit) },
    { id: "goblins", title: "Goblins", eyebrow: "Safer payout lines", picks: goblins },
    { id: "demons", title: "Demons", eyebrow: "Higher payout lines", picks: demons },
    { id: "safe-unders", title: "Safe Unders", eyebrow: "Unders prioritized", picks: safeUnders },
    { id: "4-man-builder", title: "4-Man Builder", eyebrow: "Low-correlation legs", picks: parlayPicks },
  ].filter((section) => section.picks.length > 0);

  return { waitingForProjections: false, sections };
}
