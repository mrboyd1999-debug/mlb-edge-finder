import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { getDebugFeedEvidence } from "../utils/feedHardEvidence.js";
import { resolvePrizePicksPropCounts, resolveUnderdogPropCounts } from "../utils/providerStatus.js";
import {
  getMergedProviderPropCount,
  getPrizePicksUsableCount,
  getUnderdogUsableCount,
  resolvePrizePicksConnectionStatus,
  resolveUnderdogConnectionStatus,
} from "../utils/providerCounts.js";
import { buildLiveFeedDiagnosticsSummary } from "../utils/liveFeedDiagnostics.js";

function formatCacheAgeHours(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${(ms / 3_600_000).toFixed(2)} hr`;
}

function LivePropIngestionCountsPanel({ audit = null, liveFeedDiagnostics = null }) {
  const live = liveFeedDiagnostics || audit?.liveFeedDiagnostics;
  const pipeline = audit?.pipelinePropCountAudit || {};
  const evidence = typeof window !== "undefined" ? getDebugFeedEvidence() : { prizepicks: null, underdog: null };
  const ppEvidence = evidence?.prizepicks || {};
  const udEvidence = evidence?.underdog || {};
  const ppLive = live?.prizepicks || {};
  const udLive = live?.underdog || {};

  const ppCounts =
    audit?.prizepicksPropCounts ||
    resolvePrizePicksPropCounts({
      feed: ppLive,
      pipelinePropCountAudit: pipeline,
      debugSources: audit?.debugSources,
      prizePicksProps: null,
      debugInfo: audit?.debugInfo,
    });
  const udCounts =
    audit?.underdogPropCounts ||
    resolveUnderdogPropCounts({
      feed: udLive,
      pipelinePropCountAudit: pipeline,
      debugSources: audit?.debugSources,
      underdogProps: null,
      debugInfo: audit?.debugInfo,
    });

  const countSource = {
    audit,
    ppCounts,
    udCounts,
    pipelinePropCountAudit: pipeline,
    evidence: ppEvidence,
    ppEvidence,
    udEvidence,
    liveRow: ppLive,
    ppLive,
    udLive,
    feed: ppLive,
    usedCache: audit?.prizepicksUsedCache,
  };

  const underdogSource = {
    ...countSource,
    evidence: udEvidence,
    liveRow: udLive,
    feed: udLive,
    usedCache: audit?.underdogUsedCache,
  };

  const prizePicksUsable = getPrizePicksUsableCount(countSource);
  const underdogUsable = getUnderdogUsableCount(underdogSource);
  const mergedProps = getMergedProviderPropCount({
    audit,
    pipelinePropCountAudit: pipeline,
    ppCounts,
    udCounts,
    evidence: ppEvidence,
    udEvidence,
    ppLive,
    udLive,
  });

  const ppLiveStatus = resolvePrizePicksConnectionStatus({
    ...countSource,
    usedCache: audit?.prizepicksUsedCache,
  });
  const udLiveStatus = resolveUnderdogConnectionStatus({
    ...underdogSource,
    usedCache: audit?.underdogUsedCache,
  });

  const underdogCacheOnly = Boolean(
    audit?.underdogUsedCache && !audit?.underdogTimedOut && underdogUsable > 0
  );
  const boardCacheAgeHours =
    audit?.boardCacheTimestamp && audit?.boardCacheActive
      ? formatCacheAgeHours(Date.now() - new Date(audit.boardCacheTimestamp).getTime())
      : null;

  const feedDiagnostics = buildLiveFeedDiagnosticsSummary({
    audit,
    pipelinePropCountAudit: pipeline,
    debugInfo: audit?.debugInfo,
  });

  return (
    <section className="live-prop-ingestion-counts" aria-label="Live prop ingestion counts">
      <div className="live-prop-ingestion-counts__head">
        <strong>Live Prop Ingestion Counts</strong>
        {audit?.ingestionFallback ? (
          <span className="live-prop-ingestion-counts__mode">Pipeline: {audit.ingestionFallback}</span>
        ) : null}
      </div>

      {ppLiveStatus.failed && prizePicksUsable === 0 ? (
        <p className="live-feed-diagnostics__warn" role="alert">
          PrizePicks LIVE FEED FAILED ({ppLiveStatus.reason})
        </p>
      ) : prizePicksUsable > 0 ? (
        <p className="live-feed-diagnostics__ok" role="status">
          PrizePicks Live {ppLiveStatus.status} — {ppLiveStatus.detail}
          {ppLiveStatus.note ? ` (${ppLiveStatus.note})` : ""}
        </p>
      ) : null}
      {udLiveStatus.failed ? null : underdogUsable > 0 ? (
        <p className="live-feed-diagnostics__ok" role="status">
          Underdog {udLiveStatus.status} — {udLiveStatus.detail}
        </p>
      ) : null}

      <div className="live-prop-ingestion-counts__grid">
        <div className="live-prop-ingestion-counts__metric">
          <span>PrizePicks Props</span>
          <strong>{prizePicksUsable}</strong>
        </div>
        <div className="live-prop-ingestion-counts__metric">
          <span>Underdog Props</span>
          <strong>{underdogUsable}</strong>
        </div>
        <div className="live-prop-ingestion-counts__metric">
          <span>Merged Props</span>
          <strong>{mergedProps}</strong>
        </div>
      </div>

      <div className="live-prop-ingestion-counts__pipeline">
        <p className="live-prop-ingestion-counts__line">
          rawPrizePicksProps: {ppCounts.rawPrizePicksProps ?? ppEvidence?.counts?.raw ?? 0} ·
          normalizedPrizePicksProps: {ppCounts.normalizedPrizePicksProps ?? ppEvidence?.counts?.normalized ?? ppLive?.normalized ?? 0} ·
          rawUnderdogProps: {udCounts.rawUnderdogProps ?? udEvidence?.counts?.raw ?? 0} ·
          normalizedUnderdogProps: {udCounts.normalizedUnderdogProps ?? udEvidence?.counts?.normalized ?? udLive?.normalized ?? 0}
        </p>
        <p className="live-prop-ingestion-counts__line">
          mergedProps: {mergedProps} · projectedProps: {pipeline.projectedProps ?? audit?.projected ?? 0} · verifiedProps:{" "}
          {pipeline.verifiedProps ?? audit?.verified ?? 0} · displayedProps: {pipeline.displayedProps ?? 0}
        </p>
        <p className="live-prop-ingestion-counts__line">
          PP raw/parsed/normalized/usable: {feedDiagnostics.prizePicks.raw}/{feedDiagnostics.prizePicks.parsed}/
          {feedDiagnostics.prizePicks.normalized}/{feedDiagnostics.prizePicks.usable} · source:{" "}
          {feedDiagnostics.prizePicks.source} · route: {feedDiagnostics.prizePicks.route || "—"}
        </p>
        <p className="live-prop-ingestion-counts__line">
          UD raw/parsed/normalized/usable: {feedDiagnostics.underdog.raw}/{feedDiagnostics.underdog.parsed}/
          {feedDiagnostics.underdog.normalized}/{feedDiagnostics.underdog.usable} · source:{" "}
          {feedDiagnostics.underdog.source} · route: {feedDiagnostics.underdog.route || "—"}
        </p>
        <p className="live-prop-ingestion-counts__line">
          last fetch: {feedDiagnostics.lastFetchAt ? formatDateTime(feedDiagnostics.lastFetchAt) : "—"} · odds key:{" "}
          {feedDiagnostics.oddsKeySource || "none"} · sportsdata key: {feedDiagnostics.sportsDataKeySource || "none"}
        </p>
      </div>

      <div className="live-prop-ingestion-counts__providers">
        <p className="live-prop-ingestion-counts__line">
          <strong>PrizePicks</strong> — endpoint: {ppEvidence?.url || ppLive?.endpoint || "—"} · HTTP{" "}
          {ppEvidence?.httpStatus ?? ppLive?.httpStatus ?? "—"} · raw{" "}
          {ppCounts.rawPrizePicksProps ?? ppEvidence?.counts?.raw ?? ppLive?.fetched ?? 0} · parsed{" "}
          {ppCounts.parsedPrizePicksProps ?? ppEvidence?.counts?.parsed ?? ppLive?.parsed ?? prizePicksUsable} · last fetch:{" "}
          {ppEvidence?.updatedAt ? formatDateTime(ppEvidence.updatedAt) : "—"} · cache age: live fetch
        </p>
        <p className="live-prop-ingestion-counts__line">
          <strong>Underdog</strong> — endpoint: {udEvidence?.url || udLive?.endpoint || "—"} · HTTP{" "}
          {udEvidence?.httpStatus ?? udLive?.httpStatus ?? "—"} · parsed {underdogUsable} · usable {underdogUsable} · last fetch:{" "}
          {udEvidence?.updatedAt ? formatDateTime(udEvidence.updatedAt) : "—"} · cache age:{" "}
          {underdogCacheOnly
            ? formatCacheAgeHours(
                audit?.boardCacheTimestamp ? Date.now() - new Date(audit.boardCacheTimestamp).getTime() : null
              )
            : "live fetch"}
        </p>
        {audit?.boardCacheActive && audit?.feedMode !== "LIVE" && boardCacheAgeHours ? (
          <p className="live-feed-diagnostics__warn" role="status">
            Board running on cached data ({boardCacheAgeHours} old) — live provider props may not be merged into the
            displayed board.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default memo(LivePropIngestionCountsPanel);
