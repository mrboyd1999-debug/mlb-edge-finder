/**
 * One-time startup console diagnostics for API keys and provider routes.
 */

import {
  getOddsApiKey,
  getSportsDataApiKey,
  getOddsApiKeySource,
  getSportsDataApiKeySource,
  maskApiKeyPreview,
} from "../services/runtimeSettings.js";
import {
  resolvePrizePicksFetchEndpoints,
  resolveUnderdogFetchEndpoints,
} from "./providerProxy.js";
import { getRawProxyUrl } from "../config/apiConfig.js";

export function logEnvStartupDiagnostics() {
  if (typeof window === "undefined") return;

  const ppEndpoints = resolvePrizePicksFetchEndpoints();
  const udEndpoints = resolveUnderdogFetchEndpoints();
  const ppProxy = getRawProxyUrl("PrizePicks");
  const udProxy = getRawProxyUrl("Underdog");

  console.log("[Startup] Odds key source:", getOddsApiKeySource());
  console.log("[Startup] Odds key preview:", maskApiKeyPreview(getOddsApiKey()));
  console.log("[Startup] SportsData key source:", getSportsDataApiKeySource());
  console.log("[Startup] SportsData key preview:", maskApiKeyPreview(getSportsDataApiKey()));
  console.log("[Startup] effective odds key loaded:", Boolean(getOddsApiKey()));
  console.log("[Startup] effective sportsdata key loaded:", Boolean(getSportsDataApiKey()));
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
