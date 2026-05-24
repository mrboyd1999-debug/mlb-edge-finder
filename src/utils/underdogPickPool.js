import { filterAllDisplayPropsBySport } from "./allDisplayProps.js";
import { enrichDisplayPropsPipeline } from "./displayPropScoring.js";
import { filterActiveSportProps } from "./mlbOnlyMode.js";
import { normalizePropsWithSource } from "./normalizeSource.js";
import { normalizePropShape } from "./propShape.js";
import { dedupeLooseProps, isLooseDisplayProp } from "./safeModePipeline.js";
import {
  filterUnderdogStreakPool,
  isUnderdogProp,
  UNDERDOG_PARSER_EMPTY_MESSAGE,
  UNDERDOG_STREAK_EMPTY_MESSAGE,
} from "./underdogStreakPool.js";

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function shapeUnderdogProp(prop = {}) {
  return normalizePropsWithSource([
    normalizePropShape(prop, { platform: "Underdog", source: "Underdog" }),
  ])[0];
}

function mlbUnderdogProps(props = []) {
  return filterUnderdogStreakPool(filterActiveSportProps(props || []));
}

function dedupeUnderdogProps(...groups) {
  return dedupeLooseProps(groups.flat().filter(Boolean));
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

  const fromRaw = mlbUnderdogProps(rawProps);
  if (fromRaw.length) return dedupeUnderdogProps(fromRaw);

  const fromDisplay = mlbUnderdogProps(filterAllDisplayPropsBySport(displayProps, "MLB", "all"));
  return dedupeUnderdogProps(fromDisplay);
}

export function isStreakEligibleUdProp(prop = {}) {
  if (!isLooseDisplayProp(prop) || !isUnderdogProp(prop)) return false;
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return false;
  const name = String(prop.player || prop.playerName || "").trim();
  return name.length >= 2 && !/^unknown player$/i.test(name);
}

export function filterStreakEligibleUdProps(props = []) {
  return filterUnderdogStreakPool(props).filter(isStreakEligibleUdProp);
}

/** Merge parsed UD props into finder pool so Goblins/Demons use the same path as PP lines. */
export function mergeUnderdogIntoFinderPool(displayProps = [], parsedUnderdogProps = []) {
  const udScored = enrichDisplayPropsPipeline(
    normalizePropsWithSource(parsedUnderdogProps.map((prop) => shapeUnderdogProp(prop)))
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

export function buildUnderdogDebugSnapshot({
  debugInfo = {},
  parsedUnderdogProps = [],
  underdogResult = null,
  rawProps = [],
  displayProps = [],
} = {}) {
  const udSource = debugInfo?.sources?.Underdog || {};
  const rawUdCount = finiteOr(
    udSource.rawPropsLoaded ?? underdogResult?.debug?.rawPropsLoaded ?? underdogResult?.diagnostics?.rawPropsLoaded,
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
      udSource.propsAfterParsing ?? underdogResult?.props?.length ?? underdogResult?.diagnostics?.parsedPropsCount,
      0
    ),
    parsedPool.length
  );
  const mlbUdProps = mlbUnderdogProps(parsedPool);
  const streakEligible = filterStreakEligibleUdProps(parsedPool);

  let apiStatus =
    udSource.lineSourceBadge ||
    udSource.status ||
    underdogResult?.status ||
    underdogResult?.health ||
    "Unknown";
  if (rawUdCount > 0 && parsedUdCount === 0) {
    apiStatus = "Connected — parser returned 0";
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
    streakEligibleCount: streakEligible.length,
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
    parsedPool,
    streakEligible,
    parserEmpty: rawUdCount > 0 && parsedUdCount === 0 && parsedPool.length === 0,
    hasRawUnderdog: rawUdCount > 0,
    hasParsedUnderdog: parsedPool.length > 0,
  };
}

export function resolveUnderdogStreakEmptyMessage(snapshot = {}) {
  if (snapshot.parserEmpty) return UNDERDOG_PARSER_EMPTY_MESSAGE;
  if (snapshot.hasParsedUnderdog && snapshot.streakEligibleCount === 0) {
    return "No Underdog streak picks ranked yet.";
  }
  if (snapshot.hasRawUnderdog && !snapshot.hasParsedUnderdog) {
    return UNDERDOG_PARSER_EMPTY_MESSAGE;
  }
  return UNDERDOG_STREAK_EMPTY_MESSAGE;
}
