import { isLooseDisplayProp, dedupeLooseProps } from "./safeModePipeline.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { filterUnderdogPropsBySport, filterResolvedSportProps } from "./underdogSportDetection.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";
import { enrichPropWithSideEvaluation } from "./sideEvaluationEngine.js";
import { normalizeSource } from "./normalizeSource.js";
import { annotateProjectionFields, isTopMlbPlayCandidate } from "./projectionQuality.js";
import { auditPropSanityRejections, validatePropSanityRejectReason } from "./propSanity.js";
import {
  auditTopMlbPlayRankableRejections,
  filterTopMlbPlayRankable,
  isTopMlbPlayRankable,
} from "./mlbRankableProp.js";
import { sortTopMlbPlays, isHrMarket } from "./topMlbPlaysRanking.js";
import { resolveCuratedGoblinDemonBoards } from "./goblinDemonPairs.js";

export const TOP_MLB_PLAYS_LIMIT = 10;
export const TOP_MLB_SECTION_LIMIT = 5;
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

/** @deprecated use resolveTopMlbPlays */
export function resolveFeaturedMlbPicks(displayProps = [], rawProps = [], parsedUnderdogProps = []) {
  const plays = resolveTopMlbPlays(displayProps, rawProps, parsedUnderdogProps);
  return {
    bestOverall: plays[0] || null,
    sharpestEdge: null,
    safestPlay: null,
    bestPlays: plays,
  };
}

export function resolveTopMlbPlays(
  displayProps = [],
  rawProps = [],
  parsedUnderdogProps = [],
  limit = TOP_MLB_PLAYS_LIMIT
) {
  const { sections } = resolveTopMlbPlaySections(displayProps, rawProps, parsedUnderdogProps);
  const merged = dedupeSectionPicks(sections.flatMap((section) => section.picks));
  return merged.slice(0, limit);
}

export function resolveTopMlbPlaySections(
  displayProps = [],
  rawProps = [],
  parsedUnderdogProps = [],
  sectionLimit = TOP_MLB_SECTION_LIMIT
) {
  const pool = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps);
  const ranked = sortTopMlbPlays(pool)
    .map((prop, idx) => annotateTopPlay(prop, idx + 1))
    .filter(Boolean);

  if (!ranked.length) {
    return { waitingForProjections: true, sections: [] };
  }

  const goblinBoards = resolveCuratedGoblinDemonBoards(displayProps, rawProps, {
    goblinLimit: sectionLimit,
    demonLimit: 0,
    parsedUnderdogProps,
  });

  const bestUnders = ranked.filter((p) => p.recommendedSide === "UNDER").slice(0, sectionLimit);
  const safestGoblins = (goblinBoards.goblins || [])
    .map((prop) => annotateTopPlay(prop))
    .filter(Boolean)
    .slice(0, sectionLimit);
  const bestPrizePicks = ranked
    .filter((p) => normalizeSource(p) === "prizepicks")
    .slice(0, sectionLimit);
  const bestUnderdog = ranked
    .filter((p) => normalizeSource(p) === "underdog")
    .slice(0, sectionLimit);
  const hrUpside = ranked
    .filter((p) => isHrMarket(p) && p.recommendedSide === "OVER")
    .slice(0, sectionLimit);

  const sections = [
    { id: "best-unders", title: "Best Unders", eyebrow: "Unders prioritized", picks: bestUnders },
    { id: "safest-goblins", title: "Safest Goblins", eyebrow: "Easier payout lines", picks: safestGoblins },
    { id: "best-prizepicks", title: "Best PrizePicks Lines", eyebrow: "PrizePicks", picks: bestPrizePicks },
    { id: "best-underdog", title: "Best Underdog Lines", eyebrow: "Underdog", picks: bestUnderdog },
    { id: "hr-upside", title: "HR Upside Plays", eyebrow: "Ceiling overs", picks: hrUpside },
  ].filter((section) => section.picks.length > 0);

  return { waitingForProjections: false, sections };
}
