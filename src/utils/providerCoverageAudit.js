/**
 * Provider coverage audit — diagnoses feed drop-off without touching projection math.
 */

import { countMergedProjections } from "./projectionCoverageAudit.js";
import { isSupportedMlbMarket } from "./mlbAllowedMarkets.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { getPrizePicksDiagnostics } from "./prizepicksDiagnostics.js";

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function countMlbProps(props = []) {
  return (props || []).filter((prop) => resolvePropSport(prop) === "MLB").length;
}

function countSupportedProps(props = []) {
  return (props || []).filter((prop) => isSupportedMlbMarket(prop)).length;
}

function countProjectedFromList(props = []) {
  return countMergedProjections(props || []);
}

function countUsableFromProps(props = []) {
  return (props || []).filter((prop) => {
    const player = String(prop?.playerName || prop?.player || "").trim();
    const line = Number(prop?.line);
    return player && Number.isFinite(line) && line > 0;
  }).length;
}

const BOTTLENECK_LABELS = {
  1: "PrizePicks timeout",
  2: "Underdog parser",
  3: "Cache loader",
  4: "MLB filter",
  5: "Projection eligibility filter",
};

export function resolveProviderFeedMode({
  prizepicksUsable = 0,
  underdogUsable = 0,
  prizepicksUsedCache = false,
  underdogUsedCache = false,
  prizepicksTimedOut = false,
  prizepicksLive = false,
  underdogLive = false,
  ingestionFallback = "",
} = {}) {
  const ppLive = Boolean(prizepicksLive) || (finiteCount(prizepicksUsable) > 0 && !prizepicksUsedCache && !prizepicksTimedOut);
  const udLive = Boolean(underdogLive) || (finiteCount(underdogUsable) > 0 && !underdogUsedCache);
  const cacheFallback = /last-good|cache|cached|board-restore/i.test(String(ingestionFallback || ""));

  if ((ppLive || udLive) && !prizepicksUsedCache && !underdogUsedCache && !cacheFallback) {
    return "LIVE";
  }
  return "CACHE";
}

export function diagnoseProviderBottleneck(audit = {}, pipeline = {}) {
  const causes = [];
  const ppUsable = finiteCount(audit.prizepicksUsable);
  const udFetched = finiteCount(audit.underdogFetched);
  const udParsed = finiteCount(audit.underdogParsed);
  const combined = finiteCount(audit.combinedUsable);
  const candidates = finiteCount(audit.projectionCandidates);

  if (audit.prizepicksTimedOut && ppUsable === 0) {
    causes.push(1);
  }
  if (
    audit.underdogParserMismatch ||
    (udFetched > 0 && udParsed === 0) ||
    (udFetched > udParsed * 1.5 && udParsed > 0)
  ) {
    causes.push(2);
  }
  if (audit.feedMode === "CACHE" || finiteCount(audit.cacheUsable) > 0) {
    causes.push(3);
  }

  const normalized = finiteCount(pipeline.normalizedProps ?? combined);
  const afterSport = finiteCount(pipeline.afterSportFilter ?? combined);
  const afterMlb = finiteCount(pipeline.afterMlbOnlyFilter ?? afterSport);
  const sportDrop = normalized - afterSport;
  const mlbDrop = afterSport - afterMlb;
  if (sportDrop >= 20 || mlbDrop >= 20) {
    causes.push(4);
  }

  const eligDrop = combined - candidates;
  if (combined >= 50 && eligDrop >= 20) {
    causes.push(5);
  }

  const unique = [...new Set(causes)];
  return {
    codes: unique,
    labels: unique.map((code) => BOTTLENECK_LABELS[code] || String(code)),
    primary: unique[0] || null,
    summary:
      unique.length === 0
        ? "No single bottleneck — inspect stage counts."
        : unique.map((code) => `${code}) ${BOTTLENECK_LABELS[code]}`).join(" · "),
  };
}

/** @deprecated use diagnoseProviderBottleneck */
export function diagnoseProviderCoverageGap(audit = {}) {
  return diagnoseProviderBottleneck(audit, {
    normalizedProps: audit.combinedUsable,
    afterSportFilter: audit.combinedUsable,
    afterMlbOnlyFilter: audit.combinedUsable,
    projectionCandidates: audit.projectionCandidates,
  });
}

function computeCacheUsable({
  prizepicksUsable = 0,
  underdogUsable = 0,
  prizepicksUsedCache = false,
  underdogUsedCache = false,
  combinedUsable = 0,
  ingestionFallback = "",
} = {}) {
  let cache = 0;
  if (prizepicksUsedCache) cache += finiteCount(prizepicksUsable);
  if (underdogUsedCache) cache += finiteCount(underdogUsable);
  if (/last-good|cache|cached|board-restore/i.test(String(ingestionFallback || ""))) {
    cache = Math.max(cache, finiteCount(combinedUsable));
  }
  if (cache === 0 && (prizepicksUsedCache || underdogUsedCache)) {
    cache = finiteCount(prizepicksUsable) + finiteCount(underdogUsable);
  }
  return cache;
}

export function buildProviderCoverageAudit({
  debugInfo = {},
  pipelinePropCountAudit = null,
  prizePicksResult = null,
  underdogResult = null,
  prizePicksProps = [],
  underdogProps = [],
  providerFetchDiagnostics = null,
} = {}) {
  const ppSource = debugInfo.sources?.PrizePicks || {};
  const udSource = debugInfo.sources?.Underdog || {};
  const ppDiag = ppSource.diagnostics || getPrizePicksDiagnostics();
  const udParser = udSource.underdogParser || underdogResult?.debug?.underdogParser || null;
  const ppFetchDiag = providerFetchDiagnostics?.prizepicks || {};
  const udFetchDiag = providerFetchDiagnostics?.underdog || {};
  const pipeline = pipelinePropCountAudit || debugInfo.pipelinePropCountAudit || {};

  const prizepicksFetched = finiteCount(
    ppSource.rawPropsLoaded ?? ppDiag.rawPropCount ?? prizePicksResult?.debug?.rawPropsLoaded ?? 0
  );
  const prizepicksParsed = finiteCount(
    ppSource.propsAfterParsing ?? ppDiag.parsedPropsCount ?? prizePicksProps.length ?? 0
  );
  const prizepicksUsable = finiteCount(
    ppSource.usablePropsCount ?? ppDiag.validationCount ?? ppDiag.finalPropsCount ?? countUsableFromProps(prizePicksProps)
  );

  const underdogFetched = finiteCount(
    udSource.rawPropsLoaded ??
      underdogResult?.debug?.rawPropsLoaded ??
      underdogResult?.pipelineAudit?.fetched ??
      udParser?.rawCount ??
      0
  );
  const underdogParsed = finiteCount(
    udSource.propsAfterParsing ?? underdogResult?.debug?.propsAfterParsing ?? underdogProps.length ?? udParser?.acceptedCount ?? 0
  );
  const underdogUsable = finiteCount(udSource.usablePropsCount ?? countUsableFromProps(underdogProps));

  const combinedUsable = finiteCount(
    pipeline.afterLineValidation ?? pipeline.normalizedProps ?? debugInfo.pipelineProviderRaw?.afterCacheMerge ?? 0
  );
  const projectionCandidates = finiteCount(
    pipeline.projectionCandidates ?? pipeline.afterProjectionFilter ?? combinedUsable
  );
  const projected = finiteCount(
    pipeline.projectedProps ?? pipeline.afterProjectionMerge ?? countProjectedFromList([...(prizePicksProps || []), ...(underdogProps || [])])
  );
  const verified = finiteCount(pipeline.verifiedProps ?? pipeline.afterVerificationFilter);

  const prizepicksUsedCache = Boolean(
    prizePicksResult?.status === "Cached" ||
      prizePicksResult?.fallback ||
      ppDiag.usedCacheFallback ||
      /cached/i.test(String(ppSource.lineSourceBadge || ppSource.status || ""))
  );
  const underdogUsedCache = Boolean(
    underdogResult?.status === "Cached" ||
      underdogResult?.fallback ||
      /cached/i.test(String(udSource.lineSourceBadge || udSource.status || ""))
  );

  const prizepicksTimedOut = Boolean(
    ppFetchDiag.timedOut ||
      ppDiag.timedOut ||
      ppDiag.outerTimeout ||
      /timed out|timeout/i.test(String(ppSource.message || ppDiag.lastError || ""))
  );

  const underdogTimedOut = Boolean(
    udFetchDiag.timedOut ||
      /timed out|timeout/i.test(String(udSource.message || udFetchDiag.lastError || underdogResult?.warnings?.join(" ") || ""))
  );

  const cacheUsable = computeCacheUsable({
    prizepicksUsable,
    underdogUsable,
    prizepicksUsedCache,
    underdogUsedCache,
    combinedUsable,
    ingestionFallback: debugInfo.ingestionFallback || "",
  });

  const feedMode = resolveProviderFeedMode({
    prizepicksUsable,
    underdogUsable,
    prizepicksUsedCache,
    underdogUsedCache,
    prizepicksTimedOut,
    prizepicksLive: /live/i.test(String(ppSource.lineSourceBadge || "")) && !prizepicksUsedCache,
    underdogLive: /live/i.test(String(udSource.lineSourceBadge || "")) && !underdogUsedCache,
    ingestionFallback: debugInfo.ingestionFallback || "",
  });

  const underdogAudit = {
    rawProps: underdogFetched,
    mlbProps: countMlbProps(underdogProps),
    supportedProps: countSupportedProps(underdogProps),
    projectedProps: countProjectedFromList(underdogProps),
    parsedProps: underdogParsed,
    usableProps: underdogUsable,
    rejectionReasons: udParser?.rejectionReasons || {},
    parserMismatch: Boolean(udParser?.parserMismatch),
    usedCache: underdogUsedCache,
    timedOut: underdogTimedOut,
    timeoutStep: udFetchDiag.lastPhase || udParser?.lastTimeoutStep || "",
  };

  const audit = {
    prizepicksFetched,
    prizepicksParsed,
    prizepicksUsable,
    underdogFetched,
    underdogParsed,
    underdogUsable,
    cacheUsable,
    combinedUsable,
    projectionCandidates,
    projected,
    verified,
    feedMode,
    underdogAudit,
    prizepicksTimedOut,
    underdogTimedOut,
    prizepicksTimeoutStep:
      ppDiag.lastTimeoutLocation ||
      ppFetchDiag.lastPhase ||
      (prizepicksTimedOut ? "outer provider wrapper or fetch retry" : ""),
    underdogTimeoutStep: underdogAudit.timeoutStep,
    prizepicksUsedCache,
    underdogUsedCache,
    underdogParserMismatch: underdogAudit.parserMismatch,
    underdogRaw: underdogFetched,
    ingestionFallback: debugInfo.ingestionFallback || "",
    updatedAt: new Date().toISOString(),
  };

  audit.diagnosis = diagnoseProviderBottleneck(audit, pipeline);
  return audit;
}

export function logProviderCoverageSummary(audit = {}) {
  console.log("[Provider Coverage Report]");
  console.log("PrizePicks usable:", audit.prizepicksUsable ?? 0);
  console.log("Underdog usable:", audit.underdogUsable ?? 0);
  console.log("Cache usable:", audit.cacheUsable ?? 0);
  console.log("Projection candidates:", audit.projectionCandidates ?? 0);
  console.log("Projected props:", audit.projected ?? 0);
  console.log("Verified props:", audit.verified ?? 0);
  console.log("Feed mode:", audit.feedMode === "LIVE" ? "LIVE MODE" : "CACHE MODE");

  const ud = audit.underdogAudit || {};
  console.log("[Underdog Audit] raw props:", ud.rawProps ?? 0);
  console.log("[Underdog Audit] MLB props:", ud.mlbProps ?? 0);
  console.log("[Underdog Audit] supported props:", ud.supportedProps ?? 0);
  console.log("[Underdog Audit] projected props:", ud.projectedProps ?? 0);

  if (audit.prizepicksTimedOut && audit.prizepicksTimeoutStep) {
    console.warn("[PP TIMEOUT] step:", audit.prizepicksTimeoutStep);
  }
  if (audit.underdogTimedOut && audit.underdogTimeoutStep) {
    console.warn("[UD TIMEOUT] step:", audit.underdogTimeoutStep);
  }
  if (audit.diagnosis?.summary) {
    console.log("[Provider Coverage] Bottleneck:", audit.diagnosis.summary);
  }
  return audit;
}
