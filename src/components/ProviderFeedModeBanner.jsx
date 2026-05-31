import { memo } from "react";
import {
  getApiHealthStatus,
  apiStatusStyle,
  API_STATUS_COLOR,
} from "../utils/apiHealth.js";

function ProviderFeedModeBanner({
  apiHealth = {},
  connectionReport = null,
  audit = null,
  renderSourceAudit = null,
  mlbPipelineStatus = null,
  pipelineProjectionStats = null,
  loading = false,
}) {
  const health = getApiHealthStatus({
    apiHealth,
    connectionReport,
    mlbPipelineStatus,
    pipelineProjectionStats,
  });

  const liveAvailable =
    health.overall.color === API_STATUS_COLOR.GREEN ||
    Number(renderSourceAudit?.liveProviderCount ?? audit?.liveProviderCount ?? 0) > 0;

  const headline = loading ? "Loading feeds…" : health.overall.status;
  const headlineStyle = loading
    ? apiStatusStyle(API_STATUS_COLOR.YELLOW)
    : apiStatusStyle(health.overall.color);

  const bannerRows = health.providerRows;

  return (
    <section
      className={`provider-feed-mode-banner provider-feed-mode-banner--${liveAvailable && !loading ? "live" : "cache"}`}
      aria-label="Provider data mode"
    >
      <div className="provider-feed-mode-banner__head">
        <strong className="provider-feed-mode-banner__title">{headline}</strong>
        {!loading ? <span style={headlineStyle}>{liveAvailable ? "Live" : "Limited"}</span> : null}
      </div>
      {!loading ? (
        <>
          <p className="provider-feed-mode-banner__stats">
            Stats Verification: <strong>{health.statsVerification.status}</strong>
          </p>
          <ul className="provider-feed-mode-banner__providers">
            {bannerRows.map((row) => (
              <li key={row.provider}>
                <span className="provider-feed-mode-banner__provider-name">{row.provider}</span>
                <span style={apiStatusStyle(row.color)}>{row.status}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export default memo(ProviderFeedModeBanner);
