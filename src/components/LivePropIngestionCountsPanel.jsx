import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { getDebugFeedEvidence } from "../utils/feedHardEvidence.js";
import {
  resolvePrizePicksPropCounts,
  resolveUnderdogPropCounts,
  resolvePrizePicksUsableCount,
  resolveUnderdogUsableCount,
  resolvePrizePicksLiveFeedStatus,
  resolveUnderdogLiveFeedStatus,
} from "../utils/providerStatus.js";

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

  const prizePicksProps = Number(
    resolvePrizePicksUsableCount(ppCounts, audit?.prizepicksParsed ?? audit?.prizepicksUsable ?? 0)
  );
  const underdogProps = Number(
    resolveUnderdogUsableCount(udCounts, audit?.underdogUsable ?? audit?.underdogParsed ?? 0)
  );
  const mergedProps = Number(
    pipeline.combinedRaw ??
      audit?.combinedUsable ??
      audit?.combinedProps ??
      prizePicksProps + underdogProps
  );

  const ppLiveStatus = resolvePrizePicksLiveFeedStatus(ppCounts, {
    evidence: ppEvidence,
    liveRow: ppLive,
    audit,
    usedCache: audit?.prizepicksUsedCache,
  });
  const udLiveStatus = resolveUnderdogLiveFeedStatus(udCounts, {
    audit,
    usedCache: audit?.underdogUsedCache,
  });
  const underdogCacheOnly = Boolean(
    audit?.underdogUsedCache && !audit?.underdogTimedOut && underdogProps > 0
  );
  const boardCacheAgeHours =
    audit?.boardCacheTimestamp && audit?.boardCacheActive
      ? formatCacheAgeHours(Date.now() - new Date(audit.boardCacheTimestamp).getTime())
      : null;

  return (
    <section className="live-prop-ingestion-counts" aria-label="Live prop ingestion counts">
      <div className="live-prop-ingestion-counts__head">
        <strong>Live Prop Ingestion Counts</strong>
        {audit?.ingestionFallback ? (
          <span className="live-prop-ingestion-counts__mode">Pipeline: {audit.ingestionFallback}</span>
        ) : null}
      </div>

      {ppLiveStatus.failed ? (
        <p className="live-feed-diagnostics__warn" role="alert">
          PrizePicks LIVE FEED FAILED ({ppLiveStatus.reason})
        </p>
      ) : ppLiveStatus.usable > 0 ? (
        <p className="live-feed-diagnostics__ok" role="status">
          PrizePicks Live {ppLiveStatus.status} — {ppLiveStatus.detail}
        </p>
      ) : null}
      {!udLiveStatus.failed && udLiveStatus.usable > 0 ? (
        <p className="live-feed-diagnostics__ok" role="status">
          Underdog Live {udLiveStatus.status} — {udLiveStatus.detail}
        </p>
      ) : null}

      <div className="live-prop-ingestion-counts__grid">
        <div className="live-prop-ingestion-counts__metric">
          <span>PrizePicks Props</span>
          <strong>{prizePicksProps}</strong>
        </div>
        <div className="live-prop-ingestion-counts__metric">
          <span>Underdog Props</span>
          <strong>{underdogProps}</strong>
        </div>
        <div className="live-prop-ingestion-counts__metric">
          <span>Merged Props</span>
          <strong>{mergedProps}</strong>
        </div>
      </div>

      <div className="live-prop-ingestion-counts__pipeline">
        <p className="live-prop-ingestion-counts__line">
          rawPrizePicksProps: {ppCounts.rawPrizePicksProps ?? 0} ·
          normalizedPrizePicksProps: {ppCounts.normalizedPrizePicksProps ?? ppEvidence?.counts?.normalized ?? ppLive?.normalized ?? 0} ·
          rawUnderdogProps: {udCounts.rawUnderdogProps ?? 0} ·
          normalizedUnderdogProps: {udCounts.normalizedUnderdogProps ?? udEvidence?.counts?.normalized ?? udLive?.normalized ?? 0}
        </p>
        <p className="live-prop-ingestion-counts__line">
          mergedProps: {mergedProps} · projectedProps: {pipeline.projectedProps ?? audit?.projected ?? 0} · verifiedProps:{" "}
          {pipeline.verifiedProps ?? audit?.verified ?? 0} · displayedProps: {pipeline.displayedProps ?? 0}
        </p>
      </div>

      <div className="live-prop-ingestion-counts__providers">
        <p className="live-prop-ingestion-counts__line">
          <strong>PrizePicks</strong> — endpoint: {ppEvidence?.url || ppLive?.endpoint || "—"} · HTTP{" "}
          {ppEvidence?.httpStatus ?? ppLive?.httpStatus ?? "—"} · raw{" "}
          {ppCounts.rawPrizePicksProps ?? ppEvidence?.counts?.raw ?? ppLive?.fetched ?? 0} · parsed{" "}
          {ppCounts.parsedPrizePicksProps ?? ppEvidence?.counts?.parsed ?? ppLive?.parsed ?? 0} · last fetch:{" "}
          {ppEvidence?.updatedAt ? formatDateTime(ppEvidence.updatedAt) : "—"} · cache age: live fetch
        </p>
        <p className="live-prop-ingestion-counts__line">
          <strong>Underdog</strong> — endpoint: {udEvidence?.url || udLive?.endpoint || "—"} · HTTP{" "}
          {udEvidence?.httpStatus ?? udLive?.httpStatus ?? "—"} · parsed {underdogProps} · usable{" "}
          {udCounts.usableUnderdogProps ?? underdogProps} · last fetch:{" "}
          {udEvidence?.updatedAt ? formatDateTime(udEvidence.updatedAt) : "—"} · cache age:{" "}
          {underdogCacheOnly
            ? formatCacheAgeHours(
                audit?.boardCacheTimestamp ? Date.now() - new Date(audit.boardCacheTimestamp).getTime() : null
              )
            : "live fetch"}
        </p>
        {audit?.boardCacheActive && boardCacheAgeHours ? (
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
