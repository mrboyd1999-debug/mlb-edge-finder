import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";
import { readSettingsMeta, getOddsApiKey, getSportsDataApiKey } from "../services/runtimeSettings.js";
import { healthStateStyle, CONNECTION_TIERS } from "../services/sourceHealth.js";

function findProviderRow(results = [], name) {
  return results.find((row) => String(row.provider || "").toLowerCase() === name.toLowerCase()) || null;
}

function resolveKeyProviderStatus(row, tested) {
  if (!tested) return "Not Tested";
  if (!row) return "Not Tested";
  const label = String(row?.statusLabel || row?.settingsLine || row?.displayStatus || "").trim();
  if (!label) return "Not Tested";
  if (/^connected$/i.test(label) || /^live$/i.test(label)) return "Connected";
  if (/not configured|not tested|not used/i.test(label)) return "Not Tested";
  const knownFailures = [
    "Invalid key",
    "Unauthorized",
    "Endpoint not included in plan",
    "Rate limited",
    "Proxy error",
    "Network error",
  ];
  if (knownFailures.includes(label)) return label;
  if (/connected|live|partial|ok|success/i.test(label)) return "Connected";
  return label || "Failed";
}

function resolveServiceStatus(connected) {
  return connected ? "Connected" : "Failed";
}

function statusTier(status) {
  if (status === "Connected") return CONNECTION_TIERS.CONNECTED;
  if (status === "Not Tested") return CONNECTION_TIERS.PENDING;
  return CONNECTION_TIERS.FAILED;
}

function formatTimestamp(value) {
  if (!value) return "—";
  const formatted = formatDateTime(value);
  return formatted || "—";
}

function StatusLine({ label, status, timestamp, timestampLabel }) {
  return (
    <div className="system-status-card__row">
      <div className="system-status-card__row-head">
        <span className="system-status-card__label">{label}</span>
        <span style={healthStateStyle(statusTier(status))}>{status}</span>
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
  const testedAt = connectionReport?.testedAt || meta.lastTestedAt || "";
  const hasBeenTested = Boolean(testedAt);
  const oddsRow = findProviderRow(reportRows, "Odds API");
  const sdRow = findProviderRow(reportRows, "SportsDataIO");

  const oddsKeyConfigured = Boolean(getOddsApiKey());
  const sdKeyConfigured = Boolean(getSportsDataApiKey());

  const stats = mlbPipelineStatus?.mlbStatsApi || {};
  const projection = mlbPipelineStatus?.projectionApi || {};
  const statsConnected = stats.status === "Connected";
  const projectionConnected =
    statsConnected ||
    projection.status === "Connected" ||
    Boolean(projection.lastProjectionGeneratedAt || projection.lastSuccessAt);

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
        {oddsKeyConfigured ? (
          <StatusLine
            label="Odds API"
            status={resolveKeyProviderStatus(oddsRow, hasBeenTested && Boolean(oddsRow))}
            timestamp={testedAt}
            timestampLabel="Last tested"
          />
        ) : null}
        {sdKeyConfigured ? (
          <StatusLine
            label="SportsDataIO"
            status={resolveKeyProviderStatus(sdRow, hasBeenTested && Boolean(sdRow))}
            timestamp={testedAt}
            timestampLabel="Last tested"
          />
        ) : null}
        <StatusLine
          label="MLB Stats API"
          status={resolveServiceStatus(statsConnected)}
          timestamp={stats.lastSuccessAt}
          timestampLabel="Last success"
        />
        <StatusLine
          label="Projection Engine"
          status={resolveServiceStatus(projectionConnected)}
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
