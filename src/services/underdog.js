import { getShortCacheTtlMs, lineFeedJsonHeaders, resilientFetch } from "./fetchUtil.js";
import {
  getLineFeedTimeoutMs,
  LINE_FEED_MAX_RETRIES,
  LINE_FEED_RETRY_DELAY_MS,
} from "../utils/apiTimeout.js";
import { safeParseJSON } from "../utils/safeParseJSON.js";
import { normalizeGameStartTime, startTimeUncertainty } from "../utils/normalizeGameStartTime.js";
import { inferSportFromText, sportFromUnderdogGame } from "../utils/sportMappings.js";
import { resolvePropSportLabel } from "../utils/underdogSportDetection.js";
import { applySportClassification } from "../utils/marketClassification.js";
import { filterApprovedMarketsOnly } from "../utils/approvedMarkets.js";
import { normalizeMarketStatType } from "../utils/marketNormalization.js";
import { applyParsedPlayerResolution, isMergedMultiPlayerName } from "../utils/comboMarkets.js";
import {
  buildUnderdogFlatIngestionContext,
  buildUnderdogLineIngestionContext,
  filterIngestionProps,
  rejectIngestionAtSource,
  sanitizeUnderdogPayloadForCache,
  shouldParseIngestionContext,
} from "../utils/ingestionFilter.js";
import { attachSportsbookVerifiedFields, isMalformedPlayerName } from "../utils/propValidation.js";
import { countUsableProps } from "../utils/propShape.js";
import { EMPTY_SOURCE_MESSAGE } from "./sourceHealth.js";
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
import {
  SOURCE_IDS,
  cachedLinesMessage,
  isSourceInCooldown,
  recordSource429,
  recordSourceSuccess,
  recordSourceFailure,
  markSourceCached,
  withSourceRequestLock,
  withSourceRetryQueue,
} from "./sourceRateLimit.js";
import { getProxyUrl } from "../config/apiConfig.js";
import { MLB_ONLY_MODE, emptySourcePipelineAudit } from "../utils/mlbOnlyMode.js";
import {
  parseUnderdogPayloadDedicated,
  extractRawUnderdogRecords,
  logUnderdogResponseShape,
  UNDERDOG_PARSER_MISMATCH_MESSAGE,
} from "../utils/parseUnderdogProp.js";
import { unwrapUnderdogPayload } from "../utils/underdogEnvelope.js";
import { filterResolvedSportProps } from "../utils/underdogSportDetection.js";
import { recordProviderResponse } from "../utils/rawResponseDebug.js";

const UNDERDOG_ENDPOINTS = [
  "/api/underdog/beta/v5/over_under_lines",
  "/api/underdog",
  "/api/underdog/beta/v3/over_under_lines",
];
const UNDERDOG_CACHE_KEY = "dfs-underdog-last-good-payload";
const UNDERDOG_LEGACY_CACHE_KEY = "ud_cache";
const UNDERDOG_CACHE_MAX_MS = 60 * 60 * 1000;
export const UNDERDOG_TEMPORARY_MESSAGE = "Underdog temporarily unavailable.";
const UNDERDOG_UNAVAILABLE_MESSAGE = UNDERDOG_TEMPORARY_MESSAGE;
const UNDERDOG_RATE_LIMIT_MESSAGE = "Rate limited. Showing cached lines until cooldown ends.";
const UNDERDOG_AUDIT_PREFIX = "[Underdog Audit]";

const WTA_NAME_HINTS = new Set([
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

export async function fetchUnderdogProps({ sport = "all", statType = "all" } = {}) {
  return withSourceRequestLock(SOURCE_IDS.UNDERDOG, () => fetchUnderdogPropsInternal({ sport, statType }));
}

async function fetchUnderdogPropsInternal({ sport = "all", statType = "all" } = {}) {
  if (isSourceInCooldown(SOURCE_IDS.UNDERDOG)) {
    const cachedResult = buildCachedUnderdogResult({ sport, statType, attempts: [], reason: "cooldown" });
    if (cachedResult) return cachedResult;
    return failedUnderdogResult({
      apiUrl: absoluteUrl(underdogEndpoints()[0]),
      endpointsTried: [],
      message: "Underdog is in cooldown and no cached lines are available.",
      attempts: [],
    });
  }

  const attempts = [];

  for (const endpoint of underdogEndpoints()) {
    const apiUrl = absoluteUrl(endpoint);
    console.info(`${UNDERDOG_AUDIT_PREFIX} calling API/proxy URL`, apiUrl);

    const parsed = await fetchUnderdogEndpoint(endpoint);
    attempts.push(parsed.attempt);

    if (!parsed.ok) {
      if (parsed.rateLimited) {
        recordSource429(SOURCE_IDS.UNDERDOG);
        const cachedResult = buildCachedUnderdogResult({ sport, statType, attempts, reason: "rate-limit" });
        if (cachedResult) return cachedResult;
      }
      continue;
    }

    const payload = parsed.payload;
    console.info(`${UNDERDOG_AUDIT_PREFIX} raw Underdog response`, payload);
      const setupWarning = setupWarningFromPayload(payload, "Underdog");
      if (payload?.error && payload?.needsSetup) {
        return {
          source: "Underdog",
          status: "Fallback",
          props: [],
          warnings: [setupWarning || UNDERDOG_UNAVAILABLE_MESSAGE],
          debug: underdogDebug({
            apiUrl,
            apiStatus: "Fallback",
            endpointsTried: attempts.map((item) => item.url),
            rawPropsLoaded: rawUnderdogRecordCount(payload),
            parsedPropsCount: 0,
            message: setupWarning || UNDERDOG_UNAVAILABLE_MESSAGE,
          }),
        };
      }
      if (payload?.ok === false || payload?.status === "failed" || payload?.error) {
        const message =
          payload.error ||
          payload.message ||
          payload.errorMessage ||
          setupWarning ||
          UNDERDOG_UNAVAILABLE_MESSAGE;
        return failedUnderdogResult({
          apiUrl,
          endpointsTried: attempts.map((item) => item.url),
          rawPropsLoaded: rawUnderdogRecordCount(payload),
          message: typeof message === "string" ? message : UNDERDOG_UNAVAILABLE_MESSAGE,
          attempts,
        });
      }
      const rawCount = rawUnderdogRecordCount(payload);
      logUnderdogResponseShape(payload);
      const rawSamples = extractRawUnderdogRecords(payload).slice(0, 3);
      const { props: parsedProps, audit, diagnostics, responseShape } = parseUnderdogPayload(payload, "LIVE", sport);
      logPipelineAudit("Underdog", audit);
      const props = MLB_ONLY_MODE
        ? filterResolvedSportProps(parsedProps, sport === "all" ? "MLB" : sport, { selectedSportTab: "MLB" })
        : parsedProps.filter((prop) => matchesFilter(prop, sport, statType));
      const usableCount = countUsableProps(props);
      if (parsedProps.length > 0) {
        writeCachedPayload(sanitizeUnderdogPayloadForCache(payload));
        recordSourceSuccess(SOURCE_IDS.UNDERDOG);
      }
      console.info(`${UNDERDOG_AUDIT_PREFIX} parsed Underdog props count`, {
        rawPropsLoaded: rawCount,
        parsedPropsCount: parsedProps.length,
        filteredPropsCount: props.length,
        usablePropsCount: usableCount,
      });
      recordProviderResponse("underdog", {
        url: apiUrl,
        status: parsed.attempt?.status ?? attempts.at(-1)?.status ?? null,
        payload,
        rawCount,
        parsedCount: parsedProps.length,
        normalizedCount: props.length,
        errors: diagnostics?.parserErrors || [],
        message: diagnostics?.parserMismatch ? UNDERDOG_PARSER_MISMATCH_MESSAGE : "",
      });

      if (!usableCount) {
        const cachedResult = buildCachedUnderdogResult({ sport, statType, attempts, reason: "empty-parse" });
        if (cachedResult && !diagnostics?.parserMismatch) return cachedResult;
        const parserMessage =
          rawCount > 0 && parsedProps.length === 0
            ? `${UNDERDOG_PARSER_MISMATCH_MESSAGE} ${Object.entries(diagnostics?.rejectionReasons || {})
                .map(([k, v]) => `${k}(${v})`)
                .join(", ")}`
            : parsedProps.length > 0 && props.length === 0
              ? `Underdog parsed ${parsedProps.length} lines but none matched MLB filters (${rawCount} raw).`
              : parsedProps.length > 0
                ? "Underdog props parsed but none matched MLB filters."
                : EMPTY_SOURCE_MESSAGE;
        console.warn(`${UNDERDOG_AUDIT_PREFIX} no usable parsed props`, {
          url: apiUrl,
          rawPropsLoaded: rawCount,
          parsedPropsCount: parsedProps.length,
          filteredCount: props.length,
          diagnostics,
          responseShape,
        });
        return {
          source: "Underdog",
          status: rawCount > 0 ? "Connected" : "Empty",
          props: [],
          parsedProps,
          warnings: [parserMessage],
          health: parsedProps.length ? "LIVE" : "EMPTY",
          lineSourceBadge: parsedProps.length ? "LIVE" : "EMPTY",
          pipelineAudit: audit,
          debug: underdogDebug({
            apiUrl,
            apiStatus: rawCount > 0 ? "Connected" : "Empty",
            endpointsTried: attempts.map((item) => item.url),
            rawPropsLoaded: rawCount,
            parsedPropsCount: parsedProps.length,
            message: parserMessage,
            underdogParser: diagnostics,
            rawUnderdogSamples: rawSamples,
            responseShape,
          }),
        };
      }

      return {
        source: "Underdog",
        status: "Connected",
        props,
        parsedProps,
        pipelineAudit: audit,
        lineSourceBadge: usableCount > 0 ? "LIVE" : "EMPTY",
        health: usableCount > 0 ? "LIVE" : "EMPTY",
        lastSuccessfulFetchAt: new Date().toISOString(),
        warnings: setupWarning
          ? [setupWarning]
          : diagnostics?.parserMismatch
            ? [UNDERDOG_PARSER_MISMATCH_MESSAGE]
            : [],
        debug: underdogDebug({
          apiUrl,
          apiStatus: "Connected",
          endpointsTried: attempts.map((item) => item.url),
          rawPropsLoaded: rawCount,
          parsedPropsCount: parsedProps.length,
          message: diagnostics?.parserMismatch ? UNDERDOG_PARSER_MISMATCH_MESSAGE : "",
          underdogParser: diagnostics,
          rawUnderdogSamples: rawSamples,
        }),
      };
  }

  recordSourceFailure(SOURCE_IDS.UNDERDOG, "Underdog live fetch failed");
  const cachedResult = buildCachedUnderdogResult({ sport, statType, attempts, reason: "fetch-failed" });
  if (cachedResult) return cachedResult;

  return failedUnderdogResult({
    apiUrl: attempts.at(-1)?.url || absoluteUrl(underdogEndpoints()[0]),
    endpointsTried: attempts.map((item) => item.url),
    message: UNDERDOG_TEMPORARY_MESSAGE,
    attempts,
    sport,
    statType,
  });
}

function buildCachedUnderdogResult({ sport, statType, attempts, reason = "fetch-failed" }) {
  const cachedPayload = readCachedPayload();
  if (!cachedPayload) return null;
  const savedAt = readCachedPayloadSavedAt();
  const { props: parsedProps, audit } = parseUnderdogPayload(cachedPayload, "CACHED");
  logPipelineAudit("Underdog-cached", audit);
  const props = MLB_ONLY_MODE
    ? filterResolvedSportProps(parsedProps, sport === "all" ? "MLB" : sport, { selectedSportTab: "MLB" })
    : parsedProps.filter((prop) => matchesFilter(prop, sport, statType));
  if (!props.length) return null;
  markSourceCached(SOURCE_IDS.UNDERDOG, savedAt);
  const rateLimited = reason === "rate-limit" || reason === "cooldown" || attempts.some((item) => item.status === 429);
  const warning =
    rateLimited
      ? cachedLinesMessage(savedAt) || UNDERDOG_RATE_LIMIT_MESSAGE
      : reason === "fetch-failed"
        ? UNDERDOG_TEMPORARY_MESSAGE
        : "Underdog live fetch failed; showing last cached real lines.";
  return {
    source: "Underdog",
    status: "Cached",
    props,
    pipelineAudit: audit,
    lineSourceBadge: "CACHED",
    health: "CACHED",
    lastSuccessfulFetchAt: savedAt,
    rateLimited,
    warnings: [warning, ...formatUnderdogAttemptWarnings(attempts)],
    debug: underdogDebug({
      apiUrl: "localStorage:last-good-underdog",
      apiStatus: "Cached",
      endpointsTried: attempts.map((item) => item.url),
      rawPropsLoaded: rawUnderdogRecordCount(cachedPayload),
      parsedPropsCount: props.length,
      message: warning,
    }),
  };
}

async function fetchUnderdogEndpoint(endpoint) {
  // Soft retry queue: transient network/5xx failures retry with exponential
  // backoff (~750ms → 1.5s → 3s → 6s) before bubbling up so the cache
  // fallback only kicks in after we've genuinely failed. 429s short-circuit.
  return withSourceRetryQueue(
    SOURCE_IDS.UNDERDOG,
    () => attemptUnderdogEndpoint(endpoint),
    {
      maxAttempts: 3,
      isRetryable: (result, error) => {
        if (error) return true;
        if (!result || result.ok) return false;
        if (result.rateLimited) return false;
        if (result.networkError) return true;
        const status = Number(result.attempt?.status || 0);
        if (status === 502 || status === 503 || status === 504) return true;
        return false;
      },
    }
  );
}

async function attemptUnderdogEndpoint(endpoint) {
  const lineFeedTimeoutMs = getLineFeedTimeoutMs();
  const attempt = {
    url: absoluteUrl(endpoint),
    status: null,
    contentType: "",
    preview: "",
    error: "",
    durationMs: 0,
  };
  const startedAt = Date.now();

  try {
    const response = await resilientFetch(
      endpoint,
      { headers: lineFeedJsonHeaders(), cache: "no-store" },
      {
        source: "Underdog",
        ttlMs: 0,
        timeoutMs: lineFeedTimeoutMs,
        maxRetries: LINE_FEED_MAX_RETRIES,
        retryDelayMs: LINE_FEED_RETRY_DELAY_MS,
        skip429Retry: true,
      }
    );
    attempt.status = response.status;
    attempt.contentType = response.headers.get("content-type") || "";
    attempt.durationMs = Date.now() - startedAt;
    const text = await response.text();
    attempt.preview = text.slice(0, 200).replace(/\s+/g, " ").trim();

    console.info(`${UNDERDOG_AUDIT_PREFIX} fetch attempt`, {
      url: attempt.url,
      status: attempt.status,
      contentType: attempt.contentType,
      durationMs: attempt.durationMs,
      preview: attempt.preview,
    });

    if (!response.ok) {
      attempt.error = response.status === 429 ? "Underdog rate limited (429)" : `HTTP ${response.status}`;
      return { ok: false, attempt, rateLimited: response.status === 429 };
    }

    const trimmed = text.trim();
    if (!trimmed) {
      attempt.error = "Empty response body";
      return { ok: false, attempt };
    }

    if (
      /javascript/i.test(attempt.contentType) ||
      trimmed.includes("const APIFY_PRIZEPICKS_ACTOR") ||
      trimmed.startsWith("<") ||
      /^export\s+default\b/.test(trimmed) ||
      trimmed.includes("export default async function")
    ) {
      attempt.error = "API route is serving source/HTML instead of JSON. Check proxy/backend routing.";
      return { ok: false, attempt };
    }

    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch (parseError) {
      console.error("Non-JSON response:", trimmed.slice(0, 300));
      attempt.error = `Underdog returned non-JSON response: ${parseError.message || "invalid JSON"}`;
      return { ok: false, attempt, nonJson: true };
    }

    if (payload?.ok === false || payload?.status === "failed") {
      attempt.error = payload.error || payload.message || "Proxy error payload";
      return { ok: false, attempt };
    }

    return { ok: true, attempt, payload };
  } catch (error) {
    const message = error?.message || String(error);
    attempt.error = /timed out|abort/i.test(message)
      ? `Request timed out after ${Math.round(lineFeedTimeoutMs / 1000)}s`
      : message || "Failed to fetch";
    attempt.durationMs = Date.now() - startedAt;
    attempt.networkError = true;
    return { ok: false, attempt, networkError: true };
  }
}

function underdogEndpoints() {
  const proxyUrl = getProxyUrl("underdog");
  if (!proxyUrl) return UNDERDOG_ENDPOINTS;
  const url = new URL("/api/underdog", window.location.origin);
  url.searchParams.set("proxyUrl", proxyUrl);
  return [url.pathname + url.search, ...UNDERDOG_ENDPOINTS];
}

function formatUnderdogAttemptWarnings(attempts = []) {
  if (!attempts.length) return [UNDERDOG_UNAVAILABLE_MESSAGE];
  const last = attempts[attempts.length - 1];
  const lines = attempts.map(
    (item) =>
      `${item.url} → status ${item.status ?? "?"} · ${item.contentType || "no content-type"} · ${item.error || item.preview || "no body"}`
  );
  lines.push(`Underdog returned non-JSON response. First 200 chars: ${last.preview || ""}`);
  return lines;
}

function failedUnderdogResult({ apiUrl, endpointsTried, rawPropsLoaded = 0, message, attempts = [], sport = "all", statType = "all" }) {
  const cachedResult = buildCachedUnderdogResult({ sport, statType, attempts, reason: "fetch-failed" });
  if (cachedResult) {
    const warnings = [UNDERDOG_TEMPORARY_MESSAGE, ...(cachedResult.warnings || [])].filter(
      (item, index, list) => list.indexOf(item) === index
    );
    return { ...cachedResult, warnings };
  }
  const warnings = formatUnderdogAttemptWarnings(attempts);
  const softMessage = UNDERDOG_TEMPORARY_MESSAGE;
  if (message && !warnings.includes(message) && message !== softMessage) warnings.unshift(message);
  if (!warnings.includes(softMessage)) warnings.unshift(softMessage);
  return {
    source: "Underdog",
    status: "Unavailable",
    props: [],
    lineSourceBadge: "",
    health: "STALE",
    warnings,
    fallback: true,
    debug: underdogDebug({
      apiUrl,
      apiStatus: "Unavailable",
      endpointsTried,
      rawPropsLoaded,
      parsedPropsCount: 0,
      message: softMessage,
    }),
  };
}

function parseUnderdogPayload(payload, lineSourceBadge = "LIVE", selectedSport = "MLB") {
  return safeParse("Underdog.parsePayload", () => parseUnderdogPayloadInternal(payload, lineSourceBadge, selectedSport), {
    props: [],
    audit: coercePipelineAudit(emptySourcePipelineAudit()),
    diagnostics: { rawCount: 0, acceptedCount: 0, rejectedCount: 0, rejectionReasons: {}, parserMismatch: false },
  });
}

function parseUnderdogPayloadInternal(payload, lineSourceBadge = "LIVE", selectedSport = "MLB") {
  let audit = safeCreateEmptyPipelineAudit();
  try {
    audit = createEmptyPipelineAudit();
    const { props, diagnostics, responseShape } = parseUnderdogPayloadDedicated(payload, lineSourceBadge, selectedSport);
    audit.fetched = diagnostics.rawCount || props.length;
    audit.normalized = props.length;
    props.forEach((prop) => recordNormalizedSample(audit, prop));

    if (diagnostics.rejectedCount > 0) {
      Object.entries(diagnostics.rejectionReasons || {}).forEach(([reason, count]) => {
        for (let i = 0; i < count; i += 1) {
          recordFilterReason(audit, `underdog parser: ${reason}`);
        }
      });
    }

    audit.underdogParser = diagnostics;
    if (diagnostics.parserMismatch) {
      audit.parserMismatch = true;
      console.warn(`${UNDERDOG_AUDIT_PREFIX} ${UNDERDOG_PARSER_MISMATCH_MESSAGE}`, diagnostics);
    }

    return {
      props,
      audit: coercePipelineAudit({
        ...audit,
        underdogParser: diagnostics,
      }),
      diagnostics,
      responseShape,
    };
  } catch (error) {
    console.warn("[Underdog] dedicated parse payload failed; returning empty audit-safe result", error);
    return { props: [], audit: coercePipelineAudit(audit), diagnostics: { rawCount: 0, acceptedCount: 0, rejectedCount: 0, rejectionReasons: {}, parserMismatch: false } };
  }
}

function writeCachedPayload(payload) {
  try {
    window.localStorage.setItem(UNDERDOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
    window.localStorage.setItem(UNDERDOG_LEGACY_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function readCachedPayload() {
  try {
    const cached = safeParseJSON(window.localStorage.getItem(UNDERDOG_CACHE_KEY), null);
    if (cached?.payload && Date.now() - cached.savedAt <= UNDERDOG_CACHE_MAX_MS) {
      return sanitizeUnderdogPayloadForCache(cached.payload);
    }
  } catch {
    // fall through to legacy key
  }
  try {
    const legacy = safeParseJSON(window.localStorage.getItem(UNDERDOG_LEGACY_CACHE_KEY), null);
    if (!legacy) return null;
    const payload = legacy?.payload && typeof legacy.payload === "object" ? legacy.payload : legacy;
    return sanitizeUnderdogPayloadForCache(payload);
  } catch {
    return null;
  }
}

function readCachedPayloadSavedAt() {
  try {
    const cached = safeParseJSON(window.localStorage.getItem(UNDERDOG_CACHE_KEY), null);
    if (cached?.savedAt) return new Date(cached.savedAt).toISOString();
  } catch {
    // ignore
  }
  return "";
}

function rawUnderdogRecordCount(payload) {
  return extractRawUnderdogRecords(payload).length;
}

function underdogDebug({ apiUrl, apiStatus, endpointsTried, rawPropsLoaded, parsedPropsCount, message, underdogParser = null, rawUnderdogSamples = [], responseShape = null }) {
  return {
    selectedSource: "Underdog",
    apiUrl,
    endpointsTried,
    apiStatus,
    rawPropsLoaded,
    propsAfterParsing: parsedPropsCount,
    message,
    underdogParser,
    rawUnderdogSamples,
    responseShape,
  };
}

function absoluteUrl(endpoint) {
  try {
    return new URL(endpoint, window.location.origin).toString();
  } catch {
    return endpoint;
  }
}

function unwrapProxyPayload(payload) {
  const normalized = unwrapUnderdogPayload(payload);
  if (Array.isArray(normalized)) return normalized;
  return normalized || {};
}

function setupWarningFromPayload(payload, source) {
  if (!payload?.error && !payload?.needsSetup) return "";
  return payload.message || `${source} proxy needs setup.`;
}

function normalizeFlatUnderdogItem(item = {}, lineSourceBadge = "LIVE", audit = null) {
  if (rejectIngestionAtSource(buildUnderdogFlatIngestionContext(item), audit, recordFilterReason, item)) {
    return null;
  }
  const line = Number(item.stat_value ?? item.line ?? item.non_discounted_stat_value ?? item.projection ?? item.value);
  const statType = normalizeStatType(item.stat_type || item.statType || item.market || item.title || item.description);
  if (!Number.isFinite(line) || !statType) {
    if (audit) recordFilterReason(audit, "missing line or statType (flat underdog)", item);
    return null;
  }
  const startTime = normalizeGameStartTime(
    item.start_time || item.startTime || item.scheduled_at || item.game_time || item.commence_time,
    { allowFallback: true }
  );
  const timeUncertainty = startTimeUncertainty(item.start_time || item.startTime);

  const playerName = item.player_name || item.playerName || item.name || item.display_name || item.player || "";
  const explicitSources = [
    item.player_name,
    item.playerName,
    item.display_name,
    item.name,
  ];
  if (isMalformedPlayerName(playerName)) {
    if (audit) recordFilterReason(audit, "malformed player name (flat underdog)", item);
    return null;
  }
  const playerImage = item.playerImage || item.player_image || item.imageUrl || item.image_url || item.headshot || item.headshot_url || "";
  const options = item.options || item.choices || [];

  return finalizeUnderdogProp(
    {
    platform: "Underdog",
    lineSourceBadge,
    sport: normalizeSport(item.league || item.sport || statType, { playerName, opponent: item.opponent || "" }),
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
    streakOptions: buildUnderdogStreakOptions(options),
    isAdjustedOdds: false,
    oddsType: "standard",
    odds_type: "standard",
    projection: null,
    confidenceScore: 0,
    edgeRating: 0,
    riskLevel: "High",
    status: normalizeStatus(item.status || item.state, startTime),
    sourceId: item.id || "",
    timeUncertainty,
    raw: item,
  },
    { raw: item, explicitSources, audit }
  );
}

function normalizeUnderdogLine(line, players, games, appearances, teams, lineSourceBadge = "LIVE", audit = null) {
  const overUnder = line.over_under || line.overUnder || line.attributes || line;
  const statRecord = overUnder.appearance_stat || overUnder.stat || line.stat || {};
  const appearanceId =
    overUnder.appearance_id ||
    statRecord.appearance_id ||
    line.appearance_id ||
    line.relationships?.appearance?.data?.id;
  const appearance = appearances.get(String(appearanceId)) || {};
  const playerId = appearance.player_id || overUnder.player_id || line.player_id || line.athlete_id;
  const player = players.get(String(playerId)) || {};
  const gameId = appearance.game_id || appearance.match_id || overUnder.game_id || overUnder.match_id || line.game_id || line.match_id;
  const game = games.get(String(gameId)) || {};
  if (
    rejectIngestionAtSource(
      buildUnderdogLineIngestionContext({ line, overUnder, game, player, appearance }),
      audit,
      recordFilterReason,
      line
    )
  ) {
    return null;
  }
  const lineValue = Number(
    line.stat_value ??
      line.line ??
      line.non_discounted_stat_value ??
      overUnder.stat_value ??
      overUnder.line ??
      overUnder.non_discounted_stat_value
  );
  const startTime = normalizeGameStartTime(
    game.scheduled_at || game.start_time || appearance.scheduled_at || overUnder.scheduled_at,
    { allowFallback: true }
  );
  const timeUncertainty = startTimeUncertainty(game.scheduled_at || game.start_time);
  const statType = normalizeStatType(statRecord.display_stat || statRecord.stat || overUnder.title || overUnder.stat_type);
  const options = line.options || line.choices || overUnder.options || overUnder.choices || [];
  const optionHeader = commonOptionHeader(options);
  const resolvedPlayerName = playerFullName(player);
  const playerName =
    resolvedPlayerName ||
    line.player_name ||
    overUnder.player_name ||
    (!isMergedMultiPlayerName(optionHeader) ? optionHeader : "") ||
    titlePlayerName(overUnder.title) ||
    "";
  const explicitSources = [
    resolvedPlayerName,
    line.player_name,
    overUnder.player_name,
    player.full_name,
    player.name,
  ];
  if (isMalformedPlayerName(playerName)) {
    if (audit) recordFilterReason(audit, "malformed player name (underdog)", line);
    return null;
  }
  const playerImage =
    player.image_url ||
    player.light_image_url ||
    player.dark_image_url ||
    player.headshot_url ||
    player.headshot ||
    player.photo_url ||
    player.avatar_url ||
    player.image ||
    overUnder.image_url ||
    line.image_url ||
    line.player_image ||
    "";
  const team = teamLabel(teams.get(String(appearance.team_id)) || {}, appearance, player);
  const opponent = appearance.opponent_abbr || game.short_title || game.abbreviated_title || game.title || game.away_team || game.home_team || "";
  const sport =
    sportFromUnderdogGame(game, overUnder) ||
    normalizeSport(game.sport_id || game.sport || overUnder.sport || statType, { playerName, opponent });
  const status = normalizeStatus(line.status || overUnder.status, startTime);

  if (!Number.isFinite(lineValue) || !statType) {
    if (audit) recordFilterReason(audit, "missing line or statType (underdog)", line);
    return null;
  }

  return finalizeUnderdogProp(
    {
    platform: "Underdog",
    lineSourceBadge,
    sport: sport || inferSportFromText(statType) || "",
    league: normalizeLeague(game.sport_id || game.league || sport),
    playerName,
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
    line: lineValue,
    directionOptions: ["More", "Less"],
    streakOptions: buildUnderdogStreakOptions(options),
    isAdjustedOdds: false,
    oddsType: "standard",
    odds_type: "standard",
    projection: null,
    confidenceScore: 0,
    edgeRating: 0,
    riskLevel: "High",
    status,
    sourceId: line.id,
    timeUncertainty,
    raw: line,
  },
    { raw: { ...line, over_under: overUnder }, explicitSources, audit }
  );
}

function finalizeUnderdogProp(prop, { raw = {}, explicitSources = [], audit = null } = {}) {
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
        "Underdog"
      )
    )
  );
}

function playerFullName(player = {}) {
  if (player.full_name || player.name) return player.full_name || player.name;
  return [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
}

function titlePlayerName(title = "") {
  const text = String(title || "");
  const marker = text.match(
    /^(.*?)\s+(Points|Pts|Rebounds|Assists|Hits|Runs|Total Bases|Strikeouts|Pitcher Strikeouts|3s|Fantasy)/i
  );
  const candidate = marker?.[1]?.trim() || "";
  if (!candidate || isMergedMultiPlayerName(candidate)) return "";
  return candidate;
}

function teamLabel(team = {}, appearance = {}, player = {}) {
  return (
    appearance.team_abbr ||
    team.abbr ||
    team.abbreviation ||
    team.short_name ||
    team.name ||
    player.team_abbr ||
    player.team ||
    ""
  );
}

function buildUnderdogStreakOptions(options = []) {
  return options
    .map((option) => {
      const multiplier = Number(
        option.payout_multiplier ??
          option.multiplier ??
          option.boosted_multiplier ??
          option.payoutMultiplier
      );
      const adjustedDescriptor = [
        option.payout_type,
        option.boost_type,
        option.type,
        option.label,
        option.title,
        option.name,
        option.selection_subheader,
      ]
        .map(normalizeKey)
        .join(" ");
      const verifiedAdjustedOdds = /^(demon|goblin|green goblin)$/.test(adjustedDescriptor.trim()) ||
        /\bdemon\b|\bgoblin\b|green goblin/.test(adjustedDescriptor);
      return {
        side: normalizeSide(option.choice_display || option.choice || option.choice_display_short),
        multiplier,
        rawProbability: Number(option.raw_probability),
        status: option.status,
        optionId: option.id,
        label: option.selection_subheader || option.choice_display || "",
        multiplierSource: verifiedAdjustedOdds ? "Underdog verified adjusted payout" : "Underdog payout multiplier",
        adjustedOddsType: verifiedAdjustedOdds ? adjustedDescriptor : "standard",
        verifiedAdjustedOdds,
      };
    })
    .filter((option) => Number.isFinite(option.multiplier));
}

function normalizeSide(value) {
  const key = normalizeKey(value);
  if (key.includes("higher") || key.includes("over")) return "Higher";
  if (key.includes("lower") || key.includes("under")) return "Lower";
  return String(value || "Higher");
}

function commonOptionHeader(options = []) {
  const headers = Array.from(new Set(options.map((option) => option.selection_header).filter(Boolean)));
  return headers.length === 1 ? headers[0] : "";
}

function mapById(records) {
  const map = new Map();
  records.forEach((record) => {
    if (record?.id != null) map.set(String(record.id), record);
  });
  return map;
}

function normalizeSport(value, context = {}) {
  const text = String(value || "").toLowerCase();
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (slug === "soc" || slug === "soccer" || slug === "soccerball") return "Soccer";
  if (text.includes("mlb") || text.includes("baseball")) return "MLB";
  if (text.includes("nhl") || text.includes("hockey")) return "NHL";
  if (text.includes("ncaaf") || text.includes("college football")) return "NCAAF";
  if (text.includes("nfl") && !text.includes("soccer")) return "NFL";
  if (text.includes("wnba") || text.includes("women's basketball") || text.includes("womens basketball")) return "WNBA";
  if ((text.includes("nba") || slug === "nba") && !text.includes("wnba")) return "NBA";
  if (text.includes("basketball") && !text.includes("wnba")) return "NBA";
  if (text.includes("wta") || (text.includes("women") && text.includes("tennis"))) return "WTA Tennis";
  if (text.includes("tennis")) return classifyTennisSport(context);
  if (text.includes("atp") || (text.includes("men") && text.includes("tennis"))) return "ATP Tennis";
  if (
    text.includes("soccer") ||
    text.includes("epl") ||
    text.includes("mls") ||
    text.includes("laliga") ||
    text.includes("premierleague") ||
    (text.includes("football") && !text.includes("college") && !text.includes("nfl"))
  ) {
    return "Soccer";
  }
  return "Other";
}

function classifyTennisSport({ playerName = "", opponent = "" } = {}) {
  const names = `${playerName} ${opponent}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return names.some((name) => WTA_NAME_HINTS.has(name)) ? "WTA Tennis" : "ATP Tennis";
}

function normalizeLeague(value) {
  const sport = normalizeSport(value);
  return sport === "Other" ? String(value || "Other") : sport;
}

function normalizeStatType(value) {
  return normalizeMarketStatType(value);
}

function normalizeStatus(status, startTime) {
  const lower = String(status || "").toLowerCase();
  const start = new Date(startTime).getTime();
  if (lower.includes("locked") || lower.includes("suspended")) return "locked";
  if (lower.includes("expired") || lower.includes("closed")) return "expired";
  if (lower.includes("pregame") || lower.includes("pre_game") || lower.includes("scheduled") || lower.includes("open")) {
    return "upcoming";
  }
  if (Number.isFinite(start) && start <= Date.now()) return "live";
  return "upcoming";
}

function matchesFilter(prop, sport, statType) {
  const sportOk = sport === "all" || resolvePropSportLabel(prop) === sport || prop.sport === sport;
  const statOk = statType === "all" || normalizeKey(prop.statType) === normalizeKey(statType);
  return sportOk && statOk;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
