import {
  getEffectiveSetting,
  getProxyUrl,
  getRawProxyUrl,
  getSettingDef,
} from "../services/runtimeSettings.js";
import { PRIZEPICKS_MLB_LEAGUE_ID } from "./sportMappings.js";

export { getProxyUrl, getRawProxyUrl };

/** Canonical Settings / .env key for PrizePicks external proxy URL. */
export const PRIZEPICKS_PROXY_SETTING_KEY = "VITE_PRIZEPICKS_PROXY_URL";

/** Same-origin PrizePicks route — always available via Vite/dev server or /api/prizepicks. */
export const PRIZEPICKS_BUILTIN_ENDPOINTS = [
  `/api/prizepicks?league_id=${PRIZEPICKS_MLB_LEAGUE_ID}`,
];

/** Same-origin Underdog routes — always available via Vite/dev server. */
export const UNDERDOG_BUILTIN_ENDPOINTS = [
  "/api/underdog/beta/v5/over_under_lines",
  "/api/underdog",
];

const LEGACY_LOCAL_PRIZEPICKS_PROXY = /^https?:\/\/(localhost|127\.0\.0\.1):4000/i;

/** Validate and normalize external provider proxy URLs (PrizePicks / Underdog). */

const INVALID_PROXY_LITERALS = new Set(["undefined", "null", "none", "false", "n/a", "na"]);

export const PRIZEPICKS_PROXY_DISABLED_LOG = "PRIZEPICKS PROXY NOT CONFIGURED - DISABLING PROVIDER";
export const UNDERDOG_PROXY_DISABLED_LOG = "UNDERDOG PROXY NOT CONFIGURED - DISABLING PROVIDER";

export const PROVIDER_PROXY_FETCH_TIMEOUT_MS = 20_000;

export function normalizeProxyUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || INVALID_PROXY_LITERALS.has(trimmed.toLowerCase())) return "";
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function resolveFirstValidProxyUrl(candidates = []) {
  for (const candidate of candidates) {
    const normalized = normalizeProxyUrl(candidate);
    if (normalized) return normalized;
  }
  return "";
}

export function assessProxyUrl(rawValue = "") {
  const raw = String(rawValue ?? "").trim();
  const normalized = normalizeProxyUrl(raw);
  return {
    raw,
    normalized,
    invalid: Boolean(raw) && !normalized,
    configured: Boolean(normalized),
  };
}

/**
 * Resolve which config key is missing/invalid and what URL shape is expected.
 * Checked in order by getEffectiveSetting("VITE_PRIZEPICKS_PROXY_URL"):
 *   localStorage[VITE_PRIZEPICKS_PROXY_URL] → Vite env keys → legacy PRIZEPICKS_PROXY_URL
 */
export function inspectPrizePicksProxyConfig() {
  const def = getSettingDef(PRIZEPICKS_PROXY_SETTING_KEY);
  const keysChecked = def.envKeys || [PRIZEPICKS_PROXY_SETTING_KEY];
  const effective = getEffectiveSetting(PRIZEPICKS_PROXY_SETTING_KEY);
  const raw = getRawProxyUrl("PrizePicks");
  const normalized = getProxyUrl("prizepicks");
  const assessment = assessProxyUrl(raw);

  let missingConfiguration = "";
  if (assessment.invalid) {
    missingConfiguration = `${PRIZEPICKS_PROXY_SETTING_KEY} (value present but not a valid http(s) URL)`;
  } else if (!assessment.configured) {
    missingConfiguration = PRIZEPICKS_PROXY_SETTING_KEY;
  }

  return {
    canonicalKey: PRIZEPICKS_PROXY_SETTING_KEY,
    missingConfiguration,
    keysChecked,
    effectiveValuePresent: Boolean(String(effective || "").trim()),
    rawValuePresent: Boolean(raw),
    proxyConfigured: assessment.configured,
    normalizedProxyUrl: normalized,
    expectedFormat:
      "Optional external http(s) proxy, or leave blank to use built-in /api/prizepicks (recommended for local dev)",
    exampleProxyUrl: `/api/prizepicks?league_id=${PRIZEPICKS_MLB_LEAGUE_ID}`,
    appFetchRouteTemplate: "built-in /api/prizepicks (default) or {VITE_PRIZEPICKS_PROXY_URL}",
    builtinRoutes: [...PRIZEPICKS_BUILTIN_ENDPOINTS],
  };
}

/** Resolve PrizePicks fetch URLs — built-in route first; external proxy optional fallback. */
export function resolvePrizePicksFetchEndpoints() {
  const proxyUrl = getProxyUrl("prizepicks");
  const builtin = [...PRIZEPICKS_BUILTIN_ENDPOINTS];
  if (!proxyUrl || LEGACY_LOCAL_PRIZEPICKS_PROXY.test(proxyUrl)) {
    return builtin;
  }
  return [...builtin, proxyUrl];
}

export function hasPrizePicksFetchRoute() {
  return resolvePrizePicksFetchEndpoints().length > 0;
}

/** PrizePicks can ingest via built-in /api/prizepicks even without an external proxy URL. */
export function getPrizePicksPreflight() {
  const config = inspectPrizePicksProxyConfig();
  const endpoints = resolvePrizePicksFetchEndpoints();

  if (config.rawValuePresent && !config.proxyConfigured) {
    return {
      skip: false,
      notConfigured: false,
      useDirect: true,
      proxyUrl: "",
      config,
      endpoints,
      reason: `Invalid ${config.canonicalKey} ignored — using built-in /api/prizepicks`,
    };
  }

  if (!endpoints.length) {
    return {
      skip: true,
      notConfigured: true,
      status: "Not configured",
      reason: "No PrizePicks fetch route available",
      missingConfiguration: config.missingConfiguration,
      config,
      endpoints: [],
    };
  }

  return {
    skip: false,
    notConfigured: false,
    useDirect: !config.proxyConfigured,
    proxyUrl: config.normalizedProxyUrl || "",
    config,
    endpoints,
  };
}

/** True only when no built-in or external PrizePicks route exists. */
export function isPrizePicksProxyNotConfigured() {
  return !hasPrizePicksFetchRoute();
}

/** PrizePicks row only — do not use for Underdog (would mis-read global proxy state). */
export function isPrizePicksFeedNotConfigured(feed = {}) {
  if (/not configured/i.test(String(feed.status || feed.apiStatus || feed.statusLabel || ""))) {
    return true;
  }
  if (feed.diagnostics?.failureClass === "MISSING_PROXY") return true;
  if (/missing vite_prizepicks/i.test(String(feed.statusLabel || feed.lastError || ""))) return true;
  return isPrizePicksProxyNotConfigured();
}

export const PRIZEPICKS_NOT_CONFIGURED_DETAIL = "PrizePicks fetch route unavailable";

/** Resolve Underdog fetch URLs — built-in route first; external proxy optional fallback. */
export function resolveUnderdogFetchEndpoints() {
  const proxyUrl = getProxyUrl("underdog");
  const builtin = [...UNDERDOG_BUILTIN_ENDPOINTS];
  if (!proxyUrl) return builtin;
  return [...builtin, proxyUrl];
}

export function hasUnderdogFetchRoute() {
  return resolveUnderdogFetchEndpoints().length > 0;
}

/** Underdog: invalid URL blocks fetch; missing URL uses built-in /api routes. */
export function getUnderdogPreflight() {
  const assessment = assessProxyUrl(getRawProxyUrl("Underdog"));
  const endpoints = resolveUnderdogFetchEndpoints();

  if (assessment.invalid) {
    return {
      skip: false,
      notConfigured: false,
      useDirect: true,
      proxyUrl: "",
      endpoints,
      reason: "Invalid Underdog proxy URL ignored — using built-in /api/underdog",
    };
  }

  if (!endpoints.length) {
    return {
      skip: true,
      notConfigured: true,
      status: "Not configured",
      reason: "No Underdog fetch route available",
      endpoints: [],
    };
  }

  return {
    skip: false,
    notConfigured: false,
    useDirect: !assessment.configured,
    proxyUrl: assessment.normalized || "",
    endpoints,
  };
}

/** Underdog: invalid URL blocks fetch; missing URL uses direct /api route. */
export function getLineProviderPreflight(platform = "") {
  const key = String(platform || "").toLowerCase();
  if (key.includes("prize") || key.includes("pp")) {
    return getPrizePicksPreflight();
  }

  return getUnderdogPreflight();
}

export async function fetchWithProxyTimeout(url, init = {}, timeoutMs = PROVIDER_PROXY_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
