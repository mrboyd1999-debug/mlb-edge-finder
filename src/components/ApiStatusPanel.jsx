import { memo } from "react";
import { getApiHealthStatus, apiStatusStyle } from "../utils/apiHealth.js";

const STATUS_ROWS = [
  "Odds API",
  "SportsDataIO",
  "Underdog",
  "PrizePicks",
  "MLB Stats",
  "Projection Engine",
];

function ApiStatusPanel({
  apiHealth = {},
  connectionReport = null,
  mlbPipelineStatus = null,
  pipelineProjectionStats = null,
  mlbStatsTest = null,
  pipelinePropCountAudit = null,
  feedHealthContext = null,
  debugSources = null,
  loading = false,
  className = "api-status-panel",
}) {
  if (loading) {
    return (
      <section className={className} aria-label="API status">
        <p className="api-status-panel__loading">Loading provider status…</p>
      </section>
    );
  }

  const health = getApiHealthStatus({
    apiHealth,
    connectionReport,
    mlbPipelineStatus,
    pipelineProjectionStats,
    mlbStatsTest,
    pipelinePropCountAudit,
    feedHealthContext,
    debugSources,
  });

  const rowByProvider = new Map(health.providerRows.map((row) => [row.provider, row]));

  return (
    <section className={className} aria-label="API status">
      <ul className="api-status-panel__list">
        {STATUS_ROWS.map((provider) => {
          const row = rowByProvider.get(provider) || { provider, status: "—", color: "yellow" };
          return (
            <li key={provider} className="api-status-panel__row">
              <span className="api-status-panel__provider">{provider}</span>
              <span style={apiStatusStyle(row.color)}>{row.status}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default memo(ApiStatusPanel);
