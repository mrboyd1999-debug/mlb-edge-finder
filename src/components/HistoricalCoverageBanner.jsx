import { memo } from "react";
import { healthStateStyle } from "../services/sourceHealth.js";

function HistoricalCoverageBanner({ audit = null, loading = false }) {
  if (!audit && !loading) return null;

  const profilesMatched = audit?.profilesFound ?? 0;
  const gameLogsAttached = audit?.gameLogsAttached ?? 0;
  const coveragePercent = audit?.historicalCoveragePercent ?? 0;
  const total = audit?.total ?? 0;
  const healthy = coveragePercent >= 60 && profilesMatched > 0;

  return (
    <section className="historical-coverage-banner" aria-label="Historical stats coverage">
      <div className="historical-coverage-banner__head">
        <strong>Historical Coverage</strong>
        <span style={healthStateStyle(healthy ? "Connected" : coveragePercent > 0 ? "Warning" : "Failed")}>
          {loading ? "Loading…" : `${coveragePercent}%`}
        </span>
      </div>
      <div className="historical-coverage-banner__metrics">
        <span>Profiles matched: {loading ? "—" : profilesMatched}</span>
        <span>Game logs attached: {loading ? "—" : gameLogsAttached}</span>
        <span>Coverage: {loading ? "—" : `${coveragePercent}%`}</span>
        {total > 0 ? <span className="historical-coverage-banner__total">{total} props scored</span> : null}
      </div>
      {!loading && coveragePercent < 60 ? (
        <p className="historical-coverage-banner__note">
          Verified plays require Last5, Last10, and Season averages from MLB Stats API game logs.
        </p>
      ) : null}
    </section>
  );
}

export default memo(HistoricalCoverageBanner);
