/**
 * Centralized API configuration loader.
 *
 * Resolution order (see runtimeSettings.js):
 *   1. Vite build-time env (`import.meta.env.VITE_*`)
 *   2. `localStorage` (Settings panel backup / override when env blank)
 *   3. Legacy storage keys
 *
 * Required environment variables:
 *   VITE_ODDS_API_KEY
 *   VITE_SPORTSDATA_API_KEY or VITE_SPORTSDATAIO_API_KEY
 *   VITE_PRIZEPICKS_PROXY_URL (optional — blank uses /api/prizepicks)
 *   VITE_UNDERDOG_PROXY_URL (optional — blank uses /api/underdog)
 */

import {
  RUNTIME_SETTING_DEFS,
  USER_SETTING_DEFS,
  getEffectiveSetting,
  getOddsApiKey,
  getProxyUrl,
  getRawProxyUrl,
  getSportsDataApiKey,
  getStatmuseApiKey,
  isSettingConfigured,
  resolveSettingSource,
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
  getRawProxyUrl,
  getSportsDataApiKey,
  getStatmuseApiKey,
  isSettingConfigured,
  resolveSettingSource,
  RUNTIME_SETTING_DEFS,
  USER_SETTING_DEFS,
};

/**
 * Snapshot used by Settings panel + API Health to render configuration status.
 * Each entry: { key, label, configured, source: "override"|"env"|"legacy"|null }
 */
export function describeApiConfig() {
  return USER_SETTING_DEFS.map((def) => {
    const value = getEffectiveSetting(def.key);
    const configured = Boolean(value);
    const source = resolveSettingSource(def.key);
    return {
      key: def.key,
      label: def.label,
      type: def.type,
      configured,
      missing: !configured,
      source,
      placeholder: def.placeholder || "",
    };
  });
}

/**
 * Validation result — returns `{ ok, warnings, missing }`.
 * Only user-facing keys are surfaced; hidden proxy/StatMuse keys are ignored.
 */
export function validateApiConfig() {
  const warnings = [];
  const missing = [];

  USER_SETTING_DEFS.forEach((def) => {
    if (isSettingConfigured(def.key)) return;
    missing.push(def.key);
    if (def.key === API_KEYS.ODDS) {
      warnings.push(`${def.label} missing — sportsbook comparison + edge scoring disabled.`);
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
