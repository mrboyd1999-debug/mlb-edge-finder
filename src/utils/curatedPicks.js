import { filterAllDisplayPropsBySport, selectTop2FromDisplayProps } from "./allDisplayProps.js";
import { buildPropSoftDedupeKey, markDisplayFallbackProps } from "./displayPropScoring.js";
import { MLB_ONLY_MODE } from "./mlbOnlyMode.js";

export const CURATED_SPORT_ORDER = MLB_ONLY_MODE ? ["MLB"] : ["MLB", "WNBA", "NBA", "Tennis"];

export const DISPLAY_LIMITS = {
  streakPerSport: 2,
  parlayLegs: 4,
  parlayCards: 1,
  goblins: 6,
  demons: 6,
};

export const CURATED_SPORT_LABELS = {
  MLB: "MLB",
  WNBA: "WNBA",
  NBA: "NBA",
  Tennis: "Tennis",
};

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
  return markDisplayFallbackProps(merged.slice(0, limit));
}

export function resolveCuratedSportPicks(sport, streakBoards = {}, displayProps = [], limit = DISPLAY_LIMITS.streakPerSport) {
  const boardPicks = (streakBoards[sport]?.picks || []).slice(0, limit);
  if (boardPicks.length >= limit) return markDisplayFallbackProps(boardPicks);

  const fallback = selectTop2FromDisplayProps(filterAllDisplayPropsBySport(displayProps, sport, "all"));
  return mergeUniquePicks(boardPicks, fallback, limit);
}

export function resolveCuratedBoardPicks(boardPicks = [], selector, displayProps = [], limit = DISPLAY_LIMITS.goblins) {
  const primary = (boardPicks || []).slice(0, limit);
  if (primary.length >= limit) return markDisplayFallbackProps(primary);

  const fallback = selector(displayProps, limit);
  return mergeUniquePicks(primary, fallback, limit);
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
