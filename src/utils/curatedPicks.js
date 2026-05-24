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
} from "./safeModePipeline.js";
import { filterByDisplayConfidenceFloor } from "./mlbConfidenceEngine.js";
import { resolveCuratedGoblinDemonBoards } from "./goblinDemonPairs.js";
import { filterActiveSportProps } from "./mlbOnlyMode.js";
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
