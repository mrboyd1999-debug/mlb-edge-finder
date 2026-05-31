import { memo } from "react";
import { formatDataSourceLabel } from "../utils/renderDataSourceAudit.js";

function Metric({ label, value }) {
  return (
    <span className="live-board-pipeline-banner__metric">
      {label}: <strong>{value ?? 0}</strong>
    </span>
  );
}

function LiveBoardPipelineBanner({ trace = null, renderSourceAudit = null, loading = false }) {
  const liveProviderCount =
    renderSourceAudit?.liveProviderCount ?? renderSourceAudit?.providerPlays ?? trace?.provider ?? 0;
  const localStorageCount =
    renderSourceAudit?.localStorageCount ?? renderSourceAudit?.localStoragePlays ?? 0;
  const cacheCount = renderSourceAudit?.cacheCount ?? renderSourceAudit?.cachePlays ?? 0;
  const renderingSource = renderSourceAudit?.renderingSource
    ? formatDataSourceLabel(renderSourceAudit.renderingSource)
    : null;

  if (!trace && !renderSourceAudit && !loading) return null;

  const isLive = Number(liveProviderCount) > 0;

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
          {trace ? (
            <p className="provider-feed-mode-banner__detail live-board-pipeline-banner__metrics">
              <Metric label="LIVE NORMALIZED" value={trace?.normalized} />
              <Metric label="LIVE PROJECTED" value={trace?.projected} />
              <Metric label="LIVE VERIFIED" value={trace?.verified} />
              <Metric label="LIVE RENDERED" value={trace?.rendered} />
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default memo(LiveBoardPipelineBanner);
