import { memo } from "react";
import {
  getApiHealthStatus,
  apiStatusStyle,
  API_STATUS_COLOR,
} from "../utils/apiHealth.js";
import {
  resolveLiveFeedHeadline,
  STALE_DATA_HEADLINE,
  CACHE_DATA_HEADLINE,
  LIVE_DATA_HEADLINE,
} from "../utils/boardFreshness.js";
import ApiStatusPanel from "./ApiStatusPanel.jsx";

function ProviderFeedModeBanner({
  apiHealth = {},
  connectionReport = null,
  audit = null,
  renderSourceAudit = null,
  mlbPipelineStatus = null,
  pipelineProjectionStats = null,
  pipelinePropCountAudit = null,
  feedHealthContext = null,
  debugSources = null,
  boardFreshness = null,
  loading = false,
  showProviderDetails = false,
  projectionSourceCounts = null,
}) {
  const health = getApiHealthStatus({
    apiHealth,
    connectionReport,
    mlbPipelineStatus,
    pipelineProjectionStats,
    pipelinePropCountAudit,
    feedHealthContext,
    debugSources,
    boardFreshness,
  });

  const freshness =
    boardFreshness ||
    renderSourceAudit?.boardFreshness ||
    audit?.boardFreshness ||
    null;

  const usingLiveBoard = Boolean(freshness?.liveEligible) && !freshness?.cacheUsed && !freshness?.stale;

  const headline = resolveLiveFeedHeadline({
    loading,
    boardFreshness: freshness,
    apiHealthHeadline: health.overall.status,
  });

  const headlineStyle = loading
    ? apiStatusStyle(API_STATUS_COLOR.YELLOW)
    : freshness?.stale && !usingLiveBoard
      ? apiStatusStyle(API_STATUS_COLOR.YELLOW)
      : usingLiveBoard
        ? apiStatusStyle(API_STATUS_COLOR.GREEN)
        : apiStatusStyle(health.overall.color);

  const modeLabel = loading
    ? "Loading…"
    : usingLiveBoard
      ? LIVE_DATA_HEADLINE
      : freshness?.stale
        ? STALE_DATA_HEADLINE
        : freshness?.cacheUsed
          ? CACHE_DATA_HEADLINE
          : "Limited";

  return (
    <section
      className={`provider-feed-mode-banner provider-feed-mode-banner--${usingLiveBoard && !loading ? "live" : "cache"}`}
      aria-label="Provider data mode"
    >
      <div className="provider-feed-mode-banner__head">
        <strong className="provider-feed-mode-banner__title">{headline}</strong>
        {!loading ? <span style={headlineStyle}>{modeLabel}</span> : null}
      </div>
      {!loading && showProviderDetails ? (
        <p className="provider-feed-mode-banner__stats">
          Stats Verification: <strong>{health.statsVerification.status}</strong>
        </p>
      ) : null}
      {!loading ? (
        <>
          {projectionSourceCounts ? (
            <p className="provider-feed-mode-banner__stats">
              Projections — verified {projectionSourceCounts.sportsdataio || 0} · generated{" "}
              {projectionSourceCounts.generated || 0} · fallback {projectionSourceCounts.fallback || 0}
              {projectionSourceCounts.mlbstats ? ` · MLB Stats ${projectionSourceCounts.mlbstats}` : ""}
            </p>
          ) : null}
          {showProviderDetails ? (
            <ApiStatusPanel
              apiHealth={apiHealth}
              connectionReport={connectionReport}
              mlbPipelineStatus={mlbPipelineStatus}
              pipelineProjectionStats={pipelineProjectionStats}
              pipelinePropCountAudit={pipelinePropCountAudit}
              feedHealthContext={feedHealthContext}
              debugSources={debugSources}
              className="provider-feed-mode-banner__providers api-status-panel"
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default memo(ProviderFeedModeBanner);
