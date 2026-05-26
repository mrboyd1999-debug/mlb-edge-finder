import { memo } from "react";
import { SPORTSDATA_STATUS_LABELS } from "../services/sportsDataAuthTest.js";

function planLabel(value) {
  if (value === true) return "Included";
  if (value === false) return "Not included";
  return "Unknown";
}

function SportsDataTestResults({ endpointTests = [], fallbackNote = "" }) {
  if (!endpointTests.length) return null;

  return (
    <div className="sportsdata-test-results">
      {endpointTests.map((row) => (
        <div key={row.id} className="sportsdata-test-results__row">
          <div className="sportsdata-test-results__head">
            <strong>{row.label}</strong>
            <span className={`sportsdata-test-results__status sportsdata-test-results__status--${String(row.statusLabel || "").toLowerCase().replace(/\s+/g, "-")}`}>
              {row.statusLabel || "—"}
            </span>
          </div>
          <p className="sportsdata-test-results__meta">HTTP {row.httpStatus ?? "—"}</p>
          <p className="sportsdata-test-results__meta">{row.message || row.responseBody || "—"}</p>
          <p className="sportsdata-test-results__meta">Plan: {planLabel(row.includedInPlan)}</p>
          <p className="sportsdata-test-results__url">{row.upstreamUrl || row.proxyRoute}</p>
        </div>
      ))}
      {fallbackNote ? <p className="sportsdata-test-results__fallback">{fallbackNote}</p> : null}
      {!fallbackNote && endpointTests.some((row) => row.statusLabel !== SPORTSDATA_STATUS_LABELS.CONNECTED) ? (
        <p className="sportsdata-test-results__fallback">
          Live PrizePicks/Underdog props still render. MLB Stats API is used when SportsDataIO is unavailable.
        </p>
      ) : null}
    </div>
  );
}

export default memo(SportsDataTestResults);
