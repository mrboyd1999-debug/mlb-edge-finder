/**
 * Provider status — PrizePicks is Connected when ingestion produced props.
 */

import { getPrizePicksDiagnostics } from "./prizepicksDiagnostics.js";

export const PROVIDER_STATUS_COLOR = {
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red",
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function countUsableFromProps(props = []) {
  return (props || []).filter((prop) => {
    const player = String(prop?.playerName || prop?.player || "").trim();
    const line = Number(prop?.line);
    return player && Number.isFinite(line) && line > 0;
  }).length;
}

/** Resolve PrizePicks prop counts from feed, pipeline audit, and diagnostics. */
export function resolvePrizePicksPropCounts({
  feed = {},
  pipelinePropCountAudit = null,
  feedHealthContext = null,
  debugSources = null,
  prizePicksDiagnostics = null,
  prizePicksResult = null,
  prizePicksProps = null,
  debugInfo = null,
} = {}) {
  const contextFeed = feedHealthContext?.PrizePicks || {};
  const sourceRow = debugSources?.PrizePicks || debugInfo?.sources?.PrizePicks || {};
  const audit = pipelinePropCountAudit || feedHealthContext?.pipelinePropCountAudit || debugInfo?.pipelinePropCountAudit || {};
  const diag = prizePicksDiagnostics || feed.diagnostics || sourceRow.diagnostics || getPrizePicksDiagnostics();
  const propsList = Array.isArray(prizePicksProps) ? prizePicksProps : [];
  const propsLen = propsList.length;
  const usableFromProps = countUsableFromProps(propsList);

  const rawPrizePicksProps = Math.max(
    finite(feed.rawCount ?? feed.rawPropsLoaded),
    finite(contextFeed.rawCount ?? contextFeed.rawPropsLoaded),
    finite(sourceRow.rawPropsLoaded ?? sourceRow.rawCount),
    finite(audit.rawPrizePicks),
    finite(diag.rawPropCount),
    finite(prizePicksResult?.debug?.rawPropsLoaded),
    propsLen
  );
  const normalizedPrizePicksProps = Math.max(
    finite(feed.normalizedCount ?? feed.normalizedProps),
    finite(contextFeed.normalizedCount ?? contextFeed.normalizedProps),
    finite(sourceRow.normalizedCount),
    finite(audit.normalizedPrizePicks),
    finite(diag.normalizedCount),
    finite(prizePicksResult?.debug?.normalizedCount)
  );
  const parsedPrizePicksProps = Math.max(
    finite(feed.parsedCount ?? feed.propsAfterParsing),
    finite(contextFeed.parsedCount ?? contextFeed.propsAfterParsing),
    finite(sourceRow.propsAfterParsing ?? sourceRow.parsedCount),
    finite(audit.parsedPrizePicks),
    finite(diag.parsedPropsCount),
    finite(diag.finalPropsCount),
    finite(prizePicksResult?.debug?.propsAfterParsing),
    propsLen
  );
  const usablePrizePicksProps = Math.max(
    finite(sourceRow.usablePropsCount),
    finite(diag.validationCount),
    finite(diag.finalPropsCount),
    finite(prizePicksResult?.debug?.usablePropsCount),
    parsedPrizePicksProps,
    usableFromProps,
    propsLen
  );

  return { rawPrizePicksProps, normalizedPrizePicksProps, parsedPrizePicksProps, usablePrizePicksProps };
}

/** Usable PP count — parsed/normalized/props beat raw-only failure checks. */
export function resolvePrizePicksUsableCount(counts = {}, prizePicksProps = 0) {
  const propsCount = finite(prizePicksProps);
  return Math.max(
    finite(counts.parsedPrizePicksProps),
    finite(counts.normalizedPrizePicksProps),
    propsCount,
    finite(counts.usablePrizePicksProps),
    finite(counts.rawPrizePicksProps)
  );
}

/** Usable Underdog count — prefer parsed/usable over raw-only checks. */
export function resolveUnderdogUsableCount(counts = {}, underdogProps = 0) {
  const propsCount = finite(underdogProps);
  return Math.max(
    finite(counts.usableUnderdogProps),
    finite(counts.parsedUnderdogProps),
    finite(counts.normalizedUnderdogProps),
    propsCount,
    finite(counts.rawUnderdogProps)
  );
}

export function resolvePrizePicksLiveFeedStatus(
  counts = {},
  { evidence = {}, liveRow = {}, audit = null, usedCache = false } = {}
) {
  const usable = resolvePrizePicksUsableCount(
    counts,
    audit?.prizepicksParsed ?? audit?.prizepicksUsable ?? 0
  );
  if (usable > 0) {
    const cached = Boolean(usedCache || audit?.prizepicksUsedCache);
    return {
      status: cached ? "Connected via cache" : "Connected",
      failed: false,
      usable,
      reason: "",
      detail: `${usable} props`,
    };
  }

  const httpStatus = Number(evidence?.httpStatus ?? liveRow?.httpStatus);
  const errorText = String(
    evidence?.error || liveRow?.lastError || audit?.prizepicksFailureReason || ""
  );
  let reason = "0 props";
  if (/timeout/i.test(errorText) || liveRow?.timedOut || audit?.prizepicksTimedOut) reason = "timeout";
  else if (httpStatus === 403) reason = "403";
  else if (httpStatus === 404) reason = "404";
  else if (evidence?.responseSize === 0 || evidence?.emptyPayload) reason = "empty payload";
  else if (!evidence?.fetchSuccess) reason = "fetch failed";

  return {
    status: "Failed",
    failed: true,
    usable: 0,
    reason,
    detail: reason,
  };
}

export function resolveUnderdogLiveFeedStatus(
  counts = {},
  { audit = null, usedCache = false } = {}
) {
  const usable = resolveUnderdogUsableCount(
    counts,
    audit?.underdogUsable ?? audit?.underdogParsed ?? 0
  );
  if (usable > 0) {
    const cached = Boolean(usedCache || audit?.underdogUsedCache);
    return {
      status: cached ? "Connected via cache" : "Connected",
      failed: false,
      usable,
      reason: "",
      detail: `${usable} props`,
    };
  }
  return {
    status: "Failed",
    failed: true,
    usable: 0,
    reason: audit?.underdogFailureReason || "0 props",
    detail: audit?.underdogFailureReason || "0 props",
  };
}

/** Resolve Underdog prop counts from the same cross-source audit fields. */
export function resolveUnderdogPropCounts({
  feed = {},
  pipelinePropCountAudit = null,
  feedHealthContext = null,
  debugSources = null,
  underdogResult = null,
  underdogProps = null,
  debugInfo = null,
} = {}) {
  const contextFeed = feedHealthContext?.Underdog || {};
  const sourceRow = debugSources?.Underdog || debugInfo?.sources?.Underdog || {};
  const audit = pipelinePropCountAudit || feedHealthContext?.pipelinePropCountAudit || debugInfo?.pipelinePropCountAudit || {};
  const udParser = sourceRow.underdogParser || underdogResult?.debug?.underdogParser || null;
  const propsList = Array.isArray(underdogProps) ? underdogProps : [];
  const propsLen = propsList.length;
  const usableFromProps = countUsableFromProps(propsList);

  const rawUnderdogProps = Math.max(
    finite(feed.rawCount ?? feed.rawPropsLoaded),
    finite(contextFeed.rawCount ?? contextFeed.rawPropsLoaded),
    finite(sourceRow.rawPropsLoaded ?? sourceRow.rawCount),
    finite(audit.rawUnderdog),
    finite(underdogResult?.debug?.rawPropsLoaded),
    finite(underdogResult?.pipelineAudit?.fetched),
    finite(udParser?.rawCount),
    propsLen
  );
  const normalizedUnderdogProps = Math.max(
    finite(feed.normalizedCount ?? feed.normalizedProps),
    finite(contextFeed.normalizedCount ?? contextFeed.normalizedProps),
    finite(sourceRow.normalizedCount),
    finite(audit.normalizedUnderdog),
    finite(underdogResult?.debug?.normalizedCount)
  );
  const parsedUnderdogProps = Math.max(
    finite(feed.parsedCount ?? feed.propsAfterParsing),
    finite(contextFeed.parsedCount ?? contextFeed.propsAfterParsing),
    finite(sourceRow.propsAfterParsing ?? sourceRow.parsedCount),
    finite(audit.parsedUnderdog),
    finite(underdogResult?.debug?.propsAfterParsing),
    finite(udParser?.acceptedCount),
    propsLen
  );
  const usableUnderdogProps = Math.max(
    finite(feed.activeUsableCount ?? feed.usableCount),
    finite(sourceRow.usablePropsCount),
    finite(underdogResult?.debug?.usablePropsCount),
    parsedUnderdogProps,
    usableFromProps,
    propsLen
  );

  return { rawUnderdogProps, normalizedUnderdogProps, parsedUnderdogProps, usableUnderdogProps };
}

export function prizePicksFeedIsConnected(counts = {}) {
  return (
    counts.rawPrizePicksProps > 0 ||
    counts.normalizedPrizePicksProps > 0 ||
    counts.parsedPrizePicksProps > 0 ||
    counts.usablePrizePicksProps > 0
  );
}

export function underdogFeedIsConnected(counts = {}) {
  return (
    counts.rawUnderdogProps > 0 ||
    counts.normalizedUnderdogProps > 0 ||
    counts.parsedUnderdogProps > 0 ||
    counts.usableUnderdogProps > 0
  );
}

export function resolvePrizePicksLiveFetchFailed(feed = {}) {
  return Boolean(
    feed.fetchFailed ||
      feed.timedOut ||
      /failed|unavailable|offline|not configured/i.test(
        String(feed.status || feed.statusLabel || feed.lastError || "")
      )
  );
}

function formatCacheAgeLabel(feed = {}) {
  return feed.cacheAge || "—";
}

/** PrizePicks health — Connected when any ingestion count is positive. */
export function resolvePrizePicksProviderHealth(
  feed = {},
  {
    alternatePropSourcesAvailable = false,
    pipelinePropCountAudit = null,
    feedHealthContext = null,
    debugSources = null,
    prizePicksDiagnostics = null,
  } = {}
) {
  const counts = resolvePrizePicksPropCounts({
    feed,
    pipelinePropCountAudit,
    feedHealthContext,
    debugSources,
    prizePicksDiagnostics,
  });
  const propsReturned = Math.max(
    counts.usablePrizePicksProps,
    counts.parsedPrizePicksProps,
    counts.normalizedPrizePicksProps,
    counts.rawPrizePicksProps
  );
  const debug = {
    endpointTested: feed.endpoint || "/prizepicks/props",
    responseCode: feed.httpStatus ?? null,
    lastChecked: feed.lastFetchAt || null,
    cacheAge: formatCacheAgeLabel(feed),
    propsReturned,
    keyPresent: Boolean(feed.httpExecuted ?? feed.diagnostics?.httpExecuted ?? true),
    failureReason: feed.lastError || feed.statusLabel || "",
    ...counts,
  };

  if (prizePicksFeedIsConnected(counts)) {
    return {
      status: "Connected",
      color: PROVIDER_STATUS_COLOR.GREEN,
      detail: `${propsReturned} props`,
      debug: { ...debug, failureReason: "" },
      counts,
    };
  }

  const liveFetchFailed = resolvePrizePicksLiveFetchFailed(feed);
  if (
    alternatePropSourcesAvailable &&
    liveFetchFailed &&
    !prizePicksFeedIsConnected(counts)
  ) {
    return {
      status: "Optional unavailable",
      color: PROVIDER_STATUS_COLOR.GREEN,
      detail: "Other prop sources are supplying lines",
      debug: { ...debug, failureReason: feed.lastError || "Live fetch failed — optional provider" },
      counts,
    };
  }

  if (feed.timedOut || feed.fetchFailed) {
    return {
      status: "Temporarily unavailable",
      color: PROVIDER_STATUS_COLOR.YELLOW,
      detail: feed.lastError || "PrizePicks feed timed out",
      debug,
      counts,
    };
  }

  return {
    status: "Temporarily unavailable",
    color: PROVIDER_STATUS_COLOR.YELLOW,
    detail: feed.lastError || "PrizePicks feed unavailable",
    debug: { ...debug, failureReason: feed.lastError || "No usable props" },
    counts,
  };
}
