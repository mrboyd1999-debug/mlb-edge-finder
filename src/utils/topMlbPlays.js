import { isLooseDisplayProp, dedupeLooseProps } from "./safeModePipeline.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { filterUnderdogPropsBySport, filterResolvedSportProps } from "./underdogSportDetection.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";
import { enrichPropWithSideEvaluation } from "./sideEvaluationEngine.js";
import { normalizeSource } from "./normalizeSource.js";
import {
  annotateProjectionFields,
  isTopMlbPlayCandidate,
} from "./projectionQuality.js";
import { sortTopMlbPlays } from "./topMlbPlaysRanking.js";

export const TOP_MLB_PLAYS_LIMIT = 10;

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
  return dedupeLooseProps(
    [...mlbDisplay, ...ppRaw, ...udMlb]
      .filter(isLooseDisplayProp)
      .map(annotateProjectionFields)
      .filter(isTopMlbPlayCandidate)
  );
}

function annotateTopPlay(prop, rank) {
  const enriched = enrichPropWithSideEvaluation(annotateProjectionFields(prop));
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
  const pool = buildTopMlbPlayPool(displayProps, rawProps, parsedUnderdogProps);
  if (!pool.length) return [];

  return sortTopMlbPlays(pool)
    .slice(0, limit)
    .map((prop, idx) => annotateTopPlay(prop, idx + 1));
}
