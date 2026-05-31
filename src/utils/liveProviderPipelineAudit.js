/**
 * Live provider ingestion pipeline — trace where props disappear (no projection/tier math changes).
 */

import { countMergedProjections } from "./projectionCoverageAudit.js";
import { normalizeSource } from "./normalizeSource.js";
import { getPrizePicksDiagnostics } from "./prizepicksDiagnostics.js";
import { getProviderFetchDiagnostics } from "./providerFetchDiagnostics.js";
import {
  LIVE_STAGE_LABELS,
  auditProviderEndpoints,
  detectEndpointDeprecated,
  resolveExactFailureReason,
} from "./liveFeedFailureAnalysis.js";

/** @deprecated use LIVE_STAGE_LABELS for ingestion diagnostics display */
export const PIPELINE_STAGE_LABELS = LIVE_STAGE_LABELS;

export const FAILURE_POINTS = {
  NONE: "",
  FETCH: "fetch failure",
  PARSER: "parser failure",
  NORMALIZATION: "normalization failure",
  FILTER: "filter failure",
  PROJECTION: "projection filter failure",
  VERIFICATION: "verification filter failure",
  NOT_CONFIGURED: "not configured",
  TIMEOUT: "timeout",
};

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function filterPlatformProps(props = [], platform = "") {
  const key = String(platform || "").toLowerCase();
  if (!key) return [];
  return (props || []).filter((prop) => normalizeSource(prop) === key);
}

function countUsableProps(props = []) {
  return (props || []).filter((prop) => {
    const player = String(prop?.playerName || prop?.player || "").trim();
    const line = Number(prop?.line);
    return player && Number.isFinite(line) && line > 0;
  }).length;
}

function countVerifiedProps(props = []) {
  return (props || []).filter(
    (prop) =>
      Boolean(prop?.verified) ||
      Boolean(prop?.verifiedTier) ||
      prop?.pickTierLabel === "Verified Play"
  ).length;
}

function formatUrlStatus({ httpStatus, timedOut, notConfigured, requestSent, responseReceived, usedCache, liveFetchFailed } = {}) {
  if (notConfigured) return "not configured";
  if (timedOut) return "timeout";
  if (usedCache && liveFetchFailed) return "live failed · cache served";
  if (!requestSent) return "request not sent";
  if (responseReceived && Number.isFinite(Number(httpStatus))) {
    const code = Number(httpStatus);
    if (code >= 200 && code < 300) return `${code} OK`;
    if (code === 429) return "429 rate limited";
    return `${code} error`;
  }
  if (requestSent && !responseReceived) return "no response";
  return "unknown";
}

export function resolveProviderFailurePoint({
  fetched = 0,
  parsed = 0,
  normalized = 0,
  projected = 0,
  verified = 0,
  timedOut = false,
  notConfigured = false,
  usedCache = false,
  liveFetchFailed = false,
  parserMismatch = false,
} = {}) {
  if (notConfigured) return FAILURE_POINTS.NOT_CONFIGURED;
  if (timedOut && fetched === 0) return FAILURE_POINTS.TIMEOUT;
  if (fetched === 0 && (liveFetchFailed || !usedCache)) return FAILURE_POINTS.FETCH;
  if (fetched > 0 && parsed === 0) return parserMismatch ? FAILURE_POINTS.PARSER : FAILURE_POINTS.PARSER;
  if (parsed > 0 && normalized === 0) return FAILURE_POINTS.NORMALIZATION;
  if (normalized > 0 && projected === 0) return FAILURE_POINTS.PROJECTION;
  if (projected > 0 && verified === 0) return FAILURE_POINTS.VERIFICATION;
  if (normalized === 0 && parsed > 0) return FAILURE_POINTS.FILTER;
  return FAILURE_POINTS.NONE;
}

function buildProviderPipelineRow(
  platformKey,
  {
    result = null,
    props = [],
    displayProps = [],
    sourceMeta = {},
    fetchDiag = {},
    ppDiag = null,
  } = {}
) {
  const usedCache = Boolean(
    result?.status === "Cached" ||
      result?.usedCacheFallback ||
      result?.fallback ||
      /cached/i.test(String(result?.lineSourceBadge || sourceMeta.lineSourceBadge || ""))
  );
  const liveFetchFailed = Boolean(
    result?.liveFetchFailed || (result?.error && !result?.notConfigured) || (result?.timedOut && !usedCache)
  );
  const timedOut = Boolean(
    fetchDiag.timedOut ||
      result?.timedOut ||
      /timed?\s*out/i.test(String(sourceMeta.message || fetchDiag.lastError || result?.warnings?.join(" ") || ""))
  );
  const notConfigured = Boolean(result?.notConfigured || fetchDiag.notConfigured || result?.status === "Not configured");

  const fetched = liveFetchFailed
    ? finiteCount(fetchDiag.rawPropCount)
    : finiteCount(
        fetchDiag.rawPropCount ??
          sourceMeta.rawPropsLoaded ??
          result?.debug?.rawPropsLoaded ??
          result?.pipelineAudit?.fetched ??
          0
      );
  const parsed = liveFetchFailed
    ? finiteCount(fetchDiag.parsedPropsCount)
    : finiteCount(
        fetchDiag.parsedPropsCount ??
          sourceMeta.propsAfterParsing ??
          result?.debug?.propsAfterParsing ??
          props.length
      );
  const platformDisplay = filterPlatformProps(displayProps, platformKey);
  const filtered = countUsableProps(props.length ? props : platformDisplay);
  const normalized = liveFetchFailed
    ? finiteCount(fetchDiag.finalPropsCount || fetchDiag.parsedPropsCount)
    : finiteCount(
        sourceMeta.propsAfterParsing ??
          result?.debug?.propsAfterParsing ??
          parsed
      );
  const projected = countMergedProjections(platformDisplay.length ? platformDisplay : props);
  const verified = countVerifiedProps(platformDisplay);

  const endpointDeprecated = detectEndpointDeprecated({
    httpStatus: fetchDiag.httpStatus,
    lastError: fetchDiag.lastError || sourceMeta.message,
    endpointsTried: sourceMeta.endpointsTried || result?.debug?.endpointsTried,
  });

  const exactFailure = resolveExactFailureReason({
    httpStatus: fetchDiag.httpStatus,
    timedOut,
    notConfigured,
    lastError: fetchDiag.lastError || fetchDiag.failureReason || sourceMeta.message || result?.warnings?.[0] || "",
    fetched,
    parsed,
    normalized,
    filtered,
    endpointDeprecated,
    nonJson: Boolean(fetchDiag.blockedPayloadDetected || /non-json|invalid json/i.test(String(fetchDiag.lastError || ""))),
    usedCache,
    liveFetchFailed,
  });

  const stages = {
    [LIVE_STAGE_LABELS.FETCHED]: fetched,
    [LIVE_STAGE_LABELS.PARSED]: parsed,
    [LIVE_STAGE_LABELS.NORMALIZED]: normalized,
    [LIVE_STAGE_LABELS.FILTERED]: filtered,
  };

  const failurePoint = resolveProviderFailurePoint({
    fetched,
    parsed,
    normalized,
    projected,
    verified,
    timedOut,
    notConfigured,
    usedCache,
    liveFetchFailed,
    parserMismatch: Boolean(sourceMeta.underdogParser?.parserMismatch || result?.debug?.underdogParser?.parserMismatch),
  });

  return {
    platform: platformKey,
    requestUrl: fetchDiag.requestUrl || sourceMeta.apiUrl || result?.debug?.apiUrl || "",
    endpoint: fetchDiag.requestUrl || sourceMeta.apiUrl || result?.debug?.apiUrl || "",
    urlStatus: formatUrlStatus({
      httpStatus: fetchDiag.httpStatus,
      timedOut,
      notConfigured,
      requestSent: fetchDiag.requestSent,
      responseReceived: fetchDiag.responseReceived,
      usedCache,
      liveFetchFailed,
    }),
    httpStatus: fetchDiag.httpStatus ?? null,
    responseSize: finiteCount(fetchDiag.payloadSize),
    responseBytes: finiteCount(fetchDiag.payloadSize),
    responseTimeMs: fetchDiag.responseTimeMs ?? null,
    lastSuccessfulFetchAt:
      sourceMeta.lastSuccessfulFetchAt ||
      result?.lastSuccessfulFetchAt ||
      (usedCache ? ppDiag?.lastSuccessfulFetchAt : "") ||
      "",
    stages,
    fetched,
    parsed,
    normalized,
    filtered,
    projected,
    verified,
    failurePoint,
    exactFailureReason: exactFailure.label || "",
    exactFailureCode: exactFailure.code || "",
    endpointDeprecated,
    timedOut,
    notConfigured,
    usedCache,
    liveFetchFailed,
    lastPhase: fetchDiag.lastPhase || "",
    lastError: fetchDiag.lastError || fetchDiag.failureReason || sourceMeta.message || result?.warnings?.[0] || "",
    failureCategory: fetchDiag.failureCategory || "",
  };
}

export function buildLiveProviderPipelineAudit({
  prizePicksResult = null,
  underdogResult = null,
  prizePicksProps = [],
  underdogProps = [],
  providerFetchDiagnostics = null,
  debugInfo = null,
  allDisplayProps = [],
} = {}) {
  const fetchDiag = providerFetchDiagnostics || debugInfo?.providerFetchDiagnostics || getProviderFetchDiagnostics();
  const ppSource = debugInfo?.sources?.PrizePicks || {};
  const udSource = debugInfo?.sources?.Underdog || {};
  const ppDiag = ppSource.diagnostics || getPrizePicksDiagnostics();

  const prizepicks = buildProviderPipelineRow("prizepicks", {
    result: prizePicksResult,
    props: prizePicksProps,
    displayProps: allDisplayProps,
    sourceMeta: ppSource,
    fetchDiag: fetchDiag?.prizepicks || {},
    ppDiag,
  });

  const underdog = buildProviderPipelineRow("underdog", {
    result: underdogResult,
    props: underdogProps,
    displayProps: allDisplayProps,
    sourceMeta: udSource,
    fetchDiag: fetchDiag?.underdog || {},
  });

  const cacheBoardProps = finiteCount(debugInfo?.providerCoverageAudit?.cacheUsable);
  const liveCombinedFetched = prizepicks.fetched + underdog.fetched;
  const endpointAudit = auditProviderEndpoints();

  return {
    prizepicks,
    underdog,
    cacheBoardProps,
    liveCombinedFetched,
    endpointAudit,
    updatedAt: new Date().toISOString(),
  };
}

export function logLiveProviderPipelineTrace(audit = {}) {
  for (const key of ["prizepicks", "underdog"]) {
    const row = audit[key];
    if (!row) continue;
    console.log(`[Live Pipeline] ${key} fetch result`, {
      url: row.requestUrl,
      urlStatus: row.urlStatus,
      responseSize: row.responseSize,
      fetched: row.fetched,
      failurePoint: row.failurePoint || "none",
      timedOut: row.timedOut,
      usedCache: row.usedCache,
    });
    console.log(`[Live Pipeline] ${key} parser result`, {
      parsed: row.parsed,
      failurePoint: row.parsed === 0 && row.fetched > 0 ? FAILURE_POINTS.PARSER : "",
    });
    console.log(`[Live Pipeline] ${key} normalization result`, {
      normalized: row.normalized,
      parsed: row.parsed,
      failurePoint: row.normalized === 0 && row.parsed > 0 ? FAILURE_POINTS.NORMALIZATION : "",
    });
    console.log(`[Live Pipeline] ${key} filter result`, {
      filtered: row.filtered,
      normalized: row.normalized,
      failurePoint: row.filtered === 0 && row.normalized > 0 ? FAILURE_POINTS.FILTER : "",
    });
    console.log(`[Live Pipeline] ${key} stage counts`, row.stages);
    if (row.exactFailureReason) {
      console.warn(`[Live Pipeline] ${key} exact failure:`, row.exactFailureReason, {
        code: row.exactFailureCode,
        httpStatus: row.httpStatus,
        responseTimeMs: row.responseTimeMs,
        responseBytes: row.responseBytes,
      });
    }
    if (row.failurePoint) {
      console.warn(`[Live Pipeline] ${key} failure point:`, row.failurePoint, {
        lastPhase: row.lastPhase,
        lastError: row.lastError,
      });
    }
  }
  console.log("[Live Pipeline] summary", {
    liveCombinedFetched: audit.liveCombinedFetched,
    cacheBoardProps: audit.cacheBoardProps,
  });
  return audit;
}

export function mergeLiveFeedDiagnosticsIntoAudit(coverageAudit = {}, livePipelineAudit = null) {
  if (!livePipelineAudit) return coverageAudit;
  const pp = livePipelineAudit.prizepicks || {};
  const ud = livePipelineAudit.underdog || {};

  return {
    ...coverageAudit,
    liveFeedDiagnostics: livePipelineAudit,
    prizepicksLiveFetched: pp.fetched,
    underdogLiveFetched: ud.fetched,
    prizepicksFailurePoint: pp.exactFailureReason || pp.failurePoint || "",
    underdogFailurePoint: ud.exactFailureReason || ud.failurePoint || "",
    prizepicksExactFailure: pp.exactFailureReason || "",
    underdogExactFailure: ud.exactFailureReason || "",
    prizepicksEndpointDeprecated: pp.endpointDeprecated,
    underdogEndpointDeprecated: ud.endpointDeprecated,
    prizepicksUrlStatus: pp.urlStatus,
    underdogUrlStatus: ud.urlStatus,
    prizepicksResponseSize: pp.responseSize,
    underdogResponseSize: ud.responseSize,
    lastSuccessfulFetchAt: [pp.lastSuccessfulFetchAt, ud.lastSuccessfulFetchAt]
      .filter(Boolean)
      .sort()
      .pop() || "",
  };
}
