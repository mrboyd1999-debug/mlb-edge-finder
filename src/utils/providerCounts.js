/**
 * Shared provider prop counts — single source for status/audit/ingestion panels.
 */

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function maxCount(...values) {
  return values.reduce((max, value) => Math.max(max, finite(value)), 0);
}

function arrayLen(value) {
  return Array.isArray(value) ? value.length : 0;
}

function resolveHttpStatus(source = {}) {
  return Number(
    source.evidence?.httpStatus ??
      source.liveRow?.httpStatus ??
      source.httpStatus ??
      source.feed?.httpStatus ??
      0
  );
}

/** Highest non-zero PrizePicks count across feed, audit, evidence, and debug fields. */
export function getPrizePicksUsableCount(source = {}) {
  const pp = source.prizePicks || source.prizepicks || {};
  const debug = source.debug || source.debugInfo || {};
  const counts = source.prizepicksPropCounts || source.ppCounts || {};
  const evidence = source.evidence || source.ppEvidence || {};
  const audit = source.audit || {};
  const live = source.liveRow || source.ppLive || source.feed || source.live?.prizepicks || {};
  const pipeline = source.pipelinePropCountAudit || audit.pipelinePropCountAudit || {};

  return maxCount(
    source.prizePicksProps,
    arrayLen(source.prizePicksProps),
    source.parsedPrizePicksProps,
    audit.prizepicksParsed,
    audit.prizepicksUsable,
    counts.parsedPrizePicksProps,
    counts.usablePrizePicksProps,
    counts.normalizedPrizePicksProps,
    source.normalizedPrizePicksProps,
    source.usablePrizePicksProps,
    counts.rawPrizePicksProps,
    source.rawPrizePicksProps,
    audit.prizepicksFetched,
    pipeline.rawPrizePicks,
    arrayLen(pp.props),
    pp.parsed,
    pp.normalized,
    pp.usable,
    live.parsed,
    live.normalized,
    live.filtered,
    live.fetched,
    live.parsedCount,
    live.propsAfterParsing,
    live.rawCount,
    live.rawPropsLoaded,
    debug.parsedPrizePicksProps,
    debug.normalizedPrizePicksProps,
    debug.rawPrizePicksProps,
    evidence?.counts?.parsed,
    evidence?.counts?.normalized,
    evidence?.counts?.usable,
    evidence?.counts?.raw
  );
}

export function getPrizePicksRawCount(source = {}) {
  const counts = source.prizepicksPropCounts || source.ppCounts || {};
  const audit = source.audit || {};
  const evidence = source.evidence || source.ppEvidence || {};
  const live = source.liveRow || source.ppLive || source.feed || {};
  const debug = source.debug || source.debugInfo || {};

  return maxCount(
    source.rawPrizePicksProps,
    counts.rawPrizePicksProps,
    audit.prizepicksFetched,
    debug.rawPrizePicksProps,
    evidence?.counts?.raw,
    live.fetched,
    live.rawCount,
    live.rawPropsLoaded
  );
}

export function getPrizePicksParsedCount(source = {}) {
  const usable = getPrizePicksUsableCount(source);
  const counts = source.prizepicksPropCounts || source.ppCounts || {};
  const audit = source.audit || {};
  const evidence = source.evidence || source.ppEvidence || {};
  const live = source.liveRow || source.ppLive || source.feed || {};

  return maxCount(
    usable,
    source.parsedPrizePicksProps,
    counts.parsedPrizePicksProps,
    audit.prizepicksParsed,
    evidence?.counts?.parsed,
    live.parsed,
    live.parsedCount,
    live.propsAfterParsing
  );
}

/** Highest non-zero Underdog count across feed, audit, evidence, and debug fields. */
export function getUnderdogUsableCount(source = {}) {
  const ud = source.underdog || {};
  const debug = source.debug || source.debugInfo || {};
  const counts = source.underdogPropCounts || source.udCounts || {};
  const evidence = source.evidence || source.udEvidence || {};
  const audit = source.audit || {};
  const live = source.liveRow || source.udLive || source.feed || source.live?.underdog || {};
  const pipeline = source.pipelinePropCountAudit || audit.pipelinePropCountAudit || {};

  return maxCount(
    source.underdogProps,
    arrayLen(source.underdogProps),
    source.parsedUnderdogProps,
    source.usableUnderdogProps,
    audit.underdogUsable,
    audit.underdogParsed,
    counts.usableUnderdogProps,
    counts.parsedUnderdogProps,
    counts.normalizedUnderdogProps,
    source.normalizedUnderdogProps,
    counts.rawUnderdogProps,
    source.rawUnderdogProps,
    audit.underdogFetched,
    pipeline.rawUnderdog,
    source.mergedPropsFromUnderdog,
    source.renderedUnderdogProps,
    audit?.underdogAudit?.usableProps,
    audit?.underdogAudit?.parsedProps,
    arrayLen(ud.props),
    ud.parsed,
    ud.normalized,
    ud.usable,
    live.parsed,
    live.normalized,
    live.filtered,
    live.fetched,
    live.parsedCount,
    live.propsAfterParsing,
    debug.parsedUnderdogProps,
    debug.normalizedUnderdogProps,
    debug.rawUnderdogProps,
    evidence?.counts?.parsed,
    evidence?.counts?.normalized,
    evidence?.counts?.usable,
    evidence?.counts?.raw
  );
}

export function getUnderdogRawCount(source = {}) {
  const counts = source.underdogPropCounts || source.udCounts || {};
  const audit = source.audit || {};
  const evidence = source.evidence || source.udEvidence || {};
  const live = source.liveRow || source.udLive || source.feed || {};

  return maxCount(
    source.rawUnderdogProps,
    counts.rawUnderdogProps,
    audit.underdogFetched,
    evidence?.counts?.raw,
    live.fetched,
    live.rawCount
  );
}

export function getUnderdogParsedCount(source = {}) {
  const usable = getUnderdogUsableCount(source);
  const counts = source.underdogPropCounts || source.udCounts || {};
  const audit = source.audit || {};

  return maxCount(usable, counts.parsedUnderdogProps, audit.underdogParsed);
}

export function resolvePrizePicksConnectionStatus(source = {}) {
  const usable = getPrizePicksUsableCount(source);
  const raw = getPrizePicksRawCount(source);
  const parsed = getPrizePicksParsedCount(source);
  const httpStatus = resolveHttpStatus(source);
  const usedCache = Boolean(
    source.usedCache ||
      source.audit?.prizepicksUsedCache ||
      /cache/i.test(String(source.audit?.prizepicksLiveStatus || ""))
  );
  const cachedProps = usedCache && usable > 0;

  if (usable > 0) {
    return {
      status: usedCache ? "Connected via cache" : "Connected",
      failed: false,
      usable,
      raw,
      parsed,
      detail: `${usable} props`,
      reason: "",
      note: raw === 0 && parsed > 0 ? "Connected from parsed payload" : "",
    };
  }

  const httpOk = httpStatus >= 200 && httpStatus < 300;
  if (cachedProps) {
    return {
      status: "Connected via cache",
      failed: false,
      usable,
      raw,
      parsed,
      detail: `${usable} props`,
      reason: "",
      note: "",
    };
  }

  if (usable === 0 && !cachedProps && !httpOk) {
    const errorText = String(
      source.evidence?.error ||
        source.liveRow?.lastError ||
        source.audit?.prizepicksFailureReason ||
        ""
    );
    let reason = "0 props";
    if (/timeout/i.test(errorText) || source.liveRow?.timedOut || source.audit?.prizepicksTimedOut) {
      reason = "timeout";
    } else if (httpStatus === 403) reason = "403";
    else if (httpStatus === 404) reason = "404";
    else if (source.evidence?.responseSize === 0 || source.evidence?.emptyPayload) reason = "empty payload";
    else if (source.evidence?.fetchSuccess === false) reason = "fetch failed";

    return {
      status: "Failed",
      failed: true,
      usable: 0,
      raw,
      parsed: 0,
      detail: reason,
      reason,
      note: "",
    };
  }

  return {
    status: "Failed",
    failed: true,
    usable: 0,
    raw,
    parsed: 0,
    detail: "0 props",
    reason: "0 props",
    note: "",
  };
}

export function resolveUnderdogConnectionStatus(source = {}) {
  const usable = getUnderdogUsableCount(source);
  const usedCache = Boolean(source.usedCache || source.audit?.underdogUsedCache);

  if (usable > 0) {
    return {
      status: usedCache ? "Connected via cache" : "Connected",
      failed: false,
      usable,
      detail: `${usable} props`,
      reason: "",
      note: "",
    };
  }

  return {
    status: "Failed",
    failed: true,
    usable: 0,
    detail: source.audit?.underdogFailureReason || "0 props",
    reason: source.audit?.underdogFailureReason || "0 props",
    note: "",
  };
}

export function getMergedProviderPropCount(source = {}) {
  const audit = source.audit || {};
  const pipeline = source.pipelinePropCountAudit || audit.pipelinePropCountAudit || {};
  const prizePicksUsable = getPrizePicksUsableCount(source);
  const underdogUsable = getUnderdogUsableCount(source);

  return maxCount(
    pipeline.combinedRaw,
    audit.combinedUsable,
    audit.combinedProps,
    prizePicksUsable + underdogUsable
  );
}
