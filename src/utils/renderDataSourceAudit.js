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

export function resolvePropDataSourceTag(prop = {}, context = {}) {
  if (!prop || typeof prop !== "object") return DATA_SOURCE_TAGS.FALLBACK;

  if (prop.dataSourceTag && DATA_SOURCE_TAGS[prop.dataSourceTag]) {
    return prop.dataSourceTag;
  }

  if (prop.isDemoData || /mock|demo|synthetic|generated-props/i.test(String(prop.ingestionSource || ""))) {
    return DATA_SOURCE_TAGS.MOCK_DATA;
  }

  if (prop.manualEntry || prop.manualAnalyzerProp) {
    return DATA_SOURCE_TAGS.LOCAL_STORAGE;
  }

  const ingestion = String(prop.ingestionSource || context.ingestionFallback || "").toLowerCase();
  if (/last-good|verified-cache|board-cache|localstorage|startup-cache|last-good-board/i.test(ingestion)) {
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

  const badge = String(prop.lineSourceBadge || prop.status || "").toUpperCase();
  const boardCached = /cached|stale|expired/i.test(String(context.cacheStatus || ""));
  if (badge === "CACHED" || prop.fromCache || prop.cacheLayer || boardCached) {
    return DATA_SOURCE_TAGS.CACHE;
  }

  const src = normalizeSource(prop);
  if (src === "prizepicks" || src === "underdog") {
    if (badge === "CACHED" || /cached/i.test(String(prop.statusLabel || ""))) {
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

function resolveDominantRenderingSource(breakdown = {}, cacheStatus = "") {
  if (/cached|stale|expired/i.test(String(cacheStatus || ""))) {
    if (breakdown.CACHE > 0 || breakdown.LOCAL_STORAGE > 0) {
      return breakdown.LOCAL_STORAGE >= breakdown.CACHE ? DATA_SOURCE_TAGS.LOCAL_STORAGE : DATA_SOURCE_TAGS.CACHE;
    }
  }
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] || DATA_SOURCE_TAGS.FALLBACK;
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

  const verifiedPlays = extractVerifiedPlays(topMlbPlayBoard);
  const ppBoard = filterPlatformProps(boardDisplayProps, "prizepicks");
  const udBoard = filterPlatformProps(boardDisplayProps, "underdog");

  const sourceBreakdown = {
    LIVE_PROVIDER: 0,
    CACHE: 0,
    MOCK_DATA: 0,
    LOCAL_STORAGE: 0,
    FALLBACK: 0,
  };

  for (const prop of boardDisplayProps) {
    const tag = resolvePropDataSourceTag(prop, context);
    sourceBreakdown[tag] = (sourceBreakdown[tag] || 0) + 1;
  }

  const heroPlay = verifiedPlays[0] || null;
  const combinedProps = boardDisplayProps.length;
  const projectionCandidates = countProjectionCandidates(boardDisplayProps);
  const projected = countMergedProjections(boardDisplayProps);
  const verifiedProps = verifiedPlays.length;

  const audit = {
    ...(providerFetchAudit || {}),
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
    sourceBreakdown,
    renderingSource: resolveDominantRenderingSource(sourceBreakdown, cacheStatus),
    heroPlaySource: heroPlay ? resolvePropDataSourceTag(heroPlay, context) : null,
    heroPlayPlayer: heroPlay?.playerName || heroPlay?.player || "",
    boardCacheTimestamp: lastUpdated || providerFetchAudit?.boardCacheTimestamp || "",
    boardCacheActive: /cached|stale|expired/i.test(String(cacheStatus || "")) || Boolean(providerFetchAudit?.boardCacheActive),
    feedMode:
      resolveDominantRenderingSource(sourceBreakdown, cacheStatus) === DATA_SOURCE_TAGS.LIVE_PROVIDER &&
      !/cached|stale|expired/i.test(String(cacheStatus || ""))
        ? "LIVE"
        : "CACHE",
    dataIntegrityMismatch: false,
    integrityWarning: "",
    updatedAt: new Date().toISOString(),
  };

  const fetchCombined = finiteCount(providerFetchAudit?.combinedProps ?? providerFetchAudit?.combinedUsable);
  const fetchVerified = finiteCount(providerFetchAudit?.verified ?? providerFetchAudit?.verifiedProps);

  if (providerFetchAudit && combinedProps > 0 && fetchCombined === 0) {
    audit.dataIntegrityMismatch = true;
    audit.integrityWarning = `Data integrity mismatch: fetch audit combined=${fetchCombined} but rendered combined=${combinedProps}`;
  } else if (providerFetchAudit && verifiedProps > 0 && fetchVerified === 0) {
    audit.dataIntegrityMismatch = true;
    audit.integrityWarning = `Data integrity mismatch: fetch audit verified=${fetchVerified} but rendered verified=${verifiedProps}`;
  } else if (providerFetchAudit && fetchVerified > 0 && verifiedProps === 0) {
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
  return combined === 0 || verified === 0;
}
