import { filterAllDisplayPropsBySport } from "./allDisplayProps.js";
import {
  buildPropSoftDedupeKey,
  isValidDisplayProp,
  markDisplayFallbackProps,
  sortPropsForDisplay,
} from "./displayPropScoring.js";
import { MLB_ONLY_MODE } from "./mlbOnlyMode.js";
import { isSafeModeEnabled } from "./safeMode.js";
import {
  buildSafeMlbPropPool,
  resolveSafeMlbStreakPicks,
  sortLoosePropsByConfidence,
} from "./safeModePipeline.js";
import { filterByDisplayConfidenceFloor } from "./mlbConfidenceEngine.js";
import { resolveCuratedGoblinDemonBoards } from "./goblinDemonPairs.js";
import { filterActiveSportProps } from "./mlbOnlyMode.js";
import { isGoblinProp, isDemonProp } from "./propLabels.js";
import {
  filterUnderdogStreakPool,
  UNDERDOG_STREAK_EMPTY_MESSAGE,
} from "./underdogStreakPool.js";

export { UNDERDOG_STREAK_EMPTY_MESSAGE } from "./underdogStreakPool.js";

export {
  GOBLIN_EMPTY_MESSAGE,
  DEMON_EMPTY_MESSAGE,
  resolveCuratedGoblinDemonBoards,
} from "./goblinDemonPairs.js";

export const CURATED_SPORT_ORDER = MLB_ONLY_MODE ? ["MLB"] : ["MLB", "WNBA", "NBA", "Tennis"];

export const DISPLAY_LIMITS = {
  streakPerSport: 2,
  parlayLegs: 4,
  parlayCards: 1,
  goblins: 6,
  demons: 6,
};

export const MLB_EMPTY_MESSAGE = "No MLB props loaded. Check provider feed, API key, or proxy.";

export const CURATED_SPORT_LABELS = {
  MLB: "MLB",
  WNBA: "WNBA",
  NBA: "NBA",
  Tennis: "Tennis",
};

function annotateMlbPick(prop = {}, isFallback = false) {
  return {
    ...prop,
    isFallbackMlbPick: isFallback,
    fallbackLabel: isFallback ? "Fallback MLB pick" : prop.fallbackLabel || "",
    bettingLabel: isFallback ? "Fallback MLB pick" : prop.bettingLabel,
    displayFallback: isFallback || prop.displayFallback,
  };
}

function mergeUniquePicks(primary = [], fallback = [], limit = 2) {
  const seen = new Set();
  const merged = [];
  for (const prop of [...primary, ...fallback]) {
    if (!prop || merged.length >= limit) break;
    const key = buildPropSoftDedupeKey(prop);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(prop);
  }
  return merged.slice(0, limit);
}

function buildUnderdogConfidencePool(displayProps = [], rawProps = []) {
  return sortLoosePropsByConfidence(filterUnderdogStreakPool(buildSafeMlbPropPool(displayProps, rawProps)));
}

function pickLowCorrelationUdProps(pool = [], limit = 4, excludeKeys = new Set()) {
  const selected = [];
  const playerKeys = new Set();
  const marketKeys = new Set();

  for (const prop of pool) {
    if (selected.length >= limit) break;
    const key = buildPropSoftDedupeKey(prop);
    if (excludeKeys.has(key)) continue;

    const player = String(prop.player || prop.playerName || "").trim().toLowerCase();
    const market = String(prop.statType || prop.market || prop.propType || "").trim().toLowerCase();
    const playerMarketKey = `${player}|${market}`;
    if (!player || playerKeys.has(player) || marketKeys.has(playerMarketKey)) continue;

    playerKeys.add(player);
    marketKeys.add(playerMarketKey);
    selected.push(annotateMlbPick(prop, true));
  }

  return selected;
}

function annotateUdPayoutProp(prop = {}, role) {
  const isGoblin = role === "goblin";
  return annotateMlbPick({
    ...prop,
    payoutRole: role,
    payoutLabel: isGoblin ? "Goblin" : "Demon",
    payoutBadge: isGoblin ? "GOBLIN / SAFER LINE" : "DEMON / HIGHER PAYOUT",
    isGoblinPick: isGoblin,
    isDemonPick: !isGoblin,
    goblinDemonVerified: Boolean(prop.verifiedAdjustedOdds),
  }, true);
}

/**
 * When Underdog pool has props, fill empty curated sections from UD props sorted by confidence.
 */
export function resolveUnderdogSectionFallbacks(
  displayProps = [],
  rawProps = [],
  {
    streakPicks = [],
    parlayPicks = [],
    goblins = [],
    demons = [],
    streakLimit = DISPLAY_LIMITS.streakPerSport,
    parlayLimit = DISPLAY_LIMITS.parlayLegs,
    goblinLimit = DISPLAY_LIMITS.goblins,
    demonLimit = DISPLAY_LIMITS.demons,
  } = {}
) {
  const udPool = buildUnderdogConfidencePool(displayProps, rawProps);
  if (!udPool.length) {
    return { streakPicks, parlayPicks, goblins, demons, udPoolCount: 0 };
  }

  const usedKeys = new Set([
    ...streakPicks,
    ...parlayPicks,
    ...goblins,
    ...demons,
  ].map((prop) => buildPropSoftDedupeKey(prop)));

  let nextStreakPicks = [...streakPicks];
  if (nextStreakPicks.length < streakLimit) {
    const extras = udPool
      .filter((prop) => !usedKeys.has(buildPropSoftDedupeKey(prop)))
      .slice(0, streakLimit - nextStreakPicks.length)
      .map((prop) => annotateMlbPick(prop, true));
    extras.forEach((prop) => usedKeys.add(buildPropSoftDedupeKey(prop)));
    nextStreakPicks = mergeUniquePicks(nextStreakPicks, extras, streakLimit);
  }

  let nextParlayPicks = [...parlayPicks];
  if (nextParlayPicks.length < parlayLimit) {
    const parlayExclude = new Set([
      ...usedKeys,
      ...nextParlayPicks.map((prop) => buildPropSoftDedupeKey(prop)),
    ]);
    const extras = pickLowCorrelationUdProps(
      udPool.filter((prop) => !parlayExclude.has(buildPropSoftDedupeKey(prop))),
      parlayLimit - nextParlayPicks.length,
      parlayExclude
    );
    extras.forEach((prop) => usedKeys.add(buildPropSoftDedupeKey(prop)));
    nextParlayPicks = mergeUniquePicks(nextParlayPicks, extras, parlayLimit);
  }

  let nextGoblins = [...goblins];
  if (nextGoblins.length < goblinLimit) {
    const extras = udPool
      .filter((prop) => isGoblinProp(prop) && !usedKeys.has(buildPropSoftDedupeKey(prop)))
      .slice(0, goblinLimit - nextGoblins.length)
      .map((prop) => annotateUdPayoutProp(prop, "goblin"));
    extras.forEach((prop) => usedKeys.add(buildPropSoftDedupeKey(prop)));
    nextGoblins = mergeUniquePicks(nextGoblins, extras, goblinLimit);
  }

  let nextDemons = [...demons];
  if (nextDemons.length < demonLimit) {
    const extras = udPool
      .filter((prop) => isDemonProp(prop) && !usedKeys.has(buildPropSoftDedupeKey(prop)))
      .slice(0, demonLimit - nextDemons.length)
      .map((prop) => annotateUdPayoutProp(prop, "demon"));
    nextDemons = mergeUniquePicks(nextDemons, extras, demonLimit);
  }

  return {
    streakPicks: markDisplayFallbackProps(filterByDisplayConfidenceFloor(nextStreakPicks)),
    parlayPicks: markDisplayFallbackProps(filterByDisplayConfidenceFloor(nextParlayPicks)),
    goblins: nextGoblins.slice(0, goblinLimit),
    demons: nextDemons.slice(0, demonLimit),
    udPoolCount: udPool.length,
  };
}

export function shouldApplyUnderdogSectionFallbacks(primaryCount = 0, udCount = 0, limit = 1) {
  if (!udCount) return false;
  if (isSafeModeEnabled()) return primaryCount < limit;
  return primaryCount < limit;
}

export function countMlbDisplayProps(displayProps = [], rawProps = []) {
  if (isSafeModeEnabled()) {
    return buildSafeMlbPropPool(displayProps, rawProps).length;
  }
  return filterAllDisplayPropsBySport(displayProps, "MLB", "all").filter(isValidDisplayProp).length;
}

export function countUnderdogStreakProps(displayProps = [], rawProps = []) {
  const pool = isSafeModeEnabled()
    ? filterUnderdogStreakPool(buildSafeMlbPropPool(displayProps, rawProps))
    : filterUnderdogStreakPool([
        ...filterAllDisplayPropsBySport(displayProps, "MLB", "all"),
        ...filterActiveSportProps(rawProps || []),
      ]);
  return pool.length;
}

/** Return up to 2 MLB streak picks from Underdog props only. */
export function resolveMlbStreakPicks(
  streakBoards = {},
  displayProps = [],
  limit = DISPLAY_LIMITS.streakPerSport,
  rawProps = []
) {
  if (isSafeModeEnabled()) {
    return resolveSafeMlbStreakPicks(displayProps, rawProps, limit);
  }

  const mlbUnderdogProps = filterUnderdogStreakPool(filterAllDisplayPropsBySport(displayProps, "MLB", "all"));
  const boardPicks = filterUnderdogStreakPool(streakBoards.MLB?.picks || [])
    .slice(0, limit)
    .map((prop) => annotateMlbPick(prop, false));

  const fallbackPool = sortPropsForDisplay(mlbUnderdogProps.filter(isValidDisplayProp)).map((prop) =>
    annotateMlbPick(prop, true)
  );

  const merged = mergeUniquePicks(boardPicks, fallbackPool, limit);
  if (merged.length) return markDisplayFallbackProps(filterByDisplayConfidenceFloor(merged));

  if (mlbUnderdogProps.length) {
    return markDisplayFallbackProps(
      sortPropsForDisplay(mlbUnderdogProps.filter(isValidDisplayProp))
        .slice(0, limit)
        .map((prop) => annotateMlbPick(prop, true))
    );
  }

  return [];
}

export function resolveCuratedSportPicks(sport, streakBoards = {}, displayProps = [], limit = DISPLAY_LIMITS.streakPerSport, rawProps = []) {
  if (sport === "MLB") return resolveMlbStreakPicks(streakBoards, displayProps, limit, rawProps);

  const boardPicks = (streakBoards[sport]?.picks || []).slice(0, limit);
  const sportProps = filterAllDisplayPropsBySport(displayProps, sport, "all");
  const fallback = sortPropsForDisplay(sportProps.filter(isValidDisplayProp)).slice(0, limit);
  return markDisplayFallbackProps(mergeUniquePicks(boardPicks, fallback, limit));
}

export function resolveCuratedGoblinBoardPicks(boardPicks = [], displayProps = [], limit = DISPLAY_LIMITS.goblins, rawProps = []) {
  return resolveCuratedGoblinDemonBoards(displayProps, rawProps, {
    goblinBoardPicks: boardPicks,
    goblinLimit: limit,
    demonLimit: 0,
  }).goblins;
}

export function resolveCuratedDemonBoardPicks(boardPicks = [], displayProps = [], limit = DISPLAY_LIMITS.demons, rawProps = []) {
  return resolveCuratedGoblinDemonBoards(displayProps, rawProps, {
    demonBoardPicks: boardPicks,
    goblinLimit: 0,
    demonLimit: limit,
  }).demons;
}

/** @deprecated Use resolveCuratedGoblinBoardPicks / resolveCuratedDemonBoardPicks */
export function resolveCuratedBoardPicks(boardPicks = [], selector, displayProps = [], limit = DISPLAY_LIMITS.goblins, rawProps = []) {
  const isGoblinSelector = selector?.name === "selectGoblinProps";
  if (isGoblinSelector) {
    return resolveCuratedGoblinBoardPicks(boardPicks, displayProps, limit, rawProps);
  }
  return resolveCuratedDemonBoardPicks(boardPicks, displayProps, limit, rawProps);
}

export function isManuallySavedPick(pick = {}) {
  return /manually saved/i.test(String(pick.recommendationType || ""));
}

export function historyPickToDisplayProp(pick = {}) {
  return {
    ...pick,
    id: pick.id || pick.uniqueKey,
    playerName: pick.playerName || pick.player || "",
    player: pick.playerName || pick.player || "",
    statType: pick.statType || pick.market || pick.propType || "",
    market: pick.statType || pick.market || "",
    confidence: pick.confidenceScore ?? pick.confidence,
    confidenceScore: pick.confidenceScore ?? pick.confidence,
    bestPick: pick.pickDirection || pick.side || pick.pick || "",
    side: pick.pickDirection || pick.side || pick.pick || "",
    platform: pick.platform || pick.source || "",
    source: pick.platform || pick.source || "",
    savedPick: true,
  };
}
