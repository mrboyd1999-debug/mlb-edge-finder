import { memo } from "react";
import { healthStateStyle } from "../services/sourceHealth.js";
import {
  buildUserFacingProviderStatusRows,
  resolveCoreLiveDataAvailable,
} from "../utils/providerStatusHelper.js";

function providerStatusStyle(status = "") {
  const key = String(status || "").toLowerCase();
  if (key === "live" || key === "connected") return healthStateStyle("Connected");
  if (key === "cached") return healthStateStyle("Warning");
  if (key === "temporarily unavailable" || key === "not configured" || key === "not tested") {
    return healthStateStyle("Warning");
  }
  return healthStateStyle("Failed");
}

function ProviderFeedModeBanner({
  apiHealth = {},
  connectionReport = null,
  audit = null,
  renderSourceAudit = null,
  loading = false,
}) {
  const liveAvailable = resolveCoreLiveDataAvailable({
    apiHealth,
    connectionReport,
    audit,
    renderSourceAudit,
  });
  const providerRows = buildUserFacingProviderStatusRows({ apiHealth, connectionReport });
  const headline = loading ? "Loading feeds…" : liveAvailable ? "Live Data Available" : "Cached Data";
  const headlineStyle = loading
    ? healthStateStyle("Refreshing")
    : liveAvailable
      ? healthStateStyle("Connected")
      : healthStateStyle("Warning");

  return (
    <section
      className={`provider-feed-mode-banner provider-feed-mode-banner--${liveAvailable && !loading ? "live" : "cache"}`}
      aria-label="Provider data mode"
    >
      <div className="provider-feed-mode-banner__head">
        <strong className="provider-feed-mode-banner__title">{headline}</strong>
        {!loading ? <span style={headlineStyle}>{liveAvailable ? "Live" : "Cached"}</span> : null}
      </div>
      {!loading ? (
        <ul className="provider-feed-mode-banner__providers">
          {providerRows.map((row) => (
            <li key={row.provider}>
              <span className="provider-feed-mode-banner__provider-name">{row.provider}</span>
              <span style={providerStatusStyle(row.status)}>{row.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default memo(ProviderFeedModeBanner);
