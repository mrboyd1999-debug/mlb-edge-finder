/**
 * Cache-first board stability — never wipe live data before replacements are ready.
 */

import { normalizeSource } from "../utils/normalizeSource.js";
import { readCachedMlbStatsMap } from "./playerStats.js";
import { readInstantStartupBoard, readStartupSliceCache } from "./startupBoardCache.js";
import { CONNECTION_TIERS } from "./sourceHealth.js";

export const PROVIDER_HEALTH = {
  CONNECTED: "Connected",
  REFRESHING: "Refreshing",
  WARNING: "Warning",
  FAILED: "Failed",
};

export function countBoardProps(board = {}) {
  return (
    board.allDisplayProps?.length ||
    board.props?.length ||
    board.usableProps?.length ||
    board.qualifiedReadyProps?.length ||
    0
  );
}

export function boardHasUsableData(board = {}) {
  return countBoardProps(board) > 0;
}

function isLiveProviderBoardProp(prop = {}) {
  const src = normalizeSource(prop);
  if (src !== "underdog" && src !== "prizepicks") return false;
  if (prop.fromCache || prop.cacheLayer) return false;
  if (String(prop.lineSourceBadge || "").toUpperCase() === "CACHED") return false;
  return true;
}

function countLiveProviderBoardProps(board = {}) {
  const rows = board.allDisplayProps || board.props || board.usableProps || [];
  return rows.filter(isLiveProviderBoardProp).length;
}

/** Replace only when incoming fetch produced props; otherwise keep previous board. */
export function mergeBoardRefreshResult(previous = {}, incoming = {}) {
  const prevCount = countBoardProps(previous);
  const nextCount = countBoardProps(incoming);
  const liveProviderCount = countLiveProviderBoardProps(incoming);

  if (nextCount > 0 && liveProviderCount > 0) {
    return { board: incoming, replaced: true, keptPrevious: false };
  }

  if (nextCount === 0 && prevCount > 0) {
    return {
      board: {
        ...previous,
        cacheNotice: incoming.cacheNotice || previous.cacheNotice || "Refresh failed — showing last good board",
        pipelineFallback: true,
      },
      replaced: false,
      keptPrevious: true,
    };
  }

  if (nextCount > 0 && prevCount > 0 && nextCount < Math.max(20, Math.floor(prevCount * 0.45))) {
    const mergedProps = mergePropCollections(previous.allDisplayProps || previous.props, incoming.allDisplayProps || incoming.props);
    return {
      board: {
        ...incoming,
        props: mergedProps,
        allDisplayProps: mergedProps,
        usableProps: mergePropCollections(previous.usableProps, incoming.usableProps || mergedProps),
        cacheNotice: incoming.cacheNotice || "Partial refresh — merged with cached props",
        pipelineFallback: true,
      },
      replaced: true,
      merged: true,
    };
  }

  if (nextCount > 0) {
    return { board: incoming, replaced: true, keptPrevious: false };
  }

  return { board: incoming, replaced: false, keptPrevious: prevCount > 0 };
}

export function mergePropCollections(previous = [], incoming = []) {
  const prev = Array.isArray(previous) ? previous : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!next.length) return prev;
  if (!prev.length) return next;

  const byId = new Map();
  prev.forEach((prop) => {
    if (prop?.id) byId.set(String(prop.id), prop);
  });
  next.forEach((prop) => {
    if (!prop?.id) return;
    const key = String(prop.id);
    const existing = byId.get(key);
    byId.set(key, existing ? { ...existing, ...prop } : prop);
  });

  if (next.length < prev.length) {
    prev.forEach((prop) => {
      if (prop?.id && !byId.has(String(prop.id))) byId.set(String(prop.id), prop);
    });
  }

  return [...byId.values()];
}

/** Prefer live stats; fall back to last successful MLB stats cache. */
export function resolveStableStatsMap(liveStats = null, { allowEmpty = false } = {}) {
  if (liveStats instanceof Map && liveStats.size > 0) {
    return { statsMap: liveStats, usedCache: false, source: "live" };
  }
  const cached = readCachedMlbStatsMap();
  if (cached instanceof Map && cached.size > 0) {
    return { statsMap: cached, usedCache: true, source: "cache" };
  }
  if (allowEmpty) {
    return { statsMap: liveStats instanceof Map ? liveStats : new Map(), usedCache: false, source: "empty" };
  }
  return { statsMap: new Map(), usedCache: false, source: "empty" };
}

export function resolveStatsProviderHealth({ timedOut = false, failed = false, usedCache = false, statsSize = 0, hadPreviousCache = false } = {}) {
  if (statsSize > 0 && !timedOut && !failed) {
    return { status: PROVIDER_HEALTH.CONNECTED, detail: `${statsSize} profiles loaded` };
  }
  if (statsSize > 0 && (timedOut || failed || usedCache)) {
    return {
      status: PROVIDER_HEALTH.WARNING,
      detail: usedCache || hadPreviousCache ? "Using cached MLB player profiles" : "Using partial stats enrichment",
    };
  }
  if (timedOut || failed) {
    return { status: PROVIDER_HEALTH.FAILED, detail: "MLB stats unavailable" };
  }
  return { status: PROVIDER_HEALTH.WARNING, detail: "No MLB stats profiles loaded" };
}

export function resolveProviderHealthFromFetch({
  timedOut = false,
  fetchFailed = false,
  hasActiveProps = false,
  hasCachedProps = false,
  refreshing = false,
} = {}) {
  if (refreshing) {
    return { tier: PROVIDER_HEALTH.REFRESHING, connectionTier: CONNECTION_TIERS.PENDING };
  }
  if (hasActiveProps && !timedOut && !fetchFailed) {
    return { tier: PROVIDER_HEALTH.CONNECTED, connectionTier: CONNECTION_TIERS.CONNECTED };
  }
  if (hasActiveProps || hasCachedProps) {
    return { tier: PROVIDER_HEALTH.WARNING, connectionTier: CONNECTION_TIERS.WARNING };
  }
  if (timedOut || fetchFailed) {
    return { tier: PROVIDER_HEALTH.FAILED, connectionTier: CONNECTION_TIERS.FAILED };
  }
  return { tier: PROVIDER_HEALTH.WARNING, connectionTier: CONNECTION_TIERS.WARNING };
}

/** Instant paint bundle: cached board + cached stats + cached projection slice. */
export function readCacheFirstStartupBundle(defaultSourceStatus = {}) {
  const instant = readInstantStartupBoard(defaultSourceStatus);
  const slices = readStartupSliceCache();
  const statsResolved = resolveStableStatsMap(null);
  return {
    instant,
    slices,
    statsMap: statsResolved.statsMap,
    statsFromCache: statsResolved.usedCache,
    projections: slices.projections?.projections || [],
  };
}
