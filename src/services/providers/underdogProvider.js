/**
 * Isolated Underdog provider — partial degradation only; never blocks PrizePicks.
 */
import {
  fetchUnderdogProps,
  UNDERDOG_TEMPORARY_MESSAGE,
} from "../underdog.js";

export const UNDERDOG_PROVIDER_ID = "underdog";
export const UNDERDOG_SOFT_MESSAGE = UNDERDOG_TEMPORARY_MESSAGE;

const DEGRADED_STATUSES = new Set(["Failed", "Unavailable", "Not Connected"]);

export function resolveUnderdogHealth(result = {}) {
  const badge = String(result.lineSourceBadge || result.health || "").toUpperCase();
  const status = String(result.status || "");
  if (DEGRADED_STATUSES.has(status) && !result.props?.length) {
    if (badge === "CACHED") return "CACHED";
    if (badge === "STALE") return "STALE";
    return result.lastSuccessfulFetchAt ? "DEGRADED" : "OFFLINE";
  }
  if (badge === "CACHED") return "CACHED";
  if (badge === "STALE") return "STALE";
  if (status === "Cached") return "CACHED";
  if (["Connected", "Full"].includes(status) && result.props?.length) return "LIVE";
  if (result.props?.length) return "LIVE";
  return "DEGRADED";
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
    parsedPropsCount: debug.parsedPropsCount ?? result.props?.length ?? 0,
    message: debug.message || result.warnings?.[0] || "",
    health: resolveUnderdogHealth(result),
    partialDegradation: DEGRADED_STATUSES.has(String(result.status || "")) || !result.props?.length,
  };
}

function normalizeProviderResult(result, durationMs) {
  const degraded = DEGRADED_STATUSES.has(String(result?.status || "")) || !result?.props?.length;
  const health = resolveUnderdogHealth(result);
  const diagnostics = buildUnderdogDiagnostics(result, durationMs);

  if (degraded && !result?.props?.length) {
    return {
      ...result,
      source: "Underdog",
      status: "Unavailable",
      props: [],
      warnings: result.warnings?.length ? result.warnings : [UNDERDOG_SOFT_MESSAGE],
      lineSourceBadge: result.lineSourceBadge || (health === "CACHED" ? "CACHED" : "STALE"),
      health,
      diagnostics,
      partialDegradation: true,
    };
  }

  return {
    ...result,
    health,
    diagnostics,
    partialDegradation: false,
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
    status: providerResult.partialDegradation ? "Unavailable" : debugInfo.sources.Underdog?.status || providerResult.status,
    apiStatus: diag.apiStatus || providerResult.status,
    lineSourceBadge: providerResult.lineSourceBadge || providerResult.health || diag.health,
    message: diag.message || debugInfo.sources.Underdog?.message || "",
    providerHealth: diag.health || providerResult.health,
    providerDiagnostics: diag,
  };
  return debugInfo;
}
