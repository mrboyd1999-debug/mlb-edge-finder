import {
  getEffectiveSetting,
  getProxyUrl,
  getRawProxyUrl,
  getSettingDef,
} from "../services/runtimeSettings.js";

export { getProxyUrl, getRawProxyUrl };

/** Canonical Settings / .env key for PrizePicks external proxy URL. */
export const PRIZEPICKS_PROXY_SETTING_KEY = "VITE_PRIZEPICKS_PROXY_URL";

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
      "http(s) URL that returns PrizePicks JSON — e.g. local proxy http://localhost:4000/api/prizepicks/mlb",
    exampleProxyUrl: "http://localhost:4000/api/prizepicks/mlb",
    appFetchRouteTemplate: "{VITE_PRIZEPICKS_PROXY_URL} (direct fetch from browser)",
  };
}

/** PrizePicks ingestion requires a valid proxy URL — never hit /api when missing (avoids silent timeouts). */
export function getPrizePicksPreflight() {
  const config = inspectPrizePicksProxyConfig();

  if (config.rawValuePresent && !config.proxyConfigured) {
    return {
      skip: true,
      notConfigured: true,
      status: "Not configured",
      reason: `PrizePicks proxy URL is invalid. Set ${config.canonicalKey} in Settings.`,
      missingConfiguration: config.missingConfiguration,
      config,
    };
  }

  if (!config.proxyConfigured) {
    return {
      skip: true,
      notConfigured: true,
      status: "Not configured",
      reason: "PrizePicks proxy URL missing",
      missingConfiguration: config.missingConfiguration,
      config,
    };
  }

  return { skip: false, useDirect: false, proxyUrl: config.normalizedProxyUrl, config };
}

/** True when client will not call /api/prizepicks (optional provider). */
export function isPrizePicksProxyNotConfigured() {
  return !inspectPrizePicksProxyConfig().proxyConfigured;
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

export const PRIZEPICKS_NOT_CONFIGURED_DETAIL = `Missing ${PRIZEPICKS_PROXY_SETTING_KEY}`;

/** Underdog: invalid URL blocks fetch; missing URL uses direct /api route. */
export function getLineProviderPreflight(platform = "") {
  const key = String(platform || "").toLowerCase();
  if (key.includes("prize") || key.includes("pp")) {
    return getPrizePicksPreflight();
  }

  const envKeys = ["VITE_UNDERDOG_PROXY_URL", "UNDERDOG_PROXY_URL"];
  const label = "Underdog";
  const assessment = assessProxyUrl(getRawProxyUrl(label));

  if (assessment.invalid) {
    return {
      skip: true,
      status: "Not configured",
      reason: `${label} proxy URL is invalid. Set ${envKeys[0]} in Settings or .env.local.`,
    };
  }

  return { skip: false, useDirect: !assessment.configured, proxyUrl: assessment.normalized };
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
