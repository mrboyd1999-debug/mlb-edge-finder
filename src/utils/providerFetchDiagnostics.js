/**
 * Shared provider fetch diagnostics — response time, HTTP status, payload size, parsed counts.
 */

export const PROVIDER_SLOW_THRESHOLD_MS = 10_000;

const EMPTY_PROVIDER = {
  responseTimeMs: null,
  httpStatus: null,
  payloadSize: 0,
  parsedPropsCount: 0,
  rawPropCount: 0,
  timedOut: false,
  slow: false,
  timeoutProvider: "",
  lastError: "",
  lastPhase: "",
  phases: [],
  updatedAt: "",
};

let snapshot = {
  prizepicks: { ...EMPTY_PROVIDER },
  underdog: { ...EMPTY_PROVIDER },
};

function providerKey(label = "") {
  return String(label).toLowerCase().includes("underdog") ? "underdog" : "prizepicks";
}

function logPrefix(label = "") {
  return String(label).toLowerCase().includes("underdog") ? "[Underdog]" : "[PrizePicks]";
}

export function resetProviderFetchDiagnostics() {
  snapshot = {
    prizepicks: { ...EMPTY_PROVIDER, updatedAt: new Date().toISOString() },
    underdog: { ...EMPTY_PROVIDER, updatedAt: new Date().toISOString() },
  };
  publish();
}

export function getProviderFetchDiagnostics() {
  return {
    prizepicks: { ...snapshot.prizepicks },
    underdog: { ...snapshot.underdog },
  };
}

export function updateProviderFetchDiagnostics(labelOrKey, patch = {}) {
  const key = providerKey(labelOrKey);
  const prev = snapshot[key] || { ...EMPTY_PROVIDER };
  snapshot[key] = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  publish();
  return snapshot[key];
}

export function logProviderFetchPhase(label, phase, detail = {}) {
  const prefix = logPrefix(label);
  console.info(`${prefix} ${phase}`, detail);
  updateProviderFetchDiagnostics(label, {
    lastPhase: phase,
    phases: [...(snapshot[providerKey(label)]?.phases || []), { phase, at: new Date().toISOString(), ...detail }].slice(
      -12
    ),
  });
}

export function recordProviderFetchMetrics(label, metrics = {}) {
  const key = providerKey(label);
  const responseTimeMs = Number(metrics.responseTimeMs ?? metrics.durationMs);
  const slow =
    Boolean(metrics.slow) ||
    (Number.isFinite(responseTimeMs) && responseTimeMs >= PROVIDER_SLOW_THRESHOLD_MS);
  const timedOut = Boolean(metrics.timedOut);

  if (slow || timedOut) {
    console.warn(
      `[Provider] ${label} ${timedOut ? "timed out" : "slow"} — ${Number.isFinite(responseTimeMs) ? `${responseTimeMs}ms` : "unknown duration"}`
    );
  }

  return updateProviderFetchDiagnostics(label, {
    responseTimeMs: Number.isFinite(responseTimeMs) ? responseTimeMs : null,
    httpStatus: metrics.httpStatus ?? metrics.statusCode ?? null,
    payloadSize: Number(metrics.payloadSize ?? metrics.responseSize ?? 0) || 0,
    parsedPropsCount: Number(metrics.parsedPropsCount ?? 0) || 0,
    rawPropCount: Number(metrics.rawPropCount ?? 0) || 0,
    timedOut,
    slow,
    timeoutProvider: timedOut || slow ? label : "",
    lastError: metrics.lastError || "",
  });
}

export function buildProviderEntryDiagnostics(entry = {}, result = {}) {
  const label = entry.label || "Provider";
  const key = providerKey(label);
  const stored = snapshot[key] || {};
  const debug = result?.debug || {};
  const diagnostics = result?.diagnostics || {};
  const responseTimeMs = entry.durationMs ?? stored.responseTimeMs ?? diagnostics.durationMs ?? null;
  const slow = Boolean(entry.timedOut || stored.slow || (responseTimeMs >= PROVIDER_SLOW_THRESHOLD_MS));
  return {
    label,
    responseTimeMs,
    httpStatus:
      stored.httpStatus ??
      debug.lastAttemptStatus ??
      entry.result?.debug?.lastAttemptStatus ??
      null,
    payloadSize: stored.payloadSize ?? 0,
    parsedPropsCount:
      stored.parsedPropsCount ??
      result?.props?.length ??
      result?.parsedProps?.length ??
      debug.propsAfterParsing ??
      diagnostics.parsedPropsCount ??
      0,
    rawPropCount: stored.rawPropCount ?? debug.rawPropsLoaded ?? diagnostics.rawPropsLoaded ?? 0,
    timedOut: Boolean(entry.timedOut || stored.timedOut),
    slow,
    timeoutProvider: entry.timedOut || slow ? label : "",
    lastError: stored.lastError || entry.statusReason || result?.warnings?.[0] || "",
    lastPhase: stored.lastPhase || "",
    skipped: Boolean(entry.skipped),
    notConfigured: Boolean(entry.notConfigured),
  };
}

function publish() {
  if (typeof window === "undefined") return;
  window.__PROVIDER_FETCH_DIAGNOSTICS__ = getProviderFetchDiagnostics();
}
