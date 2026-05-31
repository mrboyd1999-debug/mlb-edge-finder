/**
 * Trace where rendered play cards originate — no projection/tier logic changes.
 */

import { countMergedProjections } from "./projectionCoverageAudit.js";
import { normalizeSource } from "./normalizeSource.js";
import { isFakeOrFallbackProp } from "./livePropRender.js";

export const DATA_SOURCE_TAGS = {
  LIVE_PROVIDER: "LIVE_PROVIDER",
  CACHE: "CACHE",
  MOCK_DATA: "MOCK_DATA",
  LOCAL_STORAGE: "LOCAL_STORAGE",
  FALLBACK: "FALLBACK",
};

/** Rendering source priority — LIVE wins whenever it has plays. */
export const RENDERING_SOURCE_PRIORITY = [
  DATA_SOURCE_TAGS.LIVE_PROVIDER,
  DATA_SOURCE_TAGS.LOCAL_STORAGE,
  DATA_SOURCE_TAGS.CACHE,
  DATA_SOURCE_TAGS.MOCK_DATA,
  DATA_SOURCE_TAGS.FALLBACK,
];

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function countUsableProps(props = []) {
  return (props || []).filter((prop) => {
    const player = String(prop?.playerName || prop?.player || "").trim();
    const line = Number(prop?.line);
    return player && Number.isFinite(line) && line > 0;
  }).length;
}

function filterPlatformProps(props = [], platform = "") {
  const key = String(platform || "").toLowerCase();
  if (!key) return [];
  return (props || []).filter((prop) => normalizeSource(prop) === key);
}

function isLiveProviderProp(prop = {}, context = {}) {
  return resolvePropDataSourceTag(prop, context) === DATA_SOURCE_TAGS.LIVE_PROVIDER;
}

export function resolvePropDataSourceTag(prop = {}, context = {}) {
  if (!prop || typeof prop !== "object") return DATA_SOURCE_TAGS.FALLBACK;

  if (prop.dataSourceTag && DATA_SOURCE_TAGS[prop.dataSourceTag]) {
    return prop.dataSourceTag;
  }

  if (prop.isDemoData || /mock|demo|synthetic|generated-props/i.test(String(prop.ingestionSource || ""))) {
    return DATA_SOURCE_TAGS.MOCK_DATA;
  }

  const src = normalizeSource(prop);
  const badge = String(prop.lineSourceBadge || prop.status || "").toUpperCase();

  if ((src === "prizepicks" || src === "underdog") && (badge === "LIVE" || prop.isLiveRenderProp)) {
    return DATA_SOURCE_TAGS.LIVE_PROVIDER;
  }

  if (prop.manualEntry || prop.manualAnalyzerProp) {
    return DATA_SOURCE_TAGS.LOCAL_STORAGE;
  }

  const ingestion = String(prop.ingestionSource || context.ingestionFallback || "").toLowerCase();
  if (/last-good|verified-cache|board-cache|localstorage|startup-cache|last-good-board/i.test(ingestion)) {
    if ((src === "prizepicks" || src === "underdog") && badge !== "CACHED" && !prop.fromCache && !prop.cacheLayer) {
      return DATA_SOURCE_TAGS.LIVE_PROVIDER;
    }
    return DATA_SOURCE_TAGS.LOCAL_STORAGE;
  }

  if (
    prop.displayFallback ||
    prop.isFallbackMlbPick ||
    prop.isSportsDataFallback ||
    String(prop.lineSourceBadge || "").toUpperCase() === "FALLBACK"
  ) {
    return DATA_SOURCE_TAGS.FALLBACK;
  }

  if (badge === "CACHED" || prop.fromCache || prop.cacheLayer) {
    return DATA_SOURCE_TAGS.CACHE;
  }

  if (src === "prizepicks" || src === "underdog") {
    if (/cached/i.test(String(prop.statusLabel || ""))) {
      return DATA_SOURCE_TAGS.CACHE;
    }
    return DATA_SOURCE_TAGS.LIVE_PROVIDER;
  }

  if (src === "sportsdataio") return DATA_SOURCE_TAGS.FALLBACK;

  return DATA_SOURCE_TAGS.FALLBACK;
}

export function formatDataSourceLabel(tag = "") {
  const key = String(tag || "").toUpperCase();
  return DATA_SOURCE_TAGS[key] ? DATA_SOURCE_TAGS[key] : key || DATA_SOURCE_TAGS.FALLBACK;
}

export function resolveDominantRenderingSource(breakdown = {}) {
  for (const tag of RENDERING_SOURCE_PRIORITY) {
    if (finiteCount(breakdown[tag]) > 0) return tag;
  }
  return DATA_SOURCE_TAGS.FALLBACK;
}

/** Prefer live provider props — never render cache/local when live plays exist. */
export function preferLiveProviderBoardProps(props = [], context = {}) {
  if (!Array.isArray(props) || !props.length) return [];

  const buckets = RENDERING_SOURCE_PRIORITY.reduce((acc, tag) => {
    acc[tag] = [];
    return acc;
  }, {});

  for (const prop of props) {
    const tag = resolvePropDataSourceTag(prop, context);
    (buckets[tag] || buckets[DATA_SOURCE_TAGS.FALLBACK]).push(prop);
  }

  for (const tag of RENDERING_SOURCE_PRIORITY) {
    if (buckets[tag]?.length) return buckets[tag];
  }

  return props;
}

export function countRenderingSourceTags(props = [], context = {}) {
  const counts = RENDERING_SOURCE_PRIORITY.reduce((acc, tag) => {
    acc[tag] = 0;
    return acc;
  }, {});

  for (const prop of props || []) {
    const tag = resolvePropDataSourceTag(prop, context);
    counts[tag] = (counts[tag] || 0) + 1;
  }

  return {
    LIVE_PROVIDER_COUNT: counts[DATA_SOURCE_TAGS.LIVE_PROVIDER] || 0,
    LOCAL_STORAGE_COUNT: counts[DATA_SOURCE_TAGS.LOCAL_STORAGE] || 0,
    CACHE_COUNT: counts[DATA_SOURCE_TAGS.CACHE] || 0,
    MOCK_COUNT: counts[DATA_SOURCE_TAGS.MOCK_DATA] || 0,
    FALLBACK_COUNT: counts[DATA_SOURCE_TAGS.FALLBACK] || 0,
    sourceBreakdown: counts,
  };
}

function extractVerifiedPlays(topMlbPlayBoard = null) {
  const section = (topMlbPlayBoard?.sections || []).find((row) => row.id === "verified-plays");
  return section?.picks || [];
}

function countProjectionCandidates(props = []) {
  return (props || []).filter((prop) => {
    const line = Number(prop?.line);
    const player = String(prop?.playerName || prop?.player || "").trim();
    return player && Number.isFinite(line) && line > 0 && !isFakeOrFallbackProp(prop);
  }).length;
}

export function buildRenderSourceAudit({
  allDisplayProps = [],
  boardDisplayProps = [],
  topMlbPlayBoard = null,
  providerFetchAudit = null,
  cacheStatus = "",
  debugInfo = null,
  lastUpdated = "",
} = {}) {
  const context = {
    cacheStatus,
    debugInfo,
    lastUpdated,
    ingestionFallback: debugInfo?.ingestionFallback || "",
  };

  const renderPool = preferLiveProviderBoardProps(boardDisplayProps, context);
  const sourceCounts = countRenderingSourceTags(renderPool, context);
  const sourceBreakdown = {
    LIVE_PROVIDER: sourceCounts.LIVE_PROVIDER_COUNT,
    CACHE: sourceCounts.CACHE_COUNT,
    MOCK_DATA: sourceCounts.MOCK_COUNT,
    LOCAL_STORAGE: sourceCounts.LOCAL_STORAGE_COUNT,
    FALLBACK: sourceCounts.FALLBACK_COUNT,
  };

  const verifiedPlays = extractVerifiedPlays(topMlbPlayBoard);
  const ppBoard = filterPlatformProps(renderPool, "prizepicks");
  const udBoard = filterPlatformProps(renderPool, "underdog");

  const heroPlay = verifiedPlays[0] || null;
  const combinedProps = renderPool.length;
  const projectionCandidates = countProjectionCandidates(renderPool);
  const projected = countMergedProjections(renderPool);
  const verifiedProps = verifiedPlays.length;
  const renderingSource = resolveDominantRenderingSource(sourceBreakdown);

  const audit = {
    ...(providerFetchAudit || {}),
    prizepicksFetched: providerFetchAudit?.prizepicksLiveFetched ?? providerFetchAudit?.prizepicksFetched,
    underdogFetched: providerFetchAudit?.underdogLiveFetched ?? providerFetchAudit?.underdogFetched,
    prizepicksUsable: countUsableProps(ppBoard),
    underdogUsable: countUsableProps(udBoard),
    combinedProps,
    combinedUsable: combinedProps,
    projectionCandidates,
    projected,
    verified: verifiedProps,
    verifiedProps,
    verifiedPlaysCount: verifiedProps,
    renderedPlays: combinedProps,
    allDisplayPropsCount: allDisplayProps.length,
    providerPlays: sourceBreakdown.LIVE_PROVIDER,
    cachePlays: sourceBreakdown.CACHE,
    localStoragePlays: sourceBreakdown.LOCAL_STORAGE,
    mockPlays: sourceBreakdown.MOCK_DATA,
    fallbackPlays: sourceBreakdown.FALLBACK,
    liveProviderCount: sourceCounts.LIVE_PROVIDER_COUNT,
    localStorageCount: sourceCounts.LOCAL_STORAGE_COUNT,
    cacheCount: sourceCounts.CACHE_COUNT,
    sourceBreakdown,
    renderingSource,
    heroPlaySource: heroPlay ? resolvePropDataSourceTag(heroPlay, context) : null,
    heroPlayPlayer: heroPlay?.playerName || heroPlay?.player || "",
    boardCacheTimestamp: lastUpdated || providerFetchAudit?.boardCacheTimestamp || "",
    boardCacheActive:
      renderingSource !== DATA_SOURCE_TAGS.LIVE_PROVIDER &&
      (sourceBreakdown.LOCAL_STORAGE > 0 || sourceBreakdown.CACHE > 0),
    feedMode: renderingSource === DATA_SOURCE_TAGS.LIVE_PROVIDER ? "LIVE" : "CACHE",
    dataIntegrityMismatch: false,
    integrityWarning: "",
    updatedAt: new Date().toISOString(),
  };

  const fetchCombined = finiteCount(providerFetchAudit?.combinedProps ?? providerFetchAudit?.combinedUsable);
  const fetchVerified = finiteCount(providerFetchAudit?.verified ?? providerFetchAudit?.verifiedProps);

  if (providerFetchAudit && combinedProps > 0 && fetchCombined === 0 && finiteCount(audit.liveProviderCount) === 0) {
    audit.dataIntegrityMismatch = true;
    audit.integrityWarning = `Data integrity mismatch: fetch audit combined=${fetchCombined} but rendered combined=${combinedProps}`;
  } else if (providerFetchAudit && verifiedProps > 0 && fetchVerified === 0 && finiteCount(audit.liveProviderCount) === 0) {
    audit.dataIntegrityMismatch = true;
    audit.integrityWarning = `Data integrity mismatch: fetch audit verified=${fetchVerified} but rendered verified=${verifiedProps}`;
  } else if (providerFetchAudit && fetchVerified > 0 && verifiedProps === 0 && finiteCount(audit.liveProviderCount) === 0) {
    audit.dataIntegrityMismatch = true;
    audit.integrityWarning = `Data integrity mismatch: fetch audit verified=${fetchVerified} but rendered verified=${verifiedProps}`;
  }

  if (audit.dataIntegrityMismatch) {
    console.warn("[Render Source Audit]", audit.integrityWarning, {
      heroPlay: audit.heroPlayPlayer,
      heroSource: audit.heroPlaySource,
      renderingSource: audit.renderingSource,
      sourceBreakdown,
    });
  }

  return audit;
}

export const NO_LIVE_VERIFIED_PROPS_MESSAGE = "No live verified props available";

export function shouldBlockVerifiedPlayRender(audit = null) {
  const combined = finiteCount(audit?.combinedProps ?? audit?.combinedUsable);
  const verified = finiteCount(audit?.verifiedProps ?? audit?.verified);
  const liveProvider = finiteCount(audit?.liveProviderCount ?? audit?.providerPlays);
  if (liveProvider > 0 && combined > 0) return false;
  return combined === 0 || verified === 0;
}
