/**
 * Isolated Underdog provider — partial degradation only; never blocks PrizePicks.
 */
import {
  fetchUnderdogProps,
  UNDERDOG_TEMPORARY_MESSAGE,
} from "../underdog.js";

export const UNDERDOG_PROVIDER_ID = "underdog";
export const UNDERDOG_SOFT_MESSAGE = UNDERDOG_TEMPORARY_MESSAGE;

const HARD_FAIL_STATUSES = new Set(["Failed"]);

export function resolveUnderdogHealth(result = {}) {
  const badge = String(result.lineSourceBadge || result.health || "").toUpperCase();
  const status = String(result.status || "");
  const hasProps = Boolean(result.props?.length || result.parsedProps?.length);
  if (HARD_FAIL_STATUSES.has(status) && !hasProps) {
    if (badge === "CACHED") return "CACHED";
    if (badge === "STALE") return "STALE";
    return result.lastSuccessfulFetchAt ? "DEGRADED" : "OFFLINE";
  }
  if (badge === "CACHED") return "CACHED";
  if (badge === "STALE") return "STALE";
  if (status === "Cached") return "CACHED";
  if (["Connected", "Full", "Empty"].includes(status) && hasProps) return "LIVE";
  if (hasProps) return "LIVE";
  return status === "Connected" ? "DEGRADED" : "DEGRADED";
}

export function buildUnderdogDiagnostics(result = {}, durationMs = 0) {
  const debug = result.debug || {};
  return {
    provider: UNDERDOG_PROVIDER_ID,
    durationMs,
    apiUrl: debug.apiUrl || "",
    apiStatus: debug.apiStatus || result.status || "Unknown",
    endpointsTried: debug.endpointsTried || [],
    rawPropsLoaded: debug.rawPropsLoaded ?? 0,
    parsedPropsCount: debug.parsedPropsCount ?? result.parsedProps?.length ?? result.props?.length ?? 0,
    message: debug.message || result.warnings?.[0] || "",
    health: resolveUnderdogHealth(result),
    partialDegradation: !result.props?.length && !result.parsedProps?.length,
    responseShape: debug.responseShape || null,
    underdogParser: debug.underdogParser || null,
  };
}

function normalizeProviderResult(result, durationMs) {
  const parsedProps = result?.parsedProps?.length ? result.parsedProps : result?.props || [];
  const hasProps = parsedProps.length > 0;
  const status = String(result?.status || "");
  const hardFailed = HARD_FAIL_STATUSES.has(status) && !hasProps;
  const health = resolveUnderdogHealth({ ...result, props: parsedProps, parsedProps });
  const diagnostics = buildUnderdogDiagnostics({ ...result, props: parsedProps, parsedProps }, durationMs);

  if (hardFailed) {
    return {
      ...result,
      source: "Underdog",
      status: "Unavailable",
      props: [],
      parsedProps: [],
      warnings: result.warnings?.length ? result.warnings : [UNDERDOG_SOFT_MESSAGE],
      lineSourceBadge: result.lineSourceBadge || (health === "CACHED" ? "CACHED" : "STALE"),
      health,
      diagnostics,
      partialDegradation: true,
    };
  }

  return {
    ...result,
    props: parsedProps,
    parsedProps,
    health,
    diagnostics,
    partialDegradation: !hasProps,
    status: hasProps ? status === "Cached" ? "Cached" : "Connected" : status || "Empty",
  };
}

function degradedResult(error, durationMs) {
  const message = error?.debug?.message || error?.message || UNDERDOG_SOFT_MESSAGE;
  return {
    source: "Underdog",
    status: "Unavailable",
    props: [],
    warnings: [UNDERDOG_SOFT_MESSAGE],
    lineSourceBadge: "STALE",
    health: "OFFLINE",
    partialDegradation: true,
    diagnostics: {
      provider: UNDERDOG_PROVIDER_ID,
      durationMs,
      apiStatus: "Unavailable",
      message,
      health: "OFFLINE",
      partialDegradation: true,
      endpointsTried: error?.debug?.endpointsTried || [],
    },
    debug: {
      apiStatus: "Unavailable",
      message,
      ...(error?.debug || {}),
    },
  };
}

/** Provider entry — always resolves; never throws to caller. */
export async function fetchUnderdogProviderProps(options = {}) {
  const startedAt = Date.now();
  try {
    const result = await fetchUnderdogProps(options);
    return normalizeProviderResult(result, Date.now() - startedAt);
  } catch (error) {
    console.warn("[Underdog Provider] fetch failed — partial degradation", error);
    return degradedResult(error, Date.now() - startedAt);
  }
}

export function applyUnderdogProviderToDebug(debugInfo = {}, providerResult = {}) {
  if (!debugInfo?.sources) return debugInfo;
  const diag = providerResult.diagnostics || {};
  debugInfo.sources.Underdog = {
    ...debugInfo.sources.Underdog,
    status: providerResult.partialDegradation && !providerResult.props?.length
      ? "Degraded"
      : debugInfo.sources.Underdog?.status || providerResult.status,
    apiStatus: diag.apiStatus || providerResult.status,
    lineSourceBadge: providerResult.lineSourceBadge || providerResult.health || diag.health,
    message: diag.message || debugInfo.sources.Underdog?.message || "",
    providerHealth: diag.health || providerResult.health,
    providerDiagnostics: diag,
    underdogParser: diag.underdogParser || providerResult.debug?.underdogParser || debugInfo.sources.Underdog?.underdogParser,
    rawUnderdogSamples: providerResult.debug?.rawUnderdogSamples || debugInfo.sources.Underdog?.rawUnderdogSamples || [],
    responseShape: providerResult.debug?.responseShape || diag.responseShape || null,
    rawPropsLoaded: finiteOr(
      debugInfo.sources.Underdog?.rawPropsLoaded ?? diag.rawPropsLoaded ?? providerResult.debug?.rawPropsLoaded,
      0
    ),
    propsAfterParsing: finiteOr(
      debugInfo.sources.Underdog?.propsAfterParsing ??
        diag.parsedPropsCount ??
        providerResult.parsedProps?.length ??
        providerResult.props?.length,
      0
    ),
  };
  return debugInfo;
}

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
