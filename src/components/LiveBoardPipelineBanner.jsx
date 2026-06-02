import { memo } from "react";
import { formatDataSourceLabel } from "../utils/renderDataSourceAudit.js";

function Metric({ label, value }) {
  return (
    <span className="live-board-pipeline-banner__metric">
      {label}: <strong>{value ?? 0}</strong>
    </span>
  );
}

function LiveBoardPipelineBanner({
  trace = null,
  renderSourceAudit = null,
  boardFreshness = null,
  loading = false,
  onClearCacheAndReload = null,
}) {
  const freshness = boardFreshness || renderSourceAudit?.boardFreshness || null;
  const liveProviderCount =
    freshness?.liveProviderCount ??
    renderSourceAudit?.liveProviderCount ??
    renderSourceAudit?.providerPlays ??
    trace?.provider ??
    0;
  const localStorageCount =
    renderSourceAudit?.localStorageCount ?? renderSourceAudit?.localStoragePlays ?? 0;
  const cacheCount = renderSourceAudit?.cacheCount ?? renderSourceAudit?.cachePlays ?? 0;
  const renderingSource = renderSourceAudit?.renderingSource
    ? formatDataSourceLabel(renderSourceAudit.renderingSource)
    : null;

  if (!trace && !renderSourceAudit && !freshness && !loading) return null;

  const isLive = Boolean(freshness?.liveEligible);

  return (
    <section
      className={`provider-feed-mode-banner live-board-pipeline-banner provider-feed-mode-banner--${isLive ? "live" : "cache"}`}
      aria-label="Live board pipeline"
    >
      <div className="provider-feed-mode-banner__head">
        <strong className="provider-feed-mode-banner__title">
          {loading ? "Loading live board…" : "Board Source Diagnostics"}
        </strong>
        {!loading && renderingSource ? (
          <span className="live-board-pipeline-banner__source">{renderingSource}</span>
        ) : null}
      </div>
      {!loading ? (
        <>
          <p className="provider-feed-mode-banner__detail live-board-pipeline-banner__metrics">
            <Metric label="LIVE_PROVIDER_COUNT" value={liveProviderCount} />
            <Metric label="LOCAL_STORAGE_COUNT" value={localStorageCount} />
            <Metric label="CACHE_COUNT" value={cacheCount} />
          </p>
          {freshness ? (
            <p className="provider-feed-mode-banner__detail live-board-pipeline-banner__metrics">
              <Metric label="currentFetchTime" value={freshness.currentFetchTime || "—"} />
              <Metric label="boardUpdatedAt" value={freshness.boardUpdatedAt || "—"} />
              <Metric label="boardAgeMinutes" value={freshness.boardAgeMinutes ?? "—"} />
              <Metric label="cacheUsed" value={String(freshness.cacheUsed)} />
              <Metric label="stale" value={String(freshness.stale)} />
            </p>
          ) : null}
          {trace ? (
            <p className="provider-feed-mode-banner__detail live-board-pipeline-banner__metrics">
              <Metric label="LIVE_RAW" value={trace?.raw} />
              <Metric label="LIVE_NORMALIZED" value={trace?.normalized} />
              <Metric label="LIVE_PROJECTED" value={trace?.projected} />
              <Metric label="LIVE_VERIFIED" value={trace?.verified} />
              <Metric label="LIVE_RENDERED" value={trace?.rendered} />
              <Metric label="CACHE_USED" value={String(trace?.cacheUsed ?? freshness?.cacheUsed ?? false)} />
            </p>
          ) : null}
          {onClearCacheAndReload ? (
            <p className="provider-feed-mode-banner__detail">
              <button type="button" className="compact-form-button" onClick={onClearCacheAndReload}>
                Clear Cache + Reload Live
              </button>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default memo(LiveBoardPipelineBanner);
