const LEGACY_ODDS_STORAGE_KEYS = ["oddsApiKey", "VITE_ODDS_API_KEY", "ODDS_API_KEY", "odds-api-key", "the-odds-api-key"];

const PLACEHOLDER_PATTERN =
  /^(your_|paste_|replace_|example_|test_|xxx+|000+)|(_here|_key)$/i;

export function cleanOddsKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s/g, "");
}

function isUsableOddsKey(value = "") {
  const cleaned = cleanOddsKey(value);
  if (!cleaned) return false;
  if (PLACEHOLDER_PATTERN.test(cleaned)) return false;
  return true;
}

function readLocalOddsKeyOnly() {
  if (typeof window === "undefined") return "";
  return isUsableOddsKey(window.localStorage.getItem("odds_api_key")) ? cleanOddsKey(window.localStorage.getItem("odds_api_key")) : "";
}

function readEnvOddsKeyOnly() {
  return isUsableOddsKey(import.meta.env.VITE_ODDS_API_KEY) ? cleanOddsKey(import.meta.env.VITE_ODDS_API_KEY) : "";
}

/** Priority: localStorage odds_api_key only, then Vite env. Never reads legacy keys. */
export function getOddsKey() {
  const local = readLocalOddsKeyOnly();
  const env = readEnvOddsKeyOnly();
  return local || env || "";
}

export function getOddsKeySource() {
  if (readLocalOddsKeyOnly()) return "localStorage";
  if (readEnvOddsKeyOnly()) return "env";
  return "missing";
}

export function getOddsKeyDebugMeta() {
  const key = getOddsKey();
  return {
    source: getOddsKeySource(),
    keyPresent: Boolean(key),
    keyLength: key.length,
    first4: key.slice(0, 4),
    last4: key.slice(-4),
  };
}

export function purgeLegacyOddsStorageKeys() {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_ODDS_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  try {
    window.localStorage.removeItem("VITE_ODDS_API_KEY");
  } catch {
    // ignore
  }
}

export function saveOddsKey(value) {
  if (typeof window === "undefined") return "";
  const clean = cleanOddsKey(value);
  purgeLegacyOddsStorageKeys();
  if (clean) {
    window.localStorage.setItem("odds_api_key", clean);
  } else {
    window.localStorage.removeItem("odds_api_key");
  }
  return clean;
}

export function resetOddsKey() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("odds_api_key");
  purgeLegacyOddsStorageKeys();
}

/** Back-compat aliases */
export const getOddsApiKey = getOddsKey;
export const saveOddsApiKey = saveOddsKey;
export const clearOddsApiKey = resetOddsKey;
export const getOddsApiKeySource = getOddsKeySource;
