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

export async function fetchWithProxyTimeout(url, init = {}, timeoutMs = PROVIDER_PROXY_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
