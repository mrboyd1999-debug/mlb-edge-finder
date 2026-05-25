/** Runtime API keys and proxy URLs — env vars + localStorage (dev overrides). */

import { clearSourceAuthBlock, SOURCE_IDS } from "./sourceRateLimit.js";
import { cleanApiKey } from "../utils/cleanApiKey.js";

/** User-facing keys shown in Settings — live feeds (PP/UD) use built-in routes, not user keys. */
export const USER_SETTING_DEFS = [
  {
    key: "VITE_ODDS_API_KEY",
    label: "Odds API Key",
    type: "secret",
    placeholder: "Paste The Odds API key",
    envKeys: ["VITE_ODDS_API_KEY", "ODDS_API_KEY"],
    legacyStorageKeys: ["odds-api-key", "the-odds-api-key"],
  },
  {
    key: "VITE_SPORTSDATA_API_KEY",
    label: "SportsDataIO API Key",
    type: "secret",
    placeholder: "Paste your SportsDataIO MLB subscription key",
    envKeys: ["VITE_SPORTSDATA_API_KEY", "SPORTSDATA_API_KEY"],
    legacyStorageKeys: [],
  },
];

/** Hidden from Settings UI — still resolved from env/localStorage for ingestion/debug. */
export const HIDDEN_SETTING_DEFS = [
  {
    key: "VITE_STATMUSE_API_KEY",
    label: "StatMuse API Key",
    type: "secret",
    placeholder: "Optional — reserved for future stat enrichment",
    envKeys: ["VITE_STATMUSE_API_KEY"],
  },
  {
    key: "VITE_PRIZEPICKS_PROXY_URL",
    label: "PrizePicks Proxy URL",
    type: "url",
    placeholder: "https://your-provider.example/prizepicks",
    envKeys: ["VITE_PRIZEPICKS_PROXY_URL", "VITE_PRIZEPICKS_PROXY", "PRIZEPICKS_PROXY_URL"],
    legacyStorageKeys: ["PRIZEPICKS_PROXY_URL"],
  },
  {
    key: "VITE_UNDERDOG_PROXY_URL",
    label: "Underdog Proxy URL",
    type: "url",
    placeholder: "https://your-provider.example/underdog",
    envKeys: ["VITE_UNDERDOG_PROXY_URL", "VITE_UNDERDOG_PROXY", "UNDERDOG_PROXY_URL"],
    legacyStorageKeys: ["UNDERDOG_PROXY_URL"],
  },
];

export const RUNTIME_SETTING_DEFS = [...USER_SETTING_DEFS, ...HIDDEN_SETTING_DEFS];

export const RUNTIME_SETTING_KEYS = RUNTIME_SETTING_DEFS.map((def) => def.key);
export const USER_SETTING_KEYS = USER_SETTING_DEFS.map((def) => def.key);

const SETTINGS_META_KEY = "dfs-runtime-settings-meta-v1";

function readEnvValue(def = {}) {
  const keys = def.envKeys || [def.key];
  for (const envKey of keys) {
    const value = String(import.meta.env?.[envKey] || "").trim();
    if (value) return value;
  }
  return "";
}

function readStorageValue(key) {
  try {
    return String(window.localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function readLegacyValue(def = {}) {
  for (const legacyKey of def.legacyStorageKeys || []) {
    const value = readStorageValue(legacyKey);
    if (value) return value;
  }
  return "";
}

export function getSettingDef(key) {
  return RUNTIME_SETTING_DEFS.find((def) => def.key === key) || { key, label: key };
}

/** Effective value: localStorage override, then build-time env, then legacy keys. */
export function getEffectiveSetting(key) {
  const def = getSettingDef(key);
  const stored = readStorageValue(key);
  if (stored) return stored;
  const fromEnv = readEnvValue(def);
  if (fromEnv) return fromEnv;
  return readLegacyValue(def);
}

export function readRuntimeSettings() {
  return Object.fromEntries(
    RUNTIME_SETTING_KEYS.map((key) => {
      const def = getSettingDef(key);
      return [key, readStorageValue(key) || readEnvValue(def) || readLegacyValue(def)];
    })
  );
}

export function writeRuntimeSettings(settings = {}) {
  RUNTIME_SETTING_KEYS.forEach((key) => {
    const def = getSettingDef(key);
    let value = String(settings[key] || "").trim();
    if (key === "VITE_ODDS_API_KEY" || key === "VITE_SPORTSDATA_API_KEY") {
      value = cleanApiKey(value);
    }
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      // ignore private-mode storage errors
    }
    if (key === "VITE_ODDS_API_KEY") {
      try {
        if (value) {
          window.localStorage.setItem("odds-api-key", value);
          window.localStorage.setItem("the-odds-api-key", value);
        } else {
          window.localStorage.removeItem("odds-api-key");
          window.localStorage.removeItem("the-odds-api-key");
        }
      } catch {
        // ignore
      }
      clearSourceAuthBlock(SOURCE_IDS.ODDS_API);
    }
    if (key === "VITE_PRIZEPICKS_PROXY_URL") {
      try {
        if (value) window.localStorage.setItem("PRIZEPICKS_PROXY_URL", value);
        else window.localStorage.removeItem("PRIZEPICKS_PROXY_URL");
      } catch {
        // ignore
      }
    }
    if (key === "VITE_UNDERDOG_PROXY_URL") {
      try {
        if (value) window.localStorage.setItem("UNDERDOG_PROXY_URL", value);
        else window.localStorage.removeItem("UNDERDOG_PROXY_URL");
      } catch {
        // ignore
      }
    }
    void def;
  });

  const meta = readSettingsMeta();
  writeSettingsMeta({ ...meta, savedAt: new Date().toISOString() });
}

export function readSettingsMeta() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_META_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSettingsMeta(meta = {}) {
  try {
    window.localStorage.setItem(SETTINGS_META_KEY, JSON.stringify(meta));
  } catch {
    // ignore
  }
}

export function isSettingConfigured(key) {
  return Boolean(getEffectiveSetting(key));
}

export function getProxyUrl(platform = "") {
  const normalized = String(platform || "").toLowerCase();
  if (normalized.includes("prize")) return getEffectiveSetting("VITE_PRIZEPICKS_PROXY_URL");
  if (normalized.includes("underdog")) return getEffectiveSetting("VITE_UNDERDOG_PROXY_URL");
  return "";
}

export function getOddsApiKey() {
  return cleanApiKey(getEffectiveSetting("VITE_ODDS_API_KEY"));
}

export function getSportsDataApiKey() {
  return cleanApiKey(getEffectiveSetting("VITE_SPORTSDATA_API_KEY"));
}

export function getStatmuseApiKey() {
  return getEffectiveSetting("VITE_STATMUSE_API_KEY");
}

export function userSettingsDraftMatchesSaved(draft = {}, saved = {}) {
  return USER_SETTING_KEYS.every(
    (key) => cleanApiKey(draft[key]) === cleanApiKey(saved[key])
  );
}

export function settingsDraftMatchesSaved(draft = {}, saved = {}) {
  return userSettingsDraftMatchesSaved(draft, saved);
}
