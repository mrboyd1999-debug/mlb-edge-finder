import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { readSettingsMeta } from "../services/runtimeSettings.js";
import { getOddsApiKey, getSportsDataApiKey } from "../config/apiConfig.js";
import { healthStateStyle, CONNECTION_TIERS } from "../services/sourceHealth.js";

function findProviderRow(results = [], name) {
  return results.find((row) => String(row.provider || "").toLowerCase() === name.toLowerCase()) || null;
}

function providerConnected(row, keyConfigured = false) {
  const line = String(row?.settingsLine || row?.displayStatus || "").toLowerCase();
  if (/connected|live|partial|cached|ok|success/.test(line)) return true;
  if (/failed|invalid|unauthorized|error|timeout|offline|unavailable/.test(line)) return false;
  return Boolean(keyConfigured);
}

function formatTimestamp(value) {
  if (!value) return "—";
  const formatted = formatDateTime(value);
  return formatted || "—";
}

function StatusLine({ label, status, timestamp, timestampLabel }) {
  const tier = status === "Connected" ? CONNECTION_TIERS.CONNECTED : CONNECTION_TIERS.FAILED;
  return (
    <div className="system-status-card__row">
      <div className="system-status-card__row-head">
        <span className="system-status-card__label">{label}</span>
        <span style={healthStateStyle(tier)}>{status}</span>
      </div>
      {timestampLabel ? (
        <p className="system-status-card__meta">
          {timestampLabel}: {formatTimestamp(timestamp)}
        </p>
      ) : null}
    </div>
  );
}

function SystemStatusCard({ apiHealth = {}, mlbPipelineStatus = null, connectionReport = null }) {
  const meta = readSettingsMeta();
  const reportRows = connectionReport?.results || meta.lastConnectionReport || [];
  const oddsRow = findProviderRow(reportRows, "Odds API");
  const sdRow = findProviderRow(reportRows, "SportsDataIO");
  const oddsKeyConfigured = Boolean(getOddsApiKey());
  const sdKeyConfigured = Boolean(getSportsDataApiKey());
  const oddsConnected = providerConnected(oddsRow, oddsKeyConfigured);
  const sdConnected = providerConnected(sdRow, sdKeyConfigured);

  const stats = mlbPipelineStatus?.mlbStatsApi || {};
  const projection = mlbPipelineStatus?.projectionApi || {};
  const statsConnected = stats.status === "Connected";
  const projectionConnected = Boolean(projection.lastProjectionGeneratedAt || projection.lastSuccessAt);

  const ppCount = Number(apiHealth?.PrizePicks?.usableCount) || 0;
  const udCount = Number(apiHealth?.Underdog?.usableCount) || 0;
  const liveFeedParts = [];
  if (ppCount > 0) liveFeedParts.push(`PrizePicks: ${ppCount} props`);
  if (udCount > 0) liveFeedParts.push(`Underdog: ${udCount} props`);

  return (
    <section className="system-status-card" aria-label="System status">
      <div className="system-status-card__head">
        <strong>System Status</strong>
      </div>
      <div className="system-status-card__grid">
        <StatusLine
          label="Odds API"
          status={oddsConnected ? "Connected" : "Failed"}
          timestamp={connectionReport?.testedAt || meta.lastTestedAt}
          timestampLabel="Last tested"
        />
        <StatusLine
          label="SportsDataIO"
          status={sdConnected ? "Connected" : "Failed"}
          timestamp={connectionReport?.testedAt || meta.lastTestedAt}
          timestampLabel="Last tested"
        />
        <StatusLine
          label="MLB Stats API"
          status={statsConnected ? "Connected" : "Failed"}
          timestamp={stats.lastSuccessAt}
          timestampLabel="Last success"
        />
        <StatusLine
          label="Projection Engine"
          status={projectionConnected ? "Connected" : "Failed"}
          timestamp={projection.lastProjectionGeneratedAt || projection.lastSuccessAt}
          timestampLabel="Last projection"
        />
      </div>
      {liveFeedParts.length ? (
        <p className="system-status-card__feeds">Live feeds: {liveFeedParts.join(" · ")}</p>
      ) : null}
    </section>
  );
}

export default memo(SystemStatusCard);
