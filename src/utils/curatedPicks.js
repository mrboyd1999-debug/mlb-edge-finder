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
  resolveSafeMlbBoardPicks,
  resolveSafeMlbStreakPicks,
} from "./safeModePipeline.js";

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

/** Always return up to 2 MLB streak picks when MLB props exist. */
export function resolveMlbStreakPicks(
  streakBoards = {},
  displayProps = [],
  limit = DISPLAY_LIMITS.streakPerSport,
  rawProps = []
) {
  if (isSafeModeEnabled()) {
    const safe = resolveSafeMlbStreakPicks(displayProps, rawProps, limit);
    if (safe.length) return safe;
  }

  const mlbProps = filterAllDisplayPropsBySport(displayProps, "MLB", "all");
  const boardPicks = (streakBoards.MLB?.picks || []).slice(0, limit).map((prop) => annotateMlbPick(prop, false));

  const fallbackPool = sortPropsForDisplay(mlbProps.filter(isValidDisplayProp)).map((prop) =>
    annotateMlbPick(prop, true)
  );

  const merged = mergeUniquePicks(boardPicks, fallbackPool, limit);
  if (merged.length) return markDisplayFallbackProps(merged);

  if (mlbProps.length) {
    return markDisplayFallbackProps(
      sortPropsForDisplay(mlbProps.filter(isValidDisplayProp))
        .slice(0, limit)
        .map((prop) => annotateMlbPick(prop, true))
    );
  }

  if (isSafeModeEnabled()) {
    return resolveSafeMlbStreakPicks(displayProps, rawProps, limit);
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

export function resolveCuratedBoardPicks(boardPicks = [], selector, displayProps = [], limit = DISPLAY_LIMITS.goblins, rawProps = []) {
  if (isSafeModeEnabled()) {
    const safe = resolveSafeMlbBoardPicks(displayProps, rawProps, limit);
    if (safe.length) return safe;
  }

  const mlbProps = filterAllDisplayPropsBySport(displayProps, "MLB", "all");
  const pool = mlbProps.length ? mlbProps : displayProps;
  const primary = (boardPicks || []).slice(0, limit);
  let fallback = selector(pool, limit);
  if (!fallback.length && pool.length) {
    fallback = sortPropsForDisplay(pool.filter(isValidDisplayProp)).slice(0, limit);
  }
  return markDisplayFallbackProps(mergeUniquePicks(primary, fallback, limit));
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
