/**
 * One-time startup console diagnostics for API keys and provider routes.
 */

import { getOddsApiKey, getSportsDataApiKey, getRawProxyUrl } from "../config/apiConfig.js";
import { resolveSettingSource } from "../services/runtimeSettings.js";
import {
  resolvePrizePicksFetchEndpoints,
  resolveUnderdogFetchEndpoints,
} from "./providerProxy.js";

function envTruthy(name) {
  return Boolean(String(import.meta.env?.[name] || "").trim());
}

function storageTruthy(key) {
  try {
    return Boolean(String(window.localStorage.getItem(key) || "").trim());
  } catch {
    return false;
  }
}

export function logEnvStartupDiagnostics() {
  if (typeof window === "undefined") return;

  const envOdds = envTruthy("VITE_ODDS_API_KEY");
  const envSportsData =
    envTruthy("VITE_SPORTSDATA_API_KEY") || envTruthy("VITE_SPORTSDATAIO_API_KEY");
  const lsOdds = storageTruthy("VITE_ODDS_API_KEY");
  const lsSportsData = storageTruthy("VITE_SPORTSDATA_API_KEY");

  const ppEndpoints = resolvePrizePicksFetchEndpoints();
  const udEndpoints = resolveUnderdogFetchEndpoints();
  const ppProxy = getRawProxyUrl("PrizePicks");
  const udProxy = getRawProxyUrl("Underdog");

  console.log("[Startup] env odds key loaded:", envOdds);
  console.log("[Startup] env sportsdata key loaded:", envSportsData);
  console.log("[Startup] localStorage odds key loaded:", lsOdds);
  console.log("[Startup] localStorage sportsdata key loaded:", lsSportsData);
  console.log("[Startup] effective odds key loaded:", Boolean(getOddsApiKey()));
  console.log("[Startup] effective sportsdata key loaded:", Boolean(getSportsDataApiKey()));
  console.log("[Startup] odds key source:", resolveSettingSource("VITE_ODDS_API_KEY") || "none");
  console.log(
    "[Startup] sportsdata key source:",
    resolveSettingSource("VITE_SPORTSDATA_API_KEY") || "none"
  );
  console.log("[Startup] active PrizePicks URL:", ppEndpoints[0] || "none");
  console.log("[Startup] active Underdog URL:", udEndpoints[0] || "none");
  console.log(
    "[Startup] PrizePicks route mode:",
    ppProxy ? `builtin + external (${ppProxy})` : "built-in /api/prizepicks"
  );
  console.log(
    "[Startup] Underdog route mode:",
    udProxy ? `builtin + external (${udProxy})` : "built-in /api/underdog"
  );
}
