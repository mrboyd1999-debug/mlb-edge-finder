import { memo } from "react";

function Metric({ label, value }) {
  return (
    <span className="live-board-pipeline-banner__metric">
      {label}: <strong>{value ?? 0}</strong>
    </span>
  );
}

function LiveBoardPipelineBanner({ trace = null, loading = false }) {
  if (!trace && !loading) return null;

  const isLive = Number(trace?.rendered ?? 0) > 0 && Number(trace?.provider ?? 0) > 0;

  return (
    <section
      className={`provider-feed-mode-banner live-board-pipeline-banner provider-feed-mode-banner--${isLive ? "live" : "cache"}`}
      aria-label="Live board pipeline"
    >
      <div className="provider-feed-mode-banner__head">
        <strong className="provider-feed-mode-banner__title">
          {loading ? "Loading live board…" : "Live Board Pipeline"}
        </strong>
      </div>
      {!loading ? (
        <p className="provider-feed-mode-banner__detail live-board-pipeline-banner__metrics">
          <Metric label="LIVE NORMALIZED" value={trace?.normalized} />
          <Metric label="LIVE PROJECTED" value={trace?.projected} />
          <Metric label="LIVE VERIFIED" value={trace?.verified} />
          <Metric label="LIVE RENDERED" value={trace?.rendered} />
        </p>
      ) : null}
    </section>
  );
}

export default memo(LiveBoardPipelineBanner);
