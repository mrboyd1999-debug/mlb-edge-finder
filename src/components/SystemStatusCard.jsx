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

function resolveServiceStatus(connected, { warning = false } = {}) {
  if (connected) return "Connected";
  if (warning) return "Warning";
  return "Failed";
}

function statusTier(status) {
  if (status === "Connected") return CONNECTION_TIERS.CONNECTED;
  if (status === "Not Tested" || status === "Warning") return CONNECTION_TIERS.WARNING;
  return CONNECTION_TIERS.FAILED;
}

function indicatorTier(status) {
  if (status === "Connected") return "ok";
  if (status === "Not Tested" || status === "Warning") return "warn";
  return "fail";
}

function formatTimestamp(value) {
  if (!value) return "—";
  const formatted = formatDateTime(value);
  return formatted || "—";
}

function StatusLine({ label, status, timestamp, timestampLabel, detail, usableCount }) {
  const tier = indicatorTier(status);
  return (
    <div className="system-status-card__row">
      <div className="system-status-card__row-head">
        <span className="system-status-card__label">
          <span className={`system-status-card__dot system-status-card__dot--${tier}`} aria-hidden="true" />
          {label}
        </span>
        <span style={healthStateStyle(statusTier(status))}>{status}</span>
      </div>
      {Number.isFinite(usableCount) ? (
        <p className="system-status-card__meta">Usable props: {usableCount}</p>
      ) : null}
      {timestampLabel ? (
        <p className="system-status-card__meta">
          {timestampLabel}: {formatTimestamp(timestamp)}
        </p>
      ) : null}
      {detail ? <p className="system-status-card__meta system-status-card__meta--error">{detail}</p> : null}
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

  const pp = apiHealth?.PrizePicks || {};
  const ud = apiHealth?.Underdog || {};
  const ppCount = Number(pp.usableCount) || 0;
  const udCount = Number(ud.usableCount) || 0;
  const totalUsable = ppCount + udCount;

  const ppStatus = pp.connectionTier || pp.status || "Pending";
  const udStatus = ud.connectionTier || ud.status || "Pending";
  const ppFailed = ppStatus === CONNECTION_TIERS.FAILED;
  const udFailed = udStatus === CONNECTION_TIERS.FAILED;

  return (
    <section className="system-status-card" aria-label="System status">
      <div className="system-status-card__head">
        <strong>System Status</strong>
        {totalUsable > 0 ? (
          <span className="system-status-card__summary">{totalUsable} usable props</span>
        ) : null}
      </div>
      <div className="system-status-card__grid">
        <StatusLine
          label="PrizePicks"
          status={ppFailed ? "Failed" : ppCount > 0 ? "Connected" : ppStatus === CONNECTION_TIERS.CONNECTED ? "Connected" : "Warning"}
          timestamp={pp.lastFetchAt}
          timestampLabel="Last sync"
          usableCount={ppCount}
          detail={ppFailed ? pp.lastError || pp.statusLabel || "Feed fetch failed" : ""}
        />
        <StatusLine
          label="Underdog"
          status={udFailed ? "Failed" : udCount > 0 ? "Connected" : udStatus === CONNECTION_TIERS.CONNECTED ? "Connected" : "Warning"}
          timestamp={ud.lastFetchAt}
          timestampLabel="Last sync"
          usableCount={udCount}
          detail={udFailed ? ud.lastError || ud.statusLabel || "Feed fetch failed" : ""}
        />
        {oddsKeyConfigured ? (
          <StatusLine
            label="Odds API"
            status={resolveKeyProviderStatus(oddsRow, hasBeenTested && Boolean(oddsRow))}
            timestamp={testedAt}
            timestampLabel="Last tested"
            detail={oddsRow?.statusLabel && !/^connected$/i.test(oddsRow.statusLabel) ? oddsRow.statusLabel : ""}
          />
        ) : null}
        {sdKeyConfigured ? (
          <StatusLine
            label="SportsDataIO"
            status={resolveKeyProviderStatus(sdRow, hasBeenTested && Boolean(sdRow))}
            timestamp={testedAt}
            timestampLabel="Last tested"
            detail={sdRow?.statusLabel && !/^connected$/i.test(sdRow.statusLabel) ? sdRow.statusLabel : ""}
          />
        ) : null}
        <StatusLine
          label="MLB Stats API"
          status={resolveServiceStatus(statsConnected)}
          timestamp={stats.lastSuccessAt}
          timestampLabel="Last success"
          detail={stats.lastError || stats.failureReason || ""}
        />
        <StatusLine
          label="Projection Engine"
          status={resolveServiceStatus(projectionConnected, { warning: statsConnected && !projectionConnected })}
          timestamp={projection.lastProjectionGeneratedAt || projection.lastSuccessAt}
          timestampLabel="Last projection"
          detail={projection.lastError || projection.failureReason || ""}
        />
      </div>
    </section>
  );
}

export default memo(SystemStatusCard);
