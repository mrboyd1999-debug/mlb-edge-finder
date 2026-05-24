import { filterAllDisplayPropsBySport } from "./allDisplayProps.js";
import { enrichDisplayPropsPipeline } from "./displayPropScoring.js";
import { normalizePropsWithSource } from "./normalizeSource.js";
import { normalizePropShape } from "./propShape.js";
import { dedupeLooseProps, isLooseDisplayProp } from "./safeModePipeline.js";
import {
  filterUnderdogStreakPool,
  isUnderdogProp,
  isPrizePicksProp,
  MLB_UNDERDOG_STREAK_EMPTY_MESSAGE,
  UNDERDOG_PARSER_EMPTY_MESSAGE,
  UNDERDOG_STREAK_EMPTY_MESSAGE,
} from "./underdogStreakPool.js";
import { UNDERDOG_PARSER_MISMATCH_MESSAGE } from "./parseUnderdogProp.js";
import {
  attachSportInference,
  countUnderdogPropsBySport,
  filterUnderdogPropsBySport,
  inferSportFromProp,
  isNbaUnderdogProp,
  MLB_SPORT_MISMAP_MESSAGE,
  resolvePropSportLabel,
} from "./underdogSportDetection.js";
import { isMlbUnderdogStreakRow, propMatchesStatTab } from "./underdogRowCard.js";

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function shapeUnderdogProp(prop = {}) {
  const enriched = attachSportInference(
    {
      ...prop,
      playerName: prop.playerName || prop.player || "",
      streakOptions: prop.streakOptions || [],
      startTime: prop.startTime || prop.gameTime || "",
      selectedSportTab: prop.selectedSportTab || "MLB",
    },
    { selectedSport: prop.selectedSportTab || "MLB" }
  );
  const sport = enriched.inferredSport || resolvePropSportLabel(enriched) || enriched.sport || enriched.league || "";
  return normalizePropsWithSource([
    normalizePropShape(
      {
        ...enriched,
        sport,
        league: sport || enriched.league || "",
      },
      { platform: "Underdog", source: "Underdog" }
    ),
  ])[0];
}

function dedupeUnderdogProps(...groups) {
  return dedupeLooseProps(groups.flat().filter(Boolean));
}

export function isMlbUnderdogStreakProp(prop = {}) {
  return isMlbUnderdogStreakRow(prop);
}

/** Underdog props for a selected sport — streak pool excludes PrizePicks. */
export function filterUnderdogPropsForSport(props = [], sport = "MLB") {
  return filterUnderdogPropsBySport(filterUnderdogStreakPool(props || []), sport);
}

function mlbUnderdogProps(props = []) {
  return filterUnderdogPropsForSport(props, "MLB");
}

/**
 * Parsed Underdog props from fetch result — not mixed with PrizePicks display pool.
 */
export function extractParsedUnderdogProps({
  parsedUnderdogProps = [],
  underdogResult = null,
  rawProps = [],
  displayProps = [],
} = {}) {
  const fromStored = normalizePropsWithSource(
    (parsedUnderdogProps || []).map((prop) => shapeUnderdogProp(prop))
  );
  if (fromStored.length) return dedupeUnderdogProps(fromStored);

  const fromResult = normalizePropsWithSource(
    (underdogResult?.props || []).map((prop) => shapeUnderdogProp(prop))
  );
  if (fromResult.length) return dedupeUnderdogProps(fromResult);

  const fromRaw = filterUnderdogStreakPool(rawProps);
  if (fromRaw.length) return dedupeUnderdogProps(fromRaw);

  const fromDisplay = filterUnderdogStreakPool(filterAllDisplayPropsBySport(displayProps, "all", "all"));
  return dedupeUnderdogProps(fromDisplay);
}

export function isStreakEligibleUdProp(prop = {}) {
  if (!isUnderdogProp(prop)) return false;
  const name = String(prop.player || prop.playerName || "").trim();
  const line = Number(prop.line);
  if (!name || name.length < 2 || /^unknown player$/i.test(name)) return false;
  if (!Number.isFinite(line)) return false;
  return true;
}

export function filterStreakEligibleUdProps(props = []) {
  return filterUnderdogStreakPool(props).filter(isStreakEligibleUdProp);
}

export function filterMlbUnderdogStreakEligible(props = []) {
  return filterStreakEligibleUdProps(mlbUnderdogProps(props));
}

/** Merge parsed UD props into finder pool so Goblins/Demons use the same path as PP lines. */
export function mergeUnderdogIntoFinderPool(displayProps = [], parsedUnderdogProps = [], sport = "MLB") {
  const sportUd = filterUnderdogPropsForSport(parsedUnderdogProps, sport);
  const udScored = enrichDisplayPropsPipeline(
    normalizePropsWithSource(sportUd.map((prop) => shapeUnderdogProp(prop)))
  );
  const seen = new Set();
  const merged = [];
  for (const prop of [...udScored, ...(displayProps || [])]) {
    if (!prop) continue;
    const key = prop.id || `${prop.playerName}-${prop.line}-${prop.statType}-${prop.normalizedSource}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(prop);
  }
  return merged;
}

export function auditUnderdogStreakFilter(props = [], { selectedSport = "MLB", selectedCategory = "all" } = {}) {
  const ud = (props || []).filter((p) => p.normalizedSource === "underdog");
  let rejectedWrongSport = 0;
  let rejectedWrongCategory = 0;
  let eligible = 0;

  for (const prop of ud) {
    const label = resolvePropSportLabel(prop);
    if (selectedSport !== "all" && label !== selectedSport) {
      rejectedWrongSport += 1;
      continue;
    }
    if (selectedSport === "MLB" && isNbaUnderdogProp(prop)) {
      rejectedWrongSport += 1;
      continue;
    }
    if (selectedCategory && selectedCategory !== "all" && !propMatchesStatTab(prop, selectedCategory)) {
      rejectedWrongCategory += 1;
      continue;
    }
    eligible += 1;
  }

  return { eligible, rejectedWrongSport, rejectedWrongCategory, total: ud.length };
}

export function buildUnderdogDebugSnapshot({
  debugInfo = {},
  parsedUnderdogProps = [],
  underdogResult = null,
  rawProps = [],
  displayProps = [],
  selectedSport = "MLB",
  selectedCategory = "all",
} = {}) {
  const udSource = debugInfo?.sources?.Underdog || {};
  const parserDiagnostics =
    debugInfo?.underdogParser ||
    udSource.underdogParser ||
    udSource.providerDiagnostics ||
    null;
  const rawUdCount = finiteOr(
    parserDiagnostics?.rawCount ??
      udSource.rawPropsLoaded ??
      underdogResult?.debug?.rawPropsLoaded ??
      underdogResult?.diagnostics?.rawPropsLoaded,
    0
  );

  const parsedPool = extractParsedUnderdogProps({
    parsedUnderdogProps,
    underdogResult,
    rawProps,
    displayProps,
  });
  const parsedUdCount = Math.max(
    finiteOr(
      parserDiagnostics?.acceptedCount ??
        udSource.propsAfterParsing ??
        underdogResult?.parsedProps?.length ??
        underdogResult?.props?.length ??
        underdogResult?.diagnostics?.parsedPropsCount,
      0
    ),
    parsedPool.length
  );
  const sportCounts = countUnderdogPropsBySport(parsedPool);
  const mlbUdProps = mlbUnderdogProps(parsedPool);
  const streakEligible = filterMlbUnderdogStreakEligible(parsedPool);
  const streakFilterAudit = auditUnderdogStreakFilter(parsedPool, { selectedSport, selectedCategory });
  const parserMismatch =
    Boolean(parserDiagnostics?.parserMismatch) || (rawUdCount > 0 && parsedUdCount === 0);

  let apiStatus =
    udSource.lineSourceBadge ||
    udSource.status ||
    underdogResult?.status ||
    underdogResult?.health ||
    "Unknown";
  if (rawUdCount > 0 && parsedUdCount === 0) {
    apiStatus = "Connected — parser returned 0";
  } else if (parserMismatch) {
    apiStatus = UNDERDOG_PARSER_MISMATCH_MESSAGE;
  } else if (rawUdCount === 0 && String(apiStatus).toUpperCase() === "LIVE") {
    apiStatus = "Connected — 0 props";
  } else if (rawUdCount > 0 && parsedUdCount > 0 && String(apiStatus).toUpperCase() !== "LIVE") {
    apiStatus = udSource.lineSourceBadge || "LIVE";
  }

  return {
    apiStatus,
    rawUdCount,
    parsedUdCount,
    mlbUdCount: mlbUdProps.length,
    selectedSport,
    selectedCategory,
    eligibleUnderdogCount: streakFilterAudit.eligible,
    rejectedWrongSport: streakFilterAudit.rejectedWrongSport,
    rejectedWrongCategory: streakFilterAudit.rejectedWrongCategory,
    sportCounts,
    streakEligibleCount: streakEligible.length,
    parserDiagnostics,
    parserMismatch,
    rawPreview: debugInfo?.rawUnderdogSamples || [],
    preview: parsedPool.slice(0, 3).map((prop) => ({
      id: prop.id,
      player: prop.playerName || prop.player,
      sport: prop.sport || prop.league,
      statType: prop.statType || prop.market,
      line: prop.line,
      source: prop.source,
      platform: prop.platform,
      normalizedSource: prop.normalizedSource,
    })),
    parsedPreview: parsedPool.slice(0, 5).map((prop) => {
      const inference = inferSportFromProp(prop, { selectedSport });
      return {
        id: prop.id,
        player: prop.player,
        statType: prop.statType,
        line: prop.line,
        projection: prop.projection,
        team: prop.team,
        opponent: prop.opponent,
        rawSport: prop.sport,
        inferredSport: prop.inferredSport || inference.sport || resolvePropSportLabel(prop),
        sportInferenceReason: prop.sportInferenceReason || inference.reason || "",
        normalizedSource: prop.normalizedSource,
        overUnder: prop.overUnder,
        confidence: prop.confidence,
        edge: prop.edge,
        playable: prop.playable,
        propType: prop.propType,
        matchup: prop.matchup,
      };
    }),
    parsedPool,
    streakEligible,
    parserEmpty: rawUdCount > 0 && parsedUdCount === 0 && parsedPool.length === 0,
    hasRawUnderdog: rawUdCount > 0,
    hasParsedUnderdog: parsedPool.length > 0,
    hasMlbUnderdog: mlbUdProps.length > 0,
  };
}

export function resolveUnderdogStreakEmptyMessage(snapshot = {}) {
  if (snapshot.parserMismatch) return UNDERDOG_PARSER_MISMATCH_MESSAGE;
  if (snapshot.parserEmpty) return UNDERDOG_PARSER_EMPTY_MESSAGE;
  if (snapshot.hasParsedUnderdog && !snapshot.hasMlbUnderdog) {
    return MLB_SPORT_MISMAP_MESSAGE;
  }
  if (snapshot.hasParsedUnderdog && snapshot.streakEligibleCount === 0) {
    return MLB_SPORT_MISMAP_MESSAGE;
  }
  if (snapshot.hasRawUnderdog && !snapshot.hasParsedUnderdog) {
    return UNDERDOG_PARSER_EMPTY_MESSAGE;
  }
  return MLB_UNDERDOG_STREAK_EMPTY_MESSAGE;
}

export { MLB_SPORT_MISMAP_MESSAGE, MLB_UNDERDOG_STREAK_EMPTY_MESSAGE, UNDERDOG_STREAK_EMPTY_MESSAGE };
