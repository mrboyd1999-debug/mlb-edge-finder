/**
 * Live feed diagnostics — true stage counts and source attribution for ingestion UI.
 */

import {
  getOddsApiKeySource,
  getSportsDataApiKeySource,
  formatSettingSourceLabel,
  resolveSettingSource,
} from "../services/runtimeSettings.js";
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

  const ppSources = debugInfo?.sources?.PrizePicks || {};
  const udSources = debugInfo?.sources?.Underdog || {};
  const ppAudit = debugInfo?.prizePicksPipelineAudit || {};

  return {
    lastFetchAt:
      providerRaw.lastFetchAt ||
      pipeline.updatedAt ||
      ppEvidence.updatedAt ||
      udEvidence.updatedAt ||
      audit?.lastUpdated ||
      null,
    prizePicks: {
      raw: finite(
        pipeline.rawPrizePicks ??
          providerRaw.rawPrizePicks ??
          ppSources.rawPropsLoaded ??
          ppEvidence.counts?.raw
      ),
      parsed: finite(
        ppAudit.parsedCount ??
          ppSources.propsAfterParsing ??
          ppEvidence.counts?.parsed ??
          ppSources.propsAfterFilters
      ),
      normalized: finite(
        ppEvidence.counts?.normalized ??
          ppSources.usablePropsCount ??
          ppAudit.normalizedCount ??
          pipeline.normalizedPrizePicks
      ),
      usable: finite(
        providerRaw.prizePicksUsable ??
          ppSources.usablePropsCount ??
          ppEvidence.counts?.usable
      ),
      source: resolveFeedSource({
        usedCache: Boolean(audit?.prizepicksUsedCache),
        route: ppEndpoints[0],
        proxyUrl: resolveSettingSource("VITE_PRIZEPICKS_PROXY_URL") === "env" ? "env-proxy" : "",
      }),
      route: ppEndpoints[0] || null,
    },
    underdog: {
      raw: finite(
        pipeline.rawUnderdog ?? providerRaw.rawUnderdog ?? udSources.rawPropsLoaded ?? udEvidence.counts?.raw
      ),
      parsed: finite(
        udSources.propsAfterParsing ?? udEvidence.counts?.parsed ?? udSources.propsAfterFilters
      ),
      normalized: finite(
        udEvidence.counts?.normalized ?? udSources.usablePropsCount ?? pipeline.normalizedUnderdog
      ),
      usable: finite(
        providerRaw.underdogUsable ?? udSources.usablePropsCount ?? udEvidence.counts?.usable
      ),
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
    sportsDataKeySource: formatSettingSourceLabel(getSportsDataApiKeySource()),
    oddsKeySource: formatSettingSourceLabel(getOddsApiKeySource()),
  };
}
