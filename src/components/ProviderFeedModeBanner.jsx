import { memo } from "react";
import {
  getApiHealthStatus,
  apiStatusStyle,
  API_STATUS_COLOR,
} from "../utils/apiHealth.js";
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
  loading = false,
}) {
  const health = getApiHealthStatus({
    apiHealth,
    connectionReport,
    mlbPipelineStatus,
    pipelineProjectionStats,
    pipelinePropCountAudit,
    feedHealthContext,
    debugSources,
  });

  const liveAvailable =
    health.overall.color === API_STATUS_COLOR.GREEN ||
    Number(renderSourceAudit?.liveProviderCount ?? audit?.liveProviderCount ?? 0) > 0;

  const headline = loading ? "Loading feeds…" : health.overall.status;
  const headlineStyle = loading
    ? apiStatusStyle(API_STATUS_COLOR.YELLOW)
    : apiStatusStyle(health.overall.color);

  return (
    <section
      className={`provider-feed-mode-banner provider-feed-mode-banner--${liveAvailable && !loading ? "live" : "cache"}`}
      aria-label="Provider data mode"
    >
      <div className="provider-feed-mode-banner__head">
        <strong className="provider-feed-mode-banner__title">{headline}</strong>
        {!loading ? <span style={headlineStyle}>{liveAvailable ? "Live Data Available" : "Limited"}</span> : null}
      </div>
      {!loading ? (
        <>
          <p className="provider-feed-mode-banner__stats">
            Stats Verification: <strong>{health.statsVerification.status}</strong>
          </p>
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
        </>
      ) : null}
    </section>
  );
}

export default memo(ProviderFeedModeBanner);
