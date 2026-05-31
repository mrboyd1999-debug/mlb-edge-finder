import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { healthStateStyle } from "../services/sourceHealth.js";

function ProviderFeedModeBanner({
  audit = null,
  renderSourceAudit = null,
  loading = false,
  cacheStatus = "",
  boardCacheTimestamp = "",
}) {
  const boardIsCached = /cached|stale|expired/i.test(String(cacheStatus || ""));
  const auditSaysLive = audit?.feedMode === "LIVE";
  const liveProviderCount = Number(
    renderSourceAudit?.liveProviderCount ?? audit?.liveProviderCount ?? 0
  );
  const isLive =
    liveProviderCount > 0 || (auditSaysLive && !audit?.boardCacheActive && !boardIsCached);
  const label = isLive ? "LIVE DATA" : "CACHE DATA";
  const statusLabel = isLive ? "Live" : "Cached";

  const cacheLabel = boardCacheTimestamp ? formatDateTime(boardCacheTimestamp) : "";
  const cacheMessage = isLive
    ? "Provider feeds loaded live on last refresh."
    : cacheLabel
      ? `Running on cached board from ${cacheLabel}`
      : audit?.cacheBoardMessage || "Live provider fetch did not populate a full board — showing cached data.";

  return (
    <section
      className={`provider-feed-mode-banner provider-feed-mode-banner--${isLive ? "live" : "cache"}`}
      aria-label="Provider data mode"
    >
      <div className="provider-feed-mode-banner__head">
        <strong className="provider-feed-mode-banner__title">{loading ? "Loading feeds…" : label}</strong>
        {!loading ? <span style={healthStateStyle(isLive ? "Connected" : "Warning")}>{statusLabel}</span> : null}
      </div>
      {!loading ? <p className="provider-feed-mode-banner__detail">{cacheMessage}</p> : null}
      {!loading && !isLive && audit?.cacheFallbackStage ? (
        <p className="provider-feed-mode-banner__stage">Fallback stage: {audit.cacheFallbackStage}</p>
      ) : null}
    </section>
  );
}

export default memo(ProviderFeedModeBanner);
