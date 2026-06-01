/**
 * Live feed diagnostics — true stage counts and source attribution for ingestion UI.
 */

import { resolveSettingSource } from "../services/runtimeSettings.js";
import { getDebugFeedEvidence } from "./feedHardEvidence.js";
import {
  resolvePrizePicksFetchEndpoints,
  resolveUnderdogFetchEndpoints,
} from "./providerProxy.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function resolveFeedSource({ usedCache = false, route = "", proxyUrl = "" } = {}) {
  if (usedCache) return "cache";
  if (/^\/api\//.test(String(route || ""))) return "built-in";
  if (proxyUrl) return "external-proxy";
  return "live";
}

export function buildLiveFeedDiagnosticsSummary({
  audit = null,
  pipelinePropCountAudit = null,
  debugInfo = null,
} = {}) {
  const pipeline = pipelinePropCountAudit || audit?.pipelinePropCountAudit || debugInfo?.pipelinePropCountAudit || {};
  const providerRaw = debugInfo?.pipelineProviderRaw || {};
  const evidence =
    typeof window !== "undefined" ? getDebugFeedEvidence() : { prizepicks: null, underdog: null };
  const ppEvidence = evidence?.prizepicks || {};
  const udEvidence = evidence?.underdog || {};

  const ppEndpoints = resolvePrizePicksFetchEndpoints();
  const udEndpoints = resolveUnderdogFetchEndpoints();

  return {
    lastFetchAt:
      providerRaw.lastFetchAt ||
      pipeline.updatedAt ||
      ppEvidence.updatedAt ||
      udEvidence.updatedAt ||
      audit?.lastUpdated ||
      null,
    prizePicks: {
      raw: finite(pipeline.rawPrizePicks ?? providerRaw.rawPrizePicks),
      parsed: finite(ppEvidence.counts?.parsed ?? providerRaw.prizePicksUsable),
      normalized: finite(ppEvidence.counts?.normalized),
      usable: finite(providerRaw.prizePicksUsable ?? ppEvidence.counts?.usable),
      source: resolveFeedSource({
        usedCache: Boolean(audit?.prizepicksUsedCache),
        route: ppEndpoints[0],
        proxyUrl: resolveSettingSource("VITE_PRIZEPICKS_PROXY_URL") === "env" ? "env-proxy" : "",
      }),
      oddsKeySource: resolveSettingSource("VITE_ODDS_API_KEY"),
      route: ppEndpoints[0] || null,
    },
    underdog: {
      raw: finite(pipeline.rawUnderdog ?? providerRaw.rawUnderdog),
      parsed: finite(udEvidence.counts?.parsed ?? providerRaw.underdogUsable),
      normalized: finite(udEvidence.counts?.normalized),
      usable: finite(providerRaw.underdogUsable ?? udEvidence.counts?.usable),
      source: resolveFeedSource({
        usedCache: Boolean(audit?.underdogUsedCache),
        route: udEndpoints[0],
      }),
      route: udEndpoints[0] || null,
    },
    mergedProps: finite(pipeline.combinedRaw ?? providerRaw.combinedRaw),
    projectedProps: finite(pipeline.projectedProps ?? audit?.projected),
    displayedProps: finite(pipeline.displayedProps),
    verifiedProps: finite(pipeline.verifiedProps),
    sportsDataKeySource: resolveSettingSource("VITE_SPORTSDATA_API_KEY"),
    oddsKeySource: resolveSettingSource("VITE_ODDS_API_KEY"),
  };
}
