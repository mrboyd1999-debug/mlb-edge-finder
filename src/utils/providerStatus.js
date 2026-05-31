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

/** Resolve PrizePicks prop counts from feed, pipeline audit, and diagnostics. */
export function resolvePrizePicksPropCounts({
  feed = {},
  pipelinePropCountAudit = null,
  feedHealthContext = null,
  debugSources = null,
  prizePicksDiagnostics = null,
} = {}) {
  const contextFeed = feedHealthContext?.PrizePicks || {};
  const sourceRow = debugSources?.PrizePicks || {};
  const audit = pipelinePropCountAudit || feedHealthContext?.pipelinePropCountAudit || {};
  const diag = prizePicksDiagnostics || feed.diagnostics || getPrizePicksDiagnostics();

  const rawPrizePicksProps = Math.max(
    finite(feed.rawCount ?? feed.rawPropsLoaded),
    finite(contextFeed.rawCount ?? contextFeed.rawPropsLoaded),
    finite(sourceRow.rawPropsLoaded ?? sourceRow.rawCount),
    finite(audit.rawPrizePicks),
    finite(diag.rawPropCount)
  );
  const normalizedPrizePicksProps = Math.max(
    finite(feed.normalizedCount ?? feed.normalizedProps),
    finite(contextFeed.normalizedCount),
    finite(sourceRow.normalizedCount),
    finite(diag.normalizedCount)
  );
  const parsedPrizePicksProps = Math.max(
    finite(feed.parsedCount ?? feed.propsAfterParsing),
    finite(contextFeed.parsedCount ?? contextFeed.propsAfterParsing),
    finite(sourceRow.propsAfterParsing ?? sourceRow.parsedCount),
    finite(diag.parsedPropsCount),
    finite(diag.finalPropsCount)
  );

  return { rawPrizePicksProps, normalizedPrizePicksProps, parsedPrizePicksProps };
}

export function prizePicksFeedIsConnected(counts = {}) {
  return (
    counts.rawPrizePicksProps > 0 ||
    counts.normalizedPrizePicksProps > 0 ||
    counts.parsedPrizePicksProps > 0
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
    counts.rawPrizePicksProps === 0 &&
    counts.normalizedPrizePicksProps === 0 &&
    counts.parsedPrizePicksProps === 0
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
