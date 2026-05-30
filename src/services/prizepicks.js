import { lineFeedJsonHeaders, resilientFetch } from "./fetchUtil.js";
import {
  getLineFeedTimeoutMs,
  LINE_FEED_MAX_RETRIES,
  LINE_FEED_RETRY_DELAY_MS,
  PRIZEPICKS_PROVIDER_TIMEOUT_MS,
  PRIZEPICKS_RETRY_TIMEOUTS_MS,
} from "../utils/apiTimeout.js";
import { safeParseJSON } from "../utils/safeParseJSON.js";
import { normalizeGameStartTime, startTimeUncertainty } from "../utils/normalizeGameStartTime.js";
import { inferSportFromText, sportFromPrizePicksLeague } from "../utils/sportMappings.js";
import { filterApprovedMarketsOnly } from "../utils/approvedMarkets.js";
import { normalizeMarketStatType } from "../utils/marketNormalization.js";
import { applySportClassification } from "../utils/marketClassification.js";
import { applyParsedPlayerResolution } from "../utils/comboMarkets.js";
import {
  buildPrizePicksFlatIngestionContext,
  buildPrizePicksProjectionIngestionContext,
  filterIngestionProps,
  rejectIngestionAtSource,
  sanitizePrizePicksPayloadForCache,
  shouldParseIngestionContext,
} from "../utils/ingestionFilter.js";
import { attachSportsbookVerifiedFields, isMalformedPlayerName } from "../utils/propValidation.js";
import { attachNormalizedGameStatus } from "../utils/slateFilter.js";
import {
  coercePipelineAudit,
  createEmptyPipelineAudit,
  logPipelineAudit,
  recordFilterReason,
  recordNormalizedSample,
  safeCreateEmptyPipelineAudit,
} from "../utils/propPipelineDebug.js";
import { safeParse } from "../utils/safeEngine.js";
import { MLB_ONLY_MODE, emptySourcePipelineAudit } from "../utils/mlbOnlyMode.js";
import { countUsableProps } from "../utils/propShape.js";
import { EMPTY_SOURCE_MESSAGE } from "./sourceHealth.js";
import {
  SOURCE_IDS,
  RATE_LIMIT_COOLDOWN_MESSAGE,
  cachedLinesMessage,
  isSourceInCooldown,
  recordSource429,
  recordSourceSuccess,
  recordSourceFailure,
  markSourceCached,
  withSourceRequestLock,
} from "./sourceRateLimit.js";
import { getProxyUrl, getRawProxyUrl } from "../config/apiConfig.js";
import { assessProxyUrl, inspectPrizePicksProxyConfig } from "../utils/providerProxy.js";
import { recordProviderResponse } from "../utils/rawResponseDebug.js";
import {
  classifyPrizePicksFailure,
  getPrizePicksDiagnostics,
  headersToRecord,
  resetPrizePicksDiagnostics,
  updatePrizePicksDiagnostics,
} from "../utils/prizepicksDiagnostics.js";
import {
  logProviderFetchPhase,
  recordProviderFetchMetrics,
  resetProviderFetchDiagnostics,
} from "../utils/providerFetchDiagnostics.js";
import {
  buildPlayerAttributeMap,
  countPrizePicksRawRecords,
  isPrizePicksBlockPayload,
  logPrizePicksRawSample,
  normalizePrizePicksResponse,
  parsePrizePicksProjections,
} from "../utils/prizepicksParse.js";

export const PRIZEPICKS_HTML_BANNER = "API route is serving source/HTML instead of JSON. Check proxy/backend routing.";
export const PRIZEPICKS_RATE_LIMIT_MESSAGE = "PrizePicks rate limited, using other sources.";
export const PRIZEPICKS_TEMPORARY_MESSAGE = "PrizePicks temporarily unavailable";
export const PRIZEPICKS_MLB_LEAGUE_ID = "2";

const PRIZEPICKS_CACHE_KEY = "dfs-prizepicks-last-good-payload";
const PRIZEPICKS_LEGACY_CACHE_KEY = "pp_cache";
const PRIZEPICKS_CACHE_MAX_MS = 15 * 60 * 1000;
const PRIZEPICKS_CLIENT_STALE_MS = 5 * 60 * 1000;

const SPORT_ALIASES = {
  mlb: "MLB",
  baseball: "MLB",
  nhl: "NHL",
  hockey: "NHL",
  nfl: "NFL",
  ncaaf: "NCAAF",
  "college football": "NCAAF",
  wnba: "WNBA",
  nba: "NBA",
  basketball: "NBA",
  atp: "ATP Tennis",
  mens_tennis: "ATP Tennis",
  "men's tennis": "ATP Tennis",
  wta: "WTA Tennis",
  womens_tennis: "WTA Tennis",
  "women's tennis": "WTA Tennis",
  tennis: "ATP Tennis",
  soccer: "Soccer",
  football: "Soccer",
};

const WTA_NAME_HINTS = new Set([
  "aliyah",
  "amandine",
  "ashlyn",
  "bianca",
  "daphnee",
  "dominika",
  "eva",
  "julia",
  "karolina",
  "katherine",
  "laura",
  "luisina",
  "maddison",
  "marina",
  "margaux",
  "robin",
  "viktoria",
  "yeon",
]);

export async function fetchPrizePicksProps({ sport = "all", statType = "all", signal } = {}) {
  return withSourceRequestLock(
    SOURCE_IDS.PRIZEPICKS,
    ({ signal: lockSignal } = {}) =>
      fetchPrizePicksPropsInternal({ sport, statType, signal: signal || lockSignal }),
    { signal }
  );
}

function applyPrizePicksAttemptDiagnostics(attempt = {}, parsed = {}, extra = {}) {
  const captchaDetected = Boolean(attempt.captchaDetected);
  const blockedPayloadDetected = Boolean(attempt.blockedPayloadDetected || parsed.blockPayload);
  const responseBodyLength = Number(attempt.responseSize ?? 0);
  const rawPropCount =
    extra.rawPropCount ??
    (parsed.ok && parsed.payload ? rawPrizePicksRecordCount(parsed.payload) : Number(attempt.rawPropCount ?? 0));
  const parsedPropsCount = Number(extra.parsedPropsCount ?? attempt.parsedPropsCount ?? 0);
  const finalPropsCount = Number(extra.finalPropsCount ?? 0);

  updatePrizePicksDiagnostics({
    requestUrl: attempt.url || extra.requestUrl || "",
    httpExecuted: true,
    requestSent: true,
    responseReceived: Boolean(attempt.responseReceived ?? (attempt.status != null || responseBodyLength > 0)),
    responseReceivedAt: attempt.responseReceivedAt || (attempt.status != null ? new Date().toISOString() : ""),
    statusCode: attempt.status ?? null,
    responseSize: responseBodyLength,
    responseBodyLength,
    responseHeaders: attempt.responseHeaders || {},
    responseTimeMs: attempt.durationMs ?? null,
    timedOut: Boolean(extra.timedOut || /timed out|abort/i.test(String(attempt.error || ""))),
    networkError: Boolean(attempt.networkError),
    captchaDetected,
    blockedPayloadDetected,
    rawPropCount,
    parsedPropsCount,
    finalPropsCount,
    normalizedCount: parsedPropsCount,
    validationCount: finalPropsCount,
    lastError: attempt.error || extra.lastError || "",
    ...extra,
    failureClass: classifyPrizePicksFailure({
      httpExecuted: true,
      timedOut: Boolean(extra.timedOut),
      statusCode: attempt.status ?? null,
      rawPropCount,
      parsedPropsCount,
      validationCount: finalPropsCount,
      lastError: attempt.error || extra.lastError || "",
      networkError: Boolean(attempt.networkError),
      captchaDetected,
      blockedPayloadDetected,
      usedCacheFallback: Boolean(extra.usedCacheFallback),
      providerStatus: extra.providerStatus || "",
    }),
  });
}

async function fetchPrizePicksPropsInternal({ sport = "all", statType = "all", signal } = {}) {
  resetPrizePicksDiagnostics();
  resetProviderFetchDiagnostics();
  const proxyUrl = getProxyUrl("prizepicks");
  const rawProxy = getRawProxyUrl("prizepicks");
  const proxyAssessment = assessProxyUrl(rawProxy);
  const externalProxyHost = (() => {
    try {
      return proxyUrl ? new URL(proxyUrl).host : "";
    } catch {
      return "";
    }
  })();

  if (!proxyUrl) {
    const config = inspectPrizePicksProxyConfig();
    const message = proxyAssessment.invalid
      ? `PrizePicks proxy URL is invalid. Set ${config.canonicalKey} in Settings.`
      : "PrizePicks proxy URL missing";
    console.info("[PrizePicks]", message, "— fetch skipped (no HTTP)");
    updatePrizePicksDiagnostics({
      proxyConfigured: false,
      proxyMode: "none — blocked in fetchPrizePicksPropsInternal",
      httpExecuted: false,
      lastError: message,
      providerStatus: "Not configured",
      uiConnectionTier: "Not configured",
      missingConfiguration: config.missingConfiguration,
      configKeysChecked: config.keysChecked,
      expectedFormat: config.expectedFormat,
      exampleProxyUrl: config.exampleProxyUrl,
      failureClass: classifyPrizePicksFailure({ notConfigured: true, lastError: message }),
    });
    return notConfiguredPrizePicksProviderResult(message);
  }

  if (isSourceInCooldown(SOURCE_IDS.PRIZEPICKS)) {
    const cachedResult = buildCachedPrizePicksResult({
      sport,
      statType,
      attempts: [],
      endpoint: "cooldown",
      reason: "cooldown",
    });
    if (cachedResult) return cachedResult;
    return failedPrizePicksResult({
      endpoint: prizePicksEndpoints()[0],
      message: "PrizePicks is in cooldown and no cached lines are available.",
      attempts: [],
      htmlError: false,
    });
  }

  const attempts = [];
  const fetchInit = {
    cache: "no-store",
    credentials: "omit",
    headers: lineFeedJsonHeaders(),
  };

  const endpoints = prizePicksEndpoints();
  const requestUrl = endpoints[0] ? absoluteUrl(endpoints[0]) : "";
  updatePrizePicksDiagnostics({
    requestUrl,
    requestSent: true,
    requestSentAt: new Date().toISOString(),
    proxyConfigured: true,
    proxyMode: "browser → VITE_PRIZEPICKS_PROXY_URL",
    externalProxyHost,
    httpExecuted: false,
    responseReceived: false,
    lastError: "",
  });
  console.info("[PrizePicks] proxy configured — starting fetch", {
    requestUrl,
    proxyHost: externalProxyHost,
  });
  console.log("[PrizePicks Fetch Start]", { requestUrl, proxyHost: externalProxyHost });
  console.log("[PP FETCH START]", { requestUrl, proxyHost: externalProxyHost });

  for (const endpoint of endpoints) {
    if (signal?.aborted) break;

    let parsed = null;
    for (let retryIndex = 0; retryIndex < PRIZEPICKS_RETRY_TIMEOUTS_MS.length; retryIndex += 1) {
      if (signal?.aborted) break;
      const timeoutMs = PRIZEPICKS_RETRY_TIMEOUTS_MS[retryIndex];
      const timeoutLocation = `prizepicks.fetch.retry-${retryIndex + 1}-${timeoutMs}ms`;
      parsed = await fetchPrizePicksEndpoint(endpoint, fetchInit, {
        signal,
        timeoutMs,
        retryIndex,
        timeoutLocation,
      });
      attempts.push(parsed.attempt);

      applyPrizePicksAttemptDiagnostics(parsed.attempt, parsed, {
        requestUrl: absoluteUrl(endpoint),
        retryAttempt: retryIndex + 1,
        retryTimeoutMs: timeoutMs,
        lastTimeoutLocation: parsed.timeoutLocation || timeoutLocation,
        attempts: attempts.map((item) => ({
          url: item.url,
          status: item.status,
          error: item.error,
          durationMs: item.durationMs,
          captchaDetected: item.captchaDetected,
          blockedPayloadDetected: item.blockedPayloadDetected,
          timeoutLocation: item.timeoutLocation,
          retryIndex: item.retryIndex,
        })),
      });

      const timedOut = Boolean(parsed.timedOut || /timed out|abort/i.test(String(parsed.attempt?.error || "")));
      const hasPayload = parsed.ok && parsed.payload;
      const rawCount = hasPayload ? rawPrizePicksRecordCount(parsed.payload) : 0;

      if (hasPayload && rawCount > 0) {
        console.info("[PrizePicks] recovery success", { retryIndex: retryIndex + 1, timeoutMs, rawCount });
        break;
      }

      if (timedOut) {
        const timeoutStep = parsed.timeoutLocation || timeoutLocation;
        console.warn("[PrizePicks Timeout] step:", timeoutStep, {
          timeoutMs,
          retryIndex: retryIndex + 1,
          durationMs: parsed.attempt?.durationMs,
          willRetry: retryIndex < PRIZEPICKS_RETRY_TIMEOUTS_MS.length - 1,
        });
        console.warn("[PP TIMEOUT] step:", timeoutStep, { timeoutMs, retryIndex: retryIndex + 1 });
      }

      if (retryIndex < PRIZEPICKS_RETRY_TIMEOUTS_MS.length - 1) {
        const retryDelayMs = 250;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
    }

    if (!parsed) continue;

    if (parsed.ok && parsed.payload) {
      const isFallback = parsed.payload?.fallback === true;
      const isRateLimited = Boolean(
        parsed.rateLimited || (parsed.payload?.rateLimited && !isFallback) || parsed.payload?.upstreamStatus === 429
      );
      if (isRateLimited && !isFallback) recordSource429(SOURCE_IDS.PRIZEPICKS);

      const setupWarning = setupWarningFromPayload(parsed.payload, "PrizePicks");
      if (parsed.payload?.error && parsed.payload?.needsSetup) {
        return {
          source: "PrizePicks",
          status: "Failed",
          props: [],
          warnings: [setupWarning || "PrizePicks setup needed."],
          lineSourceBadge: "",
          debug: buildDebug(endpoint, "Failed", 0, 0, setupWarning || "PrizePicks setup needed.", attempts),
        };
      }
      if (parsed.payload?.error && !isFallback) {
        return failedPrizePicksResult({
          endpoint,
          message: setupWarning || parsed.payload.message || parsed.payload.errorMessage || PRIZEPICKS_TEMPORARY_MESSAGE,
          attempts,
          htmlError: parsed.htmlError,
          sport,
          statType,
        });
      }

      const badgeForParse = isFallback ? "CACHED" : "LIVE";
      const { props: normalizedProps, audit } = normalizePrizePicksPayload(parsed.payload, sport, statType, badgeForParse);
      const usableCount = countUsableProps(normalizedProps);
      const usableMlbCount = MLB_ONLY_MODE
        ? normalizedProps.filter((prop) => String(prop.sport || "").toUpperCase() === "MLB").length
        : usableCount;
      console.log("[PrizePicks Parse Complete]", {
        parsed: normalizedProps.length,
        usable: usableCount,
        usableMlb: usableMlbCount,
        rawRecords: audit.fetched,
        cached: isFallback,
      });
      console.log("[PrizePicks Props Count]", usableCount);
      console.log("[PP PROPS EXTRACTED]", { usable: usableCount, parsed: normalizedProps.length, raw: audit.fetched });
      console.info("[PrizePicks] parser output", {
        parserOutputCount: normalizedProps.length,
        usablePropsCount: usableCount,
        usableMlbPropsCount: usableMlbCount,
        pipelineFetched: audit.fetched,
      });
      logProviderFetchPhase("PrizePicks", "PrizePicks Final Props", {
        parsedPropsCount: normalizedProps.length,
        finalPropsCount: usableCount,
      });
      const hasUsable = usableCount > 0;
      const lineSourceBadge = isFallback ? (hasUsable ? "CACHED" : "EMPTY") : hasUsable ? "LIVE" : "EMPTY";

      if (!isFallback && normalizedProps.length > 0) {
        writeCachedPayload(sanitizePrizePicksPayloadForCache(parsed.payload));
        recordSourceSuccess(SOURCE_IDS.PRIZEPICKS);
      } else if (isFallback) {
        markSourceCached(SOURCE_IDS.PRIZEPICKS, parsed.payload.cachedAt || readCachedPayloadSavedAt());
      } else {
        recordSourceSuccess(SOURCE_IDS.PRIZEPICKS);
      }

      logPipelineAudit(isFallback ? "PrizePicks-cached" : "PrizePicks", audit);
      const apiSucceeded = !parsed.payload?.error;
      const rawCount = rawPrizePicksRecordCount(parsed.payload);
      console.info("[PrizePicks] response", {
        requestUrl: parsed.attempt?.url || absoluteUrl(endpoint),
        responseStatus: parsed.attempt?.status ?? null,
        rawResponseCount: rawCount,
        responseSize: parsed.attempt?.responseSize ?? 0,
      });
      const warnings = [];
      if (isFallback) {
        warnings.push(parsed.payload.message || PRIZEPICKS_RATE_LIMIT_MESSAGE);
      } else if (isRateLimited) {
        warnings.push(PRIZEPICKS_RATE_LIMIT_MESSAGE);
      } else if (setupWarning) {
        warnings.push(setupWarning);
      }
      if (!hasUsable && apiSucceeded && rawCount > 0) {
        warnings.push(EMPTY_SOURCE_MESSAGE);
      } else if (!hasUsable && !isFallback) {
        warnings.push(rawCount > 0 ? EMPTY_SOURCE_MESSAGE : "PrizePicks returned no projection rows.");
      }
      if (parsed.htmlError) warnings.push(PRIZEPICKS_HTML_BANNER);

      recordProviderResponse("prizepicks", {
        url: isFallback ? "server-cache:prizepicks" : endpoint,
        status: isRateLimited ? 429 : parsed.attempt?.status ?? (hasUsable ? 200 : null),
        payload: parsed.payload,
        parsedCount: normalizedProps.length,
        normalizedCount: usableCount,
        errors: warnings,
        message: warnings[0] || "",
      });

      const pipelineStatus = isFallback
        ? hasUsable
          ? "Cached"
          : "Empty"
        : hasUsable
          ? "Full"
          : apiSucceeded && rawCount > 0
            ? "Empty"
            : "Empty";

      recordProviderFetchMetrics("PrizePicks", {
        responseTimeMs: parsed.attempt?.durationMs,
        httpStatus: parsed.attempt?.status,
        payloadSize: parsed.attempt?.responseSize,
        rawPropCount: rawCount,
        parsedPropsCount: normalizedProps.length,
        finalPropsCount: usableCount,
        timedOut: Boolean(parsed.attempt?.error && /timed out|abort/i.test(parsed.attempt.error)),
        lastError: warnings[0] || parsed.attempt?.error || "",
        failureReason: warnings[0] || "",
        requestUrl: parsed.attempt?.url,
        requestSent: true,
        responseReceived: true,
        responseHeaders: parsed.attempt?.responseHeaders,
        captchaDetected: Boolean(parsed.attempt?.captchaDetected),
        blockedPayloadDetected: Boolean(parsed.attempt?.blockedPayloadDetected),
      });
      updatePrizePicksDiagnostics({
        mlbScopedCount: audit.fetched,
        normalizedCount: audit.normalized ?? normalizedProps.length,
        parsedPropsCount: normalizedProps.length,
        validationCount: usableCount,
        finalPropsCount: usableCount,
        mlbUsableCount: usableMlbCount,
        responseTimeMs: parsed.attempt?.durationMs ?? null,
        filterReasons: audit.filterReasons || {},
        providerStatus: pipelineStatus,
        lastError: warnings[0] || parsed.attempt?.error || "",
        failureClass: classifyPrizePicksFailure({
          httpExecuted: true,
          statusCode: parsed.attempt?.status ?? null,
          rawPropCount: rawCount,
          parsedPropsCount: normalizedProps.length,
          validationCount: usableCount,
          providerStatus: pipelineStatus,
          lastError: warnings[0] || "",
        }),
      });

      logPrizePicksFetchSummary({
        liveCount: isFallback ? 0 : normalizedProps.length,
        cacheCount: isFallback ? normalizedProps.length : 0,
        finalCount: usableCount,
        status: resolvePrizePicksFetchStatus({
          liveLoaded: !isFallback && hasUsable,
          usedCache: isFallback,
          hasProps: hasUsable,
        }),
      });

      return {
        diagnostics: getPrizePicksDiagnostics(),
        lastSuccessfulFetchAt: isFallback
          ? parsed.payload.cachedAt || readCachedPayloadSavedAt()
          : new Date().toISOString(),
        debug: buildDebug(
          isFallback ? "server-cache:prizepicks" : endpoint,
          isFallback ? "Cached" : hasUsable ? "Full" : "Empty",
          audit.fetched,
          normalizedProps.length,
          warnings[0] || "",
          attempts
        ),
      };
    }

    if (parsed.rateLimited || [403, 404].includes(parsed.httpStatus)) {
      if (parsed.rateLimited) recordSource429(SOURCE_IDS.PRIZEPICKS);
      const cachedResult = buildCachedPrizePicksResult({
        sport,
        statType,
        attempts,
        endpoint,
        reason: parsed.rateLimited ? "rate-limit" : "fetch-failed",
      });
      if (cachedResult) return cachedResult;
    }
  }

  recordSourceFailure(SOURCE_IDS.PRIZEPICKS, PRIZEPICKS_TEMPORARY_MESSAGE);

  const lastAttempt = attempts.at(-1) || {};
  applyPrizePicksAttemptDiagnostics(lastAttempt, { ok: false }, {
    providerStatus: "Failed",
    lastError: lastAttempt.error || PRIZEPICKS_TEMPORARY_MESSAGE,
    finalPropsCount: 0,
    attempts: attempts.map((item) => ({
      url: item.url,
      status: item.status,
      error: item.error,
      durationMs: item.durationMs,
      captchaDetected: item.captchaDetected,
      blockedPayloadDetected: item.blockedPayloadDetected,
    })),
  });

  const cachedResult = buildCachedPrizePicksResult({ sport, statType, attempts, endpoint: attempts.at(-1)?.url || prizePicksEndpoints()[0], reason: "fetch-failed" });
  if (cachedResult) return cachedResult;

  return failedPrizePicksResult({
    endpoint: attempts.at(-1)?.url || prizePicksEndpoints()[0],
    message: PRIZEPICKS_TEMPORARY_MESSAGE,
    attempts,
    htmlError: attempts.some((item) => item.htmlError),
    sport,
    statType,
  });
}

function buildCachedPrizePicksResult({ sport, statType, attempts, endpoint, reason }) {
  const cachedPayload = readCachedPayload();
  if (!cachedPayload) return null;
  const savedAt = readCachedPayloadSavedAt();
  const { props, audit } = normalizePrizePicksPayload(cachedPayload, sport, statType, "CACHED");
  logPipelineAudit("PrizePicks-cached", audit);
  markSourceCached(SOURCE_IDS.PRIZEPICKS, savedAt);
  const lastAttempt = attempts.at(-1) || {};
  const liveFailure =
    lastAttempt.error ||
    (reason === "rate-limit"
      ? "PrizePicks rate limited"
      : reason === "cooldown"
        ? "PrizePicks cooldown active"
        : "Live PrizePicks fetch failed");
  const explicitReason = `Live fetch failed (${liveFailure}) — serving ${props.length} cached props from localStorage (not fresh endpoint data).`;
  updatePrizePicksDiagnostics({
    usedCacheFallback: true,
    liveFetchFailureReason: liveFailure,
    providerStatus: "Cached",
    parsedPropsCount: props.length,
    finalPropsCount: props.length,
    validationCount: props.length,
    normalizedCount: props.length,
    failureReason: explicitReason,
    lastError: liveFailure,
    captchaDetected: Boolean(lastAttempt.captchaDetected),
    blockedPayloadDetected: Boolean(lastAttempt.blockedPayloadDetected),
  });
  const warning =
    reason === "rate-limit" || reason === "cooldown"
      ? PRIZEPICKS_RATE_LIMIT_MESSAGE
      : PRIZEPICKS_TEMPORARY_MESSAGE;
  logPrizePicksFetchSummary({
    liveCount: 0,
    cacheCount: props.length,
    finalCount: props.length,
    status: resolvePrizePicksFetchStatus({ usedCache: true, hasProps: props.length > 0 }),
  });
  return {
    source: "PrizePicks",
    status: "Cached",
    props,
    pipelineAudit: audit,
    lineSourceBadge: "CACHED",
    lastSuccessfulFetchAt: savedAt,
    rateLimited: reason === "rate-limit" || reason === "cooldown",
    liveFetchFailed: true,
    usedCacheFallback: true,
    timedOut: /timeout|timed out/i.test(String(liveFailure)),
    warnings: [explicitReason, warning],
    diagnostics: getPrizePicksDiagnostics(),
    debug: buildDebug(
      "localStorage:last-good-prizepicks",
      "Cached",
      rawPrizePicksRecordCount(cachedPayload),
      props.length,
      explicitReason,
      attempts
    ),
  };
}

/** Serve cached PrizePicks lines when live fetch or provider wrapper times out. */
export function resolvePrizePicksCachedProviderResult({
  sport = "all",
  statType = "all",
  attempts = [],
  reason = "fetch-failed",
  message = "",
} = {}) {
  const resolvedAttempts =
    attempts?.length > 0
      ? attempts
      : [{ error: message || reason, timedOut: /timeout|timed out/i.test(String(message || reason)) }];
  return buildCachedPrizePicksResult({
    sport,
    statType,
    attempts: resolvedAttempts,
    endpoint: "cache-fallback",
    reason: reason === "timeout" ? "fetch-failed" : reason,
  });
}

/** Connected = live load · Warning = cache fallback · Failed = no props */
export function resolvePrizePicksFetchStatus({
  liveLoaded = false,
  usedCache = false,
  hasProps = false,
  notConfigured = false,
} = {}) {
  if (notConfigured) return "Not configured";
  if (liveLoaded && hasProps && !usedCache) return "Connected";
  if (hasProps && usedCache) return "Warning";
  if (hasProps) return liveLoaded ? "Connected" : "Warning";
  return "Failed";
}

export function logPrizePicksFetchSummary({
  liveCount = 0,
  cacheCount = 0,
  finalCount = 0,
  status = "Failed",
} = {}) {
  console.log("[PrizePicks] live count", liveCount);
  console.log("[PrizePicks] cache count", cacheCount);
  console.log("[PrizePicks] final count", finalCount);
  console.log("[PrizePicks] status", status);
}

async function fetchPrizePicksEndpoint(
  endpoint,
  init,
  { signal, timeoutMs: timeoutOverride, retryIndex = 0, timeoutLocation = "prizepicks.fetch.single" } = {}
) {
  const lineFeedTimeoutMs =
    Number.isFinite(Number(timeoutOverride)) && Number(timeoutOverride) > 0
      ? Number(timeoutOverride)
      : Math.min(getLineFeedTimeoutMs(), PRIZEPICKS_PROVIDER_TIMEOUT_MS);
  const attempt = {
    url: absoluteUrl(endpoint),
    status: null,
    contentType: "",
    preview: "",
    error: "",
    htmlError: false,
    retries: retryIndex,
    retryIndex,
    durationMs: 0,
    timeoutLocation,
  };
  const startedAt = Date.now();

  console.info("[PrizePicks] request URL", attempt.url);
  logProviderFetchPhase("PrizePicks", "PrizePicks Request Sent", {
    url: attempt.url,
    timeoutMs: lineFeedTimeoutMs,
    retryIndex: retryIndex + 1,
    timeoutLocation,
  });

  try {
    const response = await resilientFetch(
      endpoint,
      { ...init, signal },
      {
      source: "PrizePicks",
      ttlMs: PRIZEPICKS_CLIENT_STALE_MS,
      timeoutMs: lineFeedTimeoutMs,
      maxRetries: 0,
      retryDelayMs: LINE_FEED_RETRY_DELAY_MS,
      skip429Retry: true,
      }
    );
    attempt.status = response.status;
    attempt.contentType = response.headers.get("content-type") || "";
    attempt.durationMs = Date.now() - startedAt;
    attempt.rateLimited = response.status === 429;

    const text = await response.text();
    attempt.responseSize = text.length;
    attempt.responseHeaders = headersToRecord(response.headers);
    attempt.responseReceived = true;
    attempt.responseReceivedAt = new Date().toISOString();
    attempt.preview = text.slice(0, 200).replace(/\s+/g, " ").trim();

    console.info("[PrizePicks] response headers", attempt.responseHeaders);
    console.info("[PrizePicks] response body length", attempt.responseSize);
    console.log("[PrizePicks Response Received]", {
      status: attempt.status,
      responseSize: attempt.responseSize,
      durationMs: attempt.durationMs,
      url: attempt.url,
    });
    console.log("[PP RESPONSE]", {
      status: attempt.status,
      responseSize: attempt.responseSize,
      durationMs: attempt.durationMs,
    });

    logProviderFetchPhase("PrizePicks", "PrizePicks Response Received", {
      status: attempt.status,
      responseSize: attempt.responseSize,
      durationMs: attempt.durationMs,
      headers: attempt.responseHeaders,
    });
    recordProviderFetchMetrics("PrizePicks", {
      responseTimeMs: attempt.durationMs,
      httpStatus: attempt.status,
      payloadSize: attempt.responseSize,
    });

    console.info("[PrizePicks] fetch attempt", {
      url: attempt.url,
      status: attempt.status,
      contentType: attempt.contentType,
      durationMs: attempt.durationMs,
      preview: attempt.preview,
      rateLimited: attempt.rateLimited,
    });

    if (!response.ok) {
      attempt.error =
        response.status === 403
          ? "PrizePicks blocked the request (403)"
          : response.status === 429
            ? "PrizePicks rate limited (429)"
            : `HTTP ${response.status}`;
      attempt.blockedPayloadDetected = response.status === 403;
      return {
        ok: false,
        attempt,
        htmlError: attempt.preview.startsWith("<"),
        rateLimited: response.status === 429,
        httpStatus: response.status,
        timeoutLocation,
        timedOut: false,
      };
    }

    const trimmed = text.trim();
    if (!trimmed) {
      attempt.error = "Empty response body";
      return { ok: false, attempt, htmlError: false, rateLimited: false };
    }

    if (
      /javascript/i.test(attempt.contentType) ||
      trimmed.includes("const APIFY_PRIZEPICKS_ACTOR") ||
      trimmed.startsWith("<") ||
      /^export\s+default\b/.test(trimmed) ||
      trimmed.includes("export default async function")
    ) {
      attempt.error = trimmed.startsWith("<")
        ? "PrizePicks returned HTML instead of JSON"
        : "PrizePicks returned JavaScript instead of JSON";
      attempt.htmlError = true;
      return { ok: false, attempt, htmlError: true, rateLimited: false };
    }

    let payload;
    try {
      payload = JSON.parse(trimmed);
      console.log("PrizePicks response keys", Object.keys(payload));
      console.log("PrizePicks sample", JSON.stringify(payload).slice(0, 5000));
      logProviderFetchPhase("PrizePicks", "JSON parsed", {
        topLevelKeys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : [],
      });
      console.log("[PP JSON PARSED]", {
        keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : [],
      });
    } catch (parseError) {
      console.error("Non-JSON response:", trimmed.slice(0, 300));
      attempt.error = `PrizePicks returned non-JSON response: ${parseError.message || "invalid JSON"}`;
      return { ok: false, attempt, htmlError: true, rateLimited: false, nonJson: true };
    }

    logPrizePicksRawSample(payload);
    if (isPrizePicksBlockPayload(payload)) {
      attempt.captchaDetected = true;
      attempt.blockedPayloadDetected = true;
      attempt.rawPropCount = 0;
      attempt.parsedPropsCount = 0;
      attempt.error = "PrizePicks returned bot-protection payload instead of projections";
      console.warn("[PrizePicks] block payload detected — no projection rows", {
        keys: Object.keys(payload),
      });
      console.info("[PrizePicks] captcha detected", true);
      console.info("[PrizePicks] blocked payload detected", true);
      logProviderFetchPhase("PrizePicks", "PrizePicks Parsed Props", {
        rawPropCount: 0,
        parsedPropsCount: 0,
        captchaDetected: true,
        blockedPayloadDetected: true,
      });
      return { ok: false, attempt, htmlError: false, rateLimited: false, blockPayload: true };
    }

    const extractedRaw = countPrizePicksRawRecords(payload);
    const parsedPreview = parsePrizePicksProjections(unwrapProxyPayload(payload));
    attempt.captchaDetected = false;
    attempt.blockedPayloadDetected = false;
    attempt.rawPropCount = extractedRaw;
    attempt.parsedPropsCount = parsedPreview.length;
    console.info("[PrizePicks] captcha detected", false);
    console.info("[PrizePicks] blocked payload detected", false);
    logProviderFetchPhase("PrizePicks", "PrizePicks Parsed Props", {
      rawPropCount: extractedRaw,
      parsedPropsCount: parsedPreview.length,
      captchaDetected: false,
      blockedPayloadDetected: false,
    });
    console.info("[PrizePicks] parse counts", {
      rawResponseCount: extractedRaw,
      parsedPropsCount: parsedPreview.length,
    });
    console.log("[PrizePicks Parse Complete]", {
      rawRecords: extractedRaw,
      parsedPreview: parsedPreview.length,
    });
    console.log("[PP PROPS EXTRACTED]", { rawRecords: extractedRaw, parsedPreview: parsedPreview.length });

    if (payload?.ok === true && payload?.fallback === true) {
      attempt.rateLimited = Boolean(payload.rateLimited);
      return { ok: true, attempt, payload, htmlError: false, rateLimited: Boolean(payload.rateLimited) };
    }

    if (payload?.ok === false || payload?.status === "failed") {
      attempt.error = payload.error || payload.message || payload.errorMessage || "Proxy error payload";
      const rateLimited = payload?.upstreamStatus === 429 || payload?.rateLimited === true;
      attempt.rateLimited = rateLimited;
      return {
        ok: false,
        attempt,
        htmlError: /html|non-json/i.test(attempt.error),
        payload,
        rateLimited,
        httpStatus: payload?.upstreamStatus || attempt.status,
      };
    }

    return { ok: true, attempt, payload, htmlError: false, rateLimited: false };
  } catch (error) {
    const message = error?.message || String(error);
    const timedOut = /timed out|abort/i.test(message);
    attempt.error = timedOut
      ? `Request timed out at ${timeoutLocation} after ${Math.round(lineFeedTimeoutMs / 1000)}s`
      : message || "Failed to fetch";
    attempt.durationMs = Date.now() - startedAt;
    attempt.networkError = !timedOut;
    console.warn("[PrizePicks Timeout] step:", timeoutLocation, {
      timeoutMs: lineFeedTimeoutMs,
      timedOut,
      error: attempt.error,
    });
    console.warn("[PP TIMEOUT] step:", timeoutLocation, { timeoutMs: lineFeedTimeoutMs, timedOut });
    return {
      ok: false,
      attempt,
      htmlError: false,
      rateLimited: false,
      networkError: !timedOut,
      timedOut,
      timeoutLocation,
    };
  }
}

function prizePicksEndpoints() {
  const proxyUrl = getProxyUrl("prizepicks");
  if (!proxyUrl) return [];
  return [proxyUrl];
}

function notConfiguredPrizePicksProviderResult(message = "PrizePicks proxy URL missing") {
  return {
    source: "PrizePicks",
    status: "Not configured",
    props: [],
    lineSourceBadge: "NOT CONFIGURED",
    warnings: [message],
    error: true,
    notConfigured: true,
    disabled: true,
    timedOut: false,
    diagnostics: getPrizePicksDiagnostics(),
    debug: buildDebug("", "Not configured", 0, 0, message, []),
  };
}

function formatAttemptWarnings(attempts = []) {
  if (!attempts.length) return ["PrizePicks returned non-JSON response."];
  const last = attempts[attempts.length - 1];
  const lines = attempts.map(
    (item) =>
      `${item.url} → status ${item.status ?? "?"} · ${item.contentType || "no content-type"} · ${item.error || item.preview || "no body"}`
  );
  if (last?.htmlError || (last?.preview || "").startsWith("<")) {
    lines.unshift(PRIZEPICKS_HTML_BANNER);
    lines.push(`API returned non-JSON/HTML response. First 200 chars: ${last.preview || ""}`);
  } else {
    lines.push(`PrizePicks returned non-JSON response. First 200 chars: ${last.preview || ""}`);
  }
  return lines;
}

function failedPrizePicksResult({ endpoint, message, attempts = [], htmlError = false, sport = "all", statType = "all" }) {
  const lastAttempt = attempts.at(-1) || {};
  const failureReason = message || lastAttempt.error || PRIZEPICKS_TEMPORARY_MESSAGE;
  applyPrizePicksAttemptDiagnostics(lastAttempt, { ok: false }, {
    providerStatus: "Failed",
    lastError: failureReason,
    finalPropsCount: 0,
    parsedPropsCount: Number(lastAttempt.parsedPropsCount ?? 0),
  });

  const cachedResult = buildCachedPrizePicksResult({
    sport,
    statType,
    attempts,
    endpoint,
    reason: "fetch-failed",
  });
  if (cachedResult) {
    return {
      ...cachedResult,
      error: true,
      liveFetchFailed: true,
      warnings: [failureReason, ...(cachedResult.warnings || [])].filter(
        (item, index, list) => list.indexOf(item) === index
      ),
    };
  }
  const warnings = formatAttemptWarnings(attempts);
  if (failureReason && !warnings.includes(failureReason)) warnings.unshift(failureReason);
  updatePrizePicksDiagnostics({
    failureReason: warnings.join(" | "),
    finalPropsCount: 0,
    providerStatus: "Failed",
  });
  return {
    source: "PrizePicks",
    status: "Failed",
    props: [],
    lineSourceBadge: "",
    warnings,
    error: true,
    liveFetchFailed: true,
    diagnostics: getPrizePicksDiagnostics(),
    debug: buildDebug(endpoint, "Failed", 0, 0, warnings.join(" | "), attempts),
    htmlError,
  };
}

function buildDebug(apiUrl, apiStatus, rawPropsLoaded, propsAfterParsing, message, attempts = []) {
  return {
    apiUrl: absoluteUrl(apiUrl),
    apiStatus,
    endpointsTried: attempts.map((item) => item.url),
    rawPropsLoaded,
    propsAfterParsing,
    message: message || attempts.map((item) => item.error || item.preview).filter(Boolean).join(" | "),
    attempts,
    lastAttemptStatus: attempts.at(-1)?.status ?? null,
    lastAttemptDurationMs: attempts.at(-1)?.durationMs ?? null,
  };
}

function rawPrizePicksRecordCount(payload) {
  const normalizedPayload = unwrapProxyPayload(payload);
  if (normalizedPayload?.blocked) return 0;
  return countPrizePicksRawRecords(normalizedPayload);
}

function absoluteUrl(endpoint) {
  try {
    return new URL(endpoint, window.location.origin).toString();
  } catch {
    return endpoint;
  }
}

function normalizePrizePicksPayload(payload, sport, statType, lineSourceBadge = "LIVE") {
  return safeParse(
    "PrizePicks.normalizePayload",
    () => normalizePrizePicksPayloadInternal(payload, sport, statType, lineSourceBadge),
    { props: [], audit: coercePipelineAudit(safeCreateEmptyPipelineAudit()) }
  );
}

function normalizePrizePicksPayloadInternal(payload, sport, statType, lineSourceBadge = "LIVE") {
  let audit = safeCreateEmptyPipelineAudit();
  try {
    audit = createEmptyPipelineAudit();
    const normalizedPayload = unwrapProxyPayload(payload);
    if (normalizedPayload?.blocked || isPrizePicksBlockPayload(payload)) {
      console.warn("[PrizePicks] normalize skipped — bot-protection payload, 0 props");
      return { props: [], audit: coercePipelineAudit(audit) };
    }
    const parsedPreview = parsePrizePicksProjections(normalizedPayload);
    if (parsedPreview.length) {
      console.info("[PrizePicks] parsed preview", {
        valid: parsedPreview.length,
        sample: parsedPreview.slice(0, 3).map((row) => ({
          player: row.player,
          statType: row.statType,
          line: row.line,
        })),
      });
    } else if ((normalizedPayload.data || []).length) {
      console.warn("[PrizePicks] raw rows present but parser extracted 0 props", {
        rawResponseCount: normalizedPayload.data.length,
        parsedPropsCount: 0,
        sampleKeys: Object.keys(normalizedPayload.data[0] || {}),
        attributeKeys: Object.keys(normalizedPayload.data[0]?.attributes || {}),
      });
    }
    const rows = normalizedPayload.data || [];
    const includedRecords = buildIncludedMap(normalizedPayload.included || []);
    const playerAttributeMap = buildPlayerAttributeMap(normalizedPayload.included || []);
    const scopedRows = MLB_ONLY_MODE
      ? rows.filter((item) =>
          shouldParseIngestionContext(buildPrizePicksProjectionIngestionContext(item, includedRecords))
        )
      : rows;
    audit.fetched = scopedRows.length;

    let props = scopedRows
      .map((item) =>
        normalizePrizePicksProjection(item, includedRecords, lineSourceBadge, audit, playerAttributeMap)
      )
      .filter(Boolean);

    audit.normalized = props.length;
    props.forEach((prop) => recordNormalizedSample(audit, prop));
    props = filterIngestionProps(props, audit, recordFilterReason);
    props = filterApprovedMarketsOnly(props);
    const filtered = props.filter((prop) => matchesFilter(prop, sport, statType));
    if (filtered.length < props.length) {
      recordFilterReason(audit, "sport/stat filter at source", props[0]);
    }
    return {
      props: filtered,
      audit: MLB_ONLY_MODE ? coercePipelineAudit(emptySourcePipelineAudit()) : coercePipelineAudit(audit),
    };
  } catch (error) {
    console.warn("[PrizePicks] normalize payload failed; returning empty audit-safe result", error);
    return { props: [], audit: coercePipelineAudit(audit) };
  }
}

function unwrapProxyPayload(payload, depth = 0) {
  if (depth > 5 || !payload || typeof payload !== "object") return normalizePrizePicksResponse(null);
  if (Array.isArray(payload)) return normalizePrizePicksResponse(payload);

  if (payload?.source === "PrizePicks") {
    if (payload.data?.data && Array.isArray(payload.data.data)) {
      return normalizePrizePicksResponse({ data: payload.data.data, included: payload.data.included || [] });
    }
    if (Array.isArray(payload.props) && payload.props[0]?.type === "projection") {
      return normalizePrizePicksResponse({ data: payload.props, included: payload.data?.included || [] });
    }
    if (payload.data && !Array.isArray(payload.data)) return unwrapProxyPayload(payload.data, depth + 1);
    if (Array.isArray(payload.data)) return normalizePrizePicksResponse(payload);
  }

  return normalizePrizePicksResponse(payload);
}

function setupWarningFromPayload(payload, source) {
  if (!payload?.error && !payload?.needsSetup) return "";
  return payload.message || `${source} proxy needs setup.`;
}

function normalizeFlatPrizePicksItem(item = {}, lineSourceBadge = "LIVE", audit = null) {
  if (rejectIngestionAtSource(buildPrizePicksFlatIngestionContext(item), audit, recordFilterReason, item)) {
    return null;
  }
  const line = Number(item.line_score ?? item.line ?? item.projection ?? item.stat_value ?? item.value);
  const statType = normalizeStatType(item.stat_type || item.statType || item.market || item.description || item.name);
  if (!Number.isFinite(line) || !statType) {
    if (audit) recordFilterReason(audit, "missing line or statType (flat)", item);
    return null;
  }
  const startTime = normalizeGameStartTime(
    item.start_time || item.startTime || item.game_time || item.scheduled_at || item.commence_time || item.board_time,
    { allowFallback: true }
  );
  const timeUncertainty = startTimeUncertainty(item.start_time || item.startTime || item.board_time);

  const playerName =
    item.player_name || item.playerName || item.name || item.display_name || item.player || "";
  if (isMalformedPlayerName(playerName)) {
    if (audit) recordFilterReason(audit, "malformed player name (flat)", item);
    return null;
  }
  const explicitSources = [
    item.player_name,
    item.playerName,
    item.display_name,
    item.name,
  ];
  const playerImage = item.playerImage || item.player_image || item.imageUrl || item.image_url || item.headshot || item.headshot_url || "";
  const oddsType = item.odds_type || item.oddsType || "standard";
  const verifiedAdjustedOdds = oddsType === "goblin" || oddsType === "demon";

  return finalizeNormalizedProp(
    {
    platform: "PrizePicks",
    lineSourceBadge,
    sport: normalizeSport(item.league || item.sport || statType, { playerName, opponent: item.opponent || "", description: item.description }),
    league: item.league || item.sport || "",
    playerName,
    team: item.team || item.team_abbr || item.teamAbbr || "",
    opponent: item.opponent || item.opponent_abbr || item.matchup || "",
    playerImage,
    playerImageUrl: playerImage,
    headshot: playerImage,
    imageUrl: playerImage,
    image_url: playerImage,
    player_image: playerImage,
    startTime,
    statType,
    line,
    directionOptions: ["More", "Less"],
    isAdjustedOdds: verifiedAdjustedOdds,
    oddsType,
    odds_type: oddsType,
    verifiedAdjustedOdds,
    streakOptions: buildPrizePicksStreakOptions(item),
    projection: null,
    confidenceScore: 0,
    edgeRating: 0,
    riskLevel: "High",
    status: normalizeStatus(item.status || item.state, startTime, item),
    sourceId: item.id || item.projection_id || "",
    timeUncertainty,
    raw: item,
  },
    { raw: item, explicitSources, audit }
  );
}

function normalizePrizePicksProjection(
  item,
  included,
  lineSourceBadge = "LIVE",
  audit = null,
  playerAttributeMap = new Map()
) {
  const attributes = item.attributes || {};

  const relationships = item.relationships || {};
  const playerRelId =
    relationships.new_player?.data?.id ??
    relationships.player?.data?.id ??
    (Array.isArray(relationships.new_player?.data) ? relationships.new_player.data[0]?.id : null);
  const playerAttrsFromMap = playerRelId != null ? playerAttributeMap.get(String(playerRelId)) : null;
  const player = relatedRecord(included, relationships.new_player || relationships.player);
  const league = relatedRecord(included, relationships.league);
  const game = relatedRecord(included, relationships.game);
  if (rejectIngestionAtSource(buildPrizePicksProjectionIngestionContext(item, included), audit, recordFilterReason, item)) {
    return null;
  }
  const line = Number(attributes.line_score ?? attributes.line ?? attributes.projection);
  const statType = normalizeStatType(attributes.stat_type || attributes.stat_display_name || attributes.description);
  const startTime = normalizeGameStartTime(
    attributes.start_time || attributes.board_time || attributes.game_time || game?.attributes?.start_time,
    { allowFallback: true }
  );
  const timeUncertainty = startTimeUncertainty(attributes.start_time || attributes.board_time);
  const status = normalizeStatus(attributes.status || attributes.state, startTime, attributes);

  if (!Number.isFinite(line) || !statType) {
    if (audit) recordFilterReason(audit, "missing line or statType", attributes);
    return null;
  }

  const playerAttributes = playerAttrsFromMap || player?.attributes || {};
  const gameAttributes = game?.attributes || {};
  const playerName =
    playerAttributes.display_name ||
    playerAttributes.name ||
    playerAttributes.full_name ||
    attributes.player_name ||
    attributes.name ||
    "";
  const explicitSources = [
    playerAttributes.display_name,
    playerAttributes.name,
    playerAttributes.full_name,
    attributes.player_name,
    attributes.name,
  ];
  if (isMalformedPlayerName(playerName)) {
    if (audit) recordFilterReason(audit, "malformed player name", attributes);
    return null;
  }
  const playerImage =
    playerAttributes.image_url ||
    playerAttributes.headshot_url ||
    playerAttributes.headshot ||
    playerAttributes.photo_url ||
    playerAttributes.avatar_url ||
    playerAttributes.image ||
    attributes.image_url ||
    attributes.headshot_url ||
    attributes.player_image ||
    "";
  const oddsType = attributes.odds_type || "standard";
  const verifiedAdjustedOdds = oddsType === "goblin" || oddsType === "demon";
  const streakOptions = buildPrizePicksStreakOptions(attributes);
  const team =
    playerAttributes.team_abbr ||
    playerAttributes.team ||
    playerAttributes.team_name ||
    attributes.team_abbr ||
    attributes.team ||
    gameAttributes.home_team ||
    gameAttributes.metadata?.home_team ||
    "";
  const opponent =
    attributes.opponent_abbr ||
    attributes.opponent ||
    attributes.opponent_team ||
    gameAttributes.away_team ||
    gameAttributes.metadata?.away_team ||
    attributes.description ||
    gameAttributes.opponent ||
    "";
  const leagueId = relationships.league?.data?.id;
  const sport =
    sportFromPrizePicksLeague(league, leagueId) ||
    normalizeSport(league?.attributes?.name || league?.attributes?.display_name || attributes.league || statType, {
      playerName,
      opponent,
      description: attributes.description,
    });

  return finalizeNormalizedProp(
    {
    platform: "PrizePicks",
    lineSourceBadge,
    sport: sport || inferSportFromText(statType, { description: attributes.description }) || "",
    league: league?.attributes?.name || attributes.league || sport,
    playerName,
    playerId: playerRelId != null ? String(playerRelId) : "",
    platformPlayerId: playerRelId != null ? String(playerRelId) : "",
    team,
    opponent,
    playerImage,
    playerImageUrl: playerImage,
    headshot: playerImage,
    imageUrl: playerImage,
    image_url: playerImage,
    player_image: playerImage,
    startTime,
    statType,
    line,
    directionOptions: ["More", "Less"],
    isAdjustedOdds: verifiedAdjustedOdds,
    oddsType,
    odds_type: oddsType,
    verifiedAdjustedOdds,
    streakOptions,
    projection: null,
    confidenceScore: 0,
    edgeRating: 0,
    riskLevel: "High",
    status,
    sourceId: item.id,
    timeUncertainty,
    raw: item,
  },
    { raw: { ...item, attributes, over_under: attributes }, explicitSources, audit }
  );
}

function finalizeNormalizedProp(prop, { raw = {}, explicitSources = [], audit = null } = {}) {
  const resolved = applyParsedPlayerResolution(prop, { raw, explicitSources });
  if (!resolved) {
    if (audit) recordFilterReason(audit, "merged multi-player name (parser bug)", raw);
    return null;
  }
  const playerName = String(resolved.playerName || "").trim();
  if (isMalformedPlayerName(playerName)) return null;
  return attachNormalizedGameStatus(
    applySportClassification(
      attachSportsbookVerifiedFields(
        {
          ...resolved,
          playerName,
          propType: resolved.statType || resolved.propType || "Prop",
        },
        "PrizePicks"
      )
    )
  );
}

function buildPrizePicksStreakOptions(attributes = {}) {
  const multiplier = multiplierFromPrizePicks(attributes);
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) return [];
  const oddsType = String(attributes.odds_type || attributes.oddsType || "").toLowerCase();
  const verifiedAdjustedOdds = oddsType === "goblin" || oddsType === "demon";
  return [
    {
      side: "Higher",
      multiplier,
      status: normalizeStatus(attributes.status || attributes.state, attributes.start_time || attributes.board_time, attributes),
      multiplierSource: oddsType === "goblin" ? "PrizePicks goblin line" : oddsType === "demon" ? "PrizePicks demon line" : "PrizePicks multiplier field",
      adjustedOddsType: oddsType || "standard",
      verifiedAdjustedOdds,
    },
  ];
}

function multiplierFromPrizePicks(attributes = {}) {
  const direct = [
    attributes.payout_multiplier,
    attributes.multiplier,
    attributes.odds_multiplier,
    attributes.adjusted_payout_multiplier,
    attributes.flash_sale_multiplier,
    attributes.flash_sale_payout_multiplier,
  ]
    .map((value) => Number(value))
    .find(Number.isFinite);
  if (direct != null) return direct;

  const oddsType = String(attributes.odds_type || "").toLowerCase();
  if (oddsType === "goblin") return 0.75;
  if (oddsType === "standard") return 1;
  if (oddsType === "demon") return 1.25;
  return null;
}

function buildIncludedMap(records) {
  const map = new Map();
  records.forEach((record) => {
    map.set(`${record.type}:${record.id}`, record);
  });
  return map;
}

function relatedRecord(included, relationship) {
  const data = relationship?.data;
  if (!data) return null;
  const target = Array.isArray(data) ? data[0] : data;
  if (!target) return null;
  return included.get(`${target.type}:${target.id}`) || null;
}

function normalizeSport(value, context = {}) {
  const inferred = inferSportFromText(value, context);
  if (inferred) return inferred;
  const key = String(value || "").toLowerCase();
  if (key.includes("tennis")) return classifyTennisSport(context);
  const match = Object.entries(SPORT_ALIASES).find(([alias]) => key.includes(alias));
  return match ? match[1] : inferSportFromText(context.description || "") || "";
}

function classifyTennisSport({ playerName = "", opponent = "" } = {}) {
  const names = `${playerName} ${opponent}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return names.some((name) => WTA_NAME_HINTS.has(name)) ? "WTA Tennis" : "ATP Tennis";
}

function normalizeStatType(value) {
  return normalizeMarketStatType(value);
}

function normalizeStatus(status, startTime, attributes = {}) {
  const lower = String(status || "").toLowerCase();
  const start = new Date(startTime).getTime();
  if (attributes.is_live || attributes.in_game) return "live";
  if (lower.includes("locked")) return "locked";
  if (lower.includes("expired") || lower.includes("closed")) return "expired";
  if (lower.includes("pregame") || lower.includes("pre_game") || lower.includes("scheduled") || lower.includes("open")) {
    return "upcoming";
  }
  if (Number.isFinite(start) && start <= Date.now()) return "live";
  return "upcoming";
}

function matchesFilter(prop, sport, statType) {
  const sportOk = sport === "all" || prop.sport === sport;
  const statOk = statType === "all" || normalizeKey(prop.statType) === normalizeKey(statType);
  return sportOk && statOk;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function writeCachedPayload(payload) {
  try {
    const entry = { savedAt: Date.now(), payload };
    window.localStorage.setItem(PRIZEPICKS_CACHE_KEY, JSON.stringify(entry));
    window.localStorage.setItem(PRIZEPICKS_LEGACY_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Cache is only an anti-rate-limit convenience.
  }
}

function readCachedPayload() {
  try {
    const cached = safeParseJSON(window.localStorage.getItem(PRIZEPICKS_CACHE_KEY), null);
    if (cached?.payload && Date.now() - cached.savedAt <= PRIZEPICKS_CACHE_MAX_MS) {
      return sanitizePrizePicksPayloadForCache(cached.payload);
    }
  } catch {
    // fall through to legacy key
  }
  try {
    const legacy = safeParseJSON(window.localStorage.getItem(PRIZEPICKS_LEGACY_CACHE_KEY), null);
    if (!legacy) return null;
    const payload = legacy?.payload && typeof legacy.payload === "object" ? legacy.payload : legacy;
    return sanitizePrizePicksPayloadForCache(payload);
  } catch {
    return null;
  }
}

function readCachedPayloadSavedAt() {
  try {
    const cached = safeParseJSON(window.localStorage.getItem(PRIZEPICKS_CACHE_KEY), null);
    if (cached?.savedAt) return new Date(cached.savedAt).toISOString();
  } catch {
    // ignore
  }
  return "";
}
