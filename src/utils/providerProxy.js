import { getProxyUrl, getRawProxyUrl } from "../services/runtimeSettings.js";

export { getProxyUrl, getRawProxyUrl };

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

/** PrizePicks ingestion requires a valid proxy URL — never hit /api when missing (avoids silent timeouts). */
export function getPrizePicksPreflight() {
  const envKeys = ["VITE_PRIZEPICKS_PROXY_URL", "PRIZEPICKS_PROXY_URL", "VITE_PRIZEPICKS_PROXY"];
  const assessment = assessProxyUrl(getRawProxyUrl("PrizePicks"));

  if (assessment.invalid) {
    return {
      skip: true,
      notConfigured: true,
      status: "Not configured",
      reason: `PrizePicks proxy URL is invalid. Set ${envKeys[0]} in Settings.`,
    };
  }

  if (!assessment.configured) {
    return {
      skip: true,
      notConfigured: true,
      status: "Not configured",
      reason: "PrizePicks proxy URL missing",
    };
  }

  return { skip: false, useDirect: false, proxyUrl: assessment.normalized };
}

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
