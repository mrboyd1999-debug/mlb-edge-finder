export function cleanKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
}

function readLocalOddsKey() {
  if (typeof window === "undefined") return "";
  return cleanKey(
    window.localStorage.getItem("odds_api_key") ||
      window.localStorage.getItem("oddsApiKey") ||
      window.localStorage.getItem("VITE_ODDS_API_KEY")
  );
}

function readEnvOddsKey() {
  return cleanKey(import.meta.env.VITE_ODDS_API_KEY || import.meta.env.ODDS_API_KEY);
}

export function getOddsApiKey() {
  const local = readLocalOddsKey();
  if (local) return local;
  return readEnvOddsKey();
}

/** localStorage if stored key exists, else env, else missing */
export function getOddsApiKeySource() {
  if (readLocalOddsKey()) return "localStorage";
  if (readEnvOddsKey()) return "env";
  return "missing";
}

export function saveOddsApiKey(value) {
  const key = cleanKey(value);
  if (typeof window !== "undefined") {
    if (key) {
      window.localStorage.setItem("odds_api_key", key);
    } else {
      clearOddsApiKey();
      return "";
    }
    window.localStorage.removeItem("oddsApiKey");
    window.localStorage.removeItem("VITE_ODDS_API_KEY");
    window.localStorage.removeItem("odds-api-key");
    window.localStorage.removeItem("the-odds-api-key");
  }
  return key;
}

export function clearOddsApiKey() {
  if (typeof window === "undefined") return;
  const keys = [
    "odds_api_key",
    "oddsApiKey",
    "VITE_ODDS_API_KEY",
    "odds-api-key",
    "the-odds-api-key",
  ];
  keys.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  });
}

export function formatKeySourceLabel(source = "") {
  if (source === "localStorage") return "localStorage";
  if (source === "env") return "env";
  return "missing";
}
