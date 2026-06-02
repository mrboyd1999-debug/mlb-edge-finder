/** Runtime API keys and proxy URLs — build-time env first, localStorage as backup override. */

import { clearSourceAuthBlock, SOURCE_IDS } from "./sourceRateLimit.js";
import { resetOddsApiStartupValidation } from "./oddsApiClient.js";
import { cleanApiKey } from "../utils/cleanApiKey.js";
import { normalizeProxyUrl } from "../utils/providerProxy.js";

/** User-facing keys shown in Settings — live feeds (PP/UD) use built-in routes, not user keys. */
export const ODDS_ENV_KEYS = [
  "VITE_ODDS_API_KEY",
  "ODDS_API_KEY",
  "THE_ODDS_API_KEY",
];
export const ODDS_STORAGE_KEYS = [
  "VITE_ODDS_API_KEY",
  "odds_api_key",
  "odds-api-key",
  "the-odds-api-key",
];
export const SPORTSDATA_ENV_KEYS = [
  "VITE_SPORTSDATAIO_API_KEY",
  "VITE_SPORTSDATA_API_KEY",
  "SPORTSDATAIO_API_KEY",
  "SPORTSDATA_API_KEY",
  "SPORTS_DATA_IO_API_KEY",
];
export const SPORTSDATA_STORAGE_KEYS = [
  "VITE_SPORTSDATAIO_API_KEY",
  "VITE_SPORTSDATA_API_KEY",
  "sportsdataio_api_key",
];

export const USER_SETTING_DEFS = [
  {
    key: "VITE_ODDS_API_KEY",
    label: "Odds API Key",
    type: "secret",
    placeholder: "Paste The Odds API key",
    envKeys: ODDS_ENV_KEYS,
    legacyStorageKeys: ["odds-api-key", "the-odds-api-key", "odds_api_key"],
  },
  {
    key: "VITE_SPORTSDATA_API_KEY",
    label: "SportsDataIO API Key",
    type: "secret",
    placeholder: "Paste your SportsDataIO MLB subscription key",
    envKeys: SPORTSDATA_ENV_KEYS,
    legacyStorageKeys: ["sportsdataio_api_key", "VITE_SPORTSDATAIO_API_KEY"],
  },
  {
    key: "VITE_PRIZEPICKS_PROXY_URL",
    label: "PrizePicks Proxy URL",
    type: "url",
    placeholder: "Leave blank to use built-in /api/prizepicks",
    envKeys: [
      "VITE_PRIZEPICKS_PROXY_URL",
      "VITE_PRIZEPICKS_PROXY",
      "PRIZEPICKS_PROXY_URL",
      "PRIZEPICKS_API_PROXY",
      "PROXY_BASE_URL",
    ],
    legacyStorageKeys: ["PRIZEPICKS_PROXY_URL"],
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
    key: "VITE_UNDERDOG_PROXY_URL",
    label: "Underdog Proxy URL",
    type: "url",
    placeholder: "Leave blank to use built-in /api/underdog",
    envKeys: ["VITE_UNDERDOG_PROXY_URL", "VITE_UNDERDOG_PROXY", "UNDERDOG_PROXY_URL"],
    legacyStorageKeys: ["UNDERDOG_PROXY_URL"],
  },
];

export const RUNTIME_SETTING_DEFS = [...USER_SETTING_DEFS, ...HIDDEN_SETTING_DEFS];

export const RUNTIME_SETTING_KEYS = RUNTIME_SETTING_DEFS.map((def) => def.key);
export const USER_SETTING_KEYS = USER_SETTING_DEFS.map((def) => def.key);

const SETTINGS_META_KEY = "dfs-runtime-settings-meta-v1";

const PLACEHOLDER_PATTERN =
  /^(your_|paste_|replace_|example_|xxx+|000+)|(_here|_key)$/i;

function isUsableEnvValue(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_PATTERN.test(trimmed)) return false;
  return true;
}

function readEnvKeys(envKeys = []) {
  for (const envKey of envKeys) {
    const value = import.meta.env?.[envKey];
    if (isUsableEnvValue(value)) return String(value).trim();
  }
  return "";
}

function readStorageKeys(keys = []) {
  for (const key of keys) {
    const value = readStorageValue(key);
    if (isUsableEnvValue(value)) return value;
  }
  return "";
}

export function maskApiKeyPreview(key = "") {
  const cleaned = cleanApiKey(key);
  if (!cleaned) return "missing";
  if (cleaned.length <= 8) return "••••••••";
  return `${cleaned.slice(0, 4)}••••${cleaned.slice(-4)}`;
}

export function getOddsApiKeySource() {
  if (readEnvKeys(ODDS_ENV_KEYS)) return "env";
  if (readStorageKeys(ODDS_STORAGE_KEYS)) return "localStorage";
  return "missing";
}

export function getSportsDataApiKeySource() {
  if (readEnvKeys(SPORTSDATA_ENV_KEYS)) return "env";
  if (readStorageKeys(SPORTSDATA_STORAGE_KEYS)) return "localStorage";
  return "missing";
}

function readEnvValue(def = {}) {
  return readEnvKeys(def.envKeys || [def.key]);
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

/** Where the effective value came from — env, localStorage, legacy, or null. */
export function resolveSettingSource(key) {
  const def = getSettingDef(key);
  if (readEnvValue(def)) return "env";
  if (readStorageValue(key)) return "localStorage";
  if (readLegacyValue(def)) return "legacy";
  return null;
}

export function formatSettingSourceLabel(source = null) {
  if (source === "env") return "env";
  if (source === "localStorage") return "localStorage";
  if (source === "legacy") return "legacy";
  if (source === "missing") return "missing";
  return "Not configured";
}

/** Effective value: build-time env first, then localStorage backup, then legacy keys. */
export function getEffectiveSetting(key) {
  const def = getSettingDef(key);
  const fromEnv = readEnvValue(def);
  if (fromEnv) return fromEnv;
  const stored = readStorageValue(key);
  if (stored) return stored;
  return readLegacyValue(def);
}

/** Settings panel + runtime snapshot — shows what the app will actually use. */
export function readRuntimeSettings() {
  return Object.fromEntries(RUNTIME_SETTING_KEYS.map((key) => [key, getEffectiveSetting(key)]));
}

export function writeRuntimeSettings(settings = {}) {
  RUNTIME_SETTING_KEYS.forEach((key) => {
    const def = getSettingDef(key);
    let value = String(settings[key] ?? "").trim();
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
          window.localStorage.setItem("odds_api_key", value);
          window.localStorage.setItem("odds-api-key", value);
          window.localStorage.setItem("the-odds-api-key", value);
        } else {
          window.localStorage.removeItem("odds_api_key");
          window.localStorage.removeItem("odds-api-key");
          window.localStorage.removeItem("the-odds-api-key");
        }
      } catch {
        // ignore
      }
      clearSourceAuthBlock(SOURCE_IDS.ODDS_API);
      resetOddsApiStartupValidation();
    }
    if (key === "VITE_SPORTSDATA_API_KEY") {
      try {
        if (value) {
          window.localStorage.setItem("sportsdataio_api_key", value);
          window.localStorage.setItem("VITE_SPORTSDATAIO_API_KEY", value);
        } else {
          window.localStorage.removeItem("sportsdataio_api_key");
          window.localStorage.removeItem("VITE_SPORTSDATAIO_API_KEY");
        }
      } catch {
        // ignore
      }
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
  if (normalized.includes("prize")) return normalizeProxyUrl(getEffectiveSetting("VITE_PRIZEPICKS_PROXY_URL"));
  if (normalized.includes("underdog")) return normalizeProxyUrl(getEffectiveSetting("VITE_UNDERDOG_PROXY_URL"));
  return "";
}

export function getRawProxyUrl(platform = "") {
  const normalized = String(platform || "").toLowerCase();
  if (normalized.includes("prize")) return String(getEffectiveSetting("VITE_PRIZEPICKS_PROXY_URL") || "").trim();
  if (normalized.includes("underdog")) return String(getEffectiveSetting("VITE_UNDERDOG_PROXY_URL") || "").trim();
  return "";
}

export function getOddsApiKey() {
  const fromEnv = cleanApiKey(readEnvKeys(ODDS_ENV_KEYS));
  if (isUsableEnvValue(fromEnv)) return fromEnv;
  const fromStorage = cleanApiKey(readStorageKeys(ODDS_STORAGE_KEYS));
  if (isUsableEnvValue(fromStorage)) return fromStorage;
  return cleanApiKey(readLegacyValue(getSettingDef("VITE_ODDS_API_KEY")));
}

export function getSportsDataApiKey() {
  const fromEnv = cleanApiKey(readEnvKeys(SPORTSDATA_ENV_KEYS));
  if (isUsableEnvValue(fromEnv)) return fromEnv;
  const fromStorage = cleanApiKey(readStorageKeys(SPORTSDATA_STORAGE_KEYS));
  if (isUsableEnvValue(fromStorage)) return fromStorage;
  return cleanApiKey(readLegacyValue(getSettingDef("VITE_SPORTSDATA_API_KEY")));
}

/** Copy env keys into localStorage when unset so Settings + health treat providers as configured. */
export function ensureEnvKeysSyncedToLocalStorage() {
  if (typeof window === "undefined") return;

  const envOdds = cleanApiKey(readEnvKeys(ODDS_ENV_KEYS));
  const envSportsData = cleanApiKey(readEnvKeys(SPORTSDATA_ENV_KEYS));

  const patch = {};
  if (isUsableEnvValue(envOdds) && !readStorageValue("VITE_ODDS_API_KEY")) {
    patch.VITE_ODDS_API_KEY = envOdds;
  }
  if (isUsableEnvValue(envSportsData) && !readStorageValue("VITE_SPORTSDATA_API_KEY")) {
    patch.VITE_SPORTSDATA_API_KEY = envSportsData;
  }

  if (Object.keys(patch).length) {
    writeRuntimeSettings({ ...readRuntimeSettings(), ...patch });
  }
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
