/**
 * Centralized API configuration loader.
 *
 * This is a thin wrapper over `runtimeSettings.js` so every piece of code that
 * needs an API key or proxy URL has a single import surface. The actual
 * resolution order is preserved:
 *   1. `localStorage` (runtime override from the Settings panel)
 *   2. Vite build-time env (`import.meta.env.VITE_*`)
 *   3. Legacy storage keys
 *
 * Required environment variables:
 *   VITE_ODDS_API_KEY
 *   VITE_SPORTSDATA_API_KEY
 *   VITE_PRIZEPICKS_PROXY (aliased to VITE_PRIZEPICKS_PROXY_URL)
 *   VITE_UNDERDOG_PROXY   (aliased to VITE_UNDERDOG_PROXY_URL)
 *
 * Missing keys never crash the app — `validateApiConfig()` returns warnings the
 * frontend can surface.
 */

import {
  RUNTIME_SETTING_DEFS,
  getEffectiveSetting,
  getOddsApiKey,
  getProxyUrl,
  getSportsDataApiKey,
  getStatmuseApiKey,
  isSettingConfigured,
} from "../services/runtimeSettings.js";

/** Symbolic identifiers used across the app. */
export const API_KEYS = {
  ODDS: "VITE_ODDS_API_KEY",
  SPORTSDATA: "VITE_SPORTSDATA_API_KEY",
  STATMUSE: "VITE_STATMUSE_API_KEY",
  PRIZEPICKS_PROXY: "VITE_PRIZEPICKS_PROXY_URL",
  UNDERDOG_PROXY: "VITE_UNDERDOG_PROXY_URL",
};

/** Re-exported runtime getters — single import surface for consumers. */
export {
  getEffectiveSetting,
  getOddsApiKey,
  getProxyUrl,
  getSportsDataApiKey,
  getStatmuseApiKey,
  isSettingConfigured,
  RUNTIME_SETTING_DEFS,
};

/**
 * Snapshot used by Settings panel + API Health to render configuration status.
 * Each entry: { key, label, configured, source: "override"|"env"|"legacy"|null }
 */
export function describeApiConfig() {
  return RUNTIME_SETTING_DEFS.map((def) => {
    const value = getEffectiveSetting(def.key);
    const configured = Boolean(value);
    return {
      key: def.key,
      label: def.label,
      type: def.type,
      configured,
      missing: !configured,
      placeholder: def.placeholder || "",
    };
  });
}

/**
 * Validation result — returns `{ ok, warnings, missing }`.
 * Critical = Odds API key, since without it we cannot do sportsbook comparison.
 * Optional = SportsData/StatMuse/proxies; warnings only.
 */
export function validateApiConfig() {
  const warnings = [];
  const missing = [];

  RUNTIME_SETTING_DEFS.forEach((def) => {
    if (isSettingConfigured(def.key)) return;
    missing.push(def.key);
    if (def.key === API_KEYS.ODDS) {
      warnings.push(`${def.label} missing — sportsbook comparison + edge scoring disabled.`);
    } else if (def.key === API_KEYS.SPORTSDATA) {
      warnings.push(`${def.label} missing — player stat enrichment may be limited.`);
    } else if (def.key === API_KEYS.PRIZEPICKS_PROXY) {
      warnings.push(`${def.label} missing — using built-in /api/prizepicks route.`);
    } else if (def.key === API_KEYS.UNDERDOG_PROXY) {
      warnings.push(`${def.label} missing — using built-in /api/underdog route.`);
    }
  });

  return {
    ok: !missing.includes(API_KEYS.ODDS),
    warnings,
    missing,
  };
}

/** Helper for runtime UI banners — never throws when storage is unavailable. */
export function getApiConfigStatusLabel() {
  const { ok, missing } = validateApiConfig();
  if (ok && missing.length === 0) return "All API keys configured";
  if (ok) return `${missing.length} optional key${missing.length === 1 ? "" : "s"} missing`;
  return "Odds API key missing — sportsbook edge disabled";
}
