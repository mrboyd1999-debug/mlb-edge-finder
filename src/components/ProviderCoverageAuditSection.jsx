import { memo } from "react";
import { formatDateTime } from "../utils/formatters.js";

function MetricRow({ label, value }) {
  return (
    <div className="provider-coverage-audit-section__row">
      <span className="provider-coverage-audit-section__label">{label}</span>
      <span className="provider-coverage-audit-section__value">{value ?? 0}</span>
    </div>
  );
}

function ProviderCoverageAuditSection({ audit = null, loading = false }) {
  return (
    <section className="provider-coverage-audit-section" aria-label="Provider coverage audit">
      <div className="provider-coverage-audit-section__head">
        <strong>Provider Coverage Audit</strong>
        {audit?.feedMode ? (
          <span className="provider-coverage-audit-section__mode">{audit.feedMode} DATA</span>
        ) : null}
      </div>
      {loading && !audit ? <p className="provider-coverage-audit-section__note">Loading provider counts…</p> : null}
      <div className="provider-coverage-audit-section__grid">
        <MetricRow label="PrizePicks Raw" value={audit?.prizepicksLiveFetched ?? audit?.prizepicksFetched} />
        <MetricRow label="PrizePicks Parsed" value={audit?.prizepicksParsed} />
        <MetricRow label="PrizePicks Usable" value={audit?.prizepicksUsable} />
        <MetricRow label="Underdog Raw" value={audit?.underdogLiveFetched ?? audit?.underdogFetched} />
        <MetricRow label="Underdog Parsed" value={audit?.underdogParsed} />
        <MetricRow label="Underdog Usable" value={audit?.underdogUsable} />
        <MetricRow label="Cached Props Loaded" value={audit?.cacheUsable} />
        <MetricRow label="Combined Props" value={audit?.combinedProps ?? audit?.combinedUsable} />
        <MetricRow label="Projection Candidates" value={audit?.projectionCandidates} />
        <MetricRow label="Projected Props" value={audit?.projected} />
        <MetricRow label="Verified Props" value={audit?.verifiedPlaysCount ?? audit?.verified ?? audit?.verifiedProps} />
      </div>
      {audit?.dataIntegrityMismatch && audit?.integrityWarning && Number(audit?.liveProviderCount ?? 0) === 0 ? (
        <p className="provider-coverage-audit-section__bottleneck" role="alert">
          {audit.integrityWarning}
        </p>
      ) : null}
      {audit?.prizepicksFailurePoint ? (
        <p className="provider-coverage-audit-section__note">
          PrizePicks root cause: {audit.prizepicksExactFailure || audit.prizepicksFailurePoint}
        </p>
      ) : null}
      {audit?.underdogFailurePoint ? (
        <p className="provider-coverage-audit-section__note">
          Underdog root cause: {audit.underdogExactFailure || audit.underdogFailurePoint}
        </p>
      ) : null}
      {audit?.prizepicksEndpointDeprecated || audit?.underdogEndpointDeprecated ? (
        <p className="provider-coverage-audit-section__bottleneck" role="alert">
          Endpoint deprecated — live provider route may have changed
        </p>
      ) : null}
      {audit?.cacheFallbackStage ? (
        <p className="provider-coverage-audit-section__note">Cache fallback: {audit.cacheFallbackStage}</p>
      ) : null}
      {audit?.boardCacheTimestamp ? (
        <p className="provider-coverage-audit-section__note">
          Board cache timestamp: {formatDateTime(audit.boardCacheTimestamp)}
        </p>
      ) : null}
      {audit?.diagnosis?.summary ? (
        <p className="provider-coverage-audit-section__bottleneck">Bottleneck: {audit.diagnosis.summary}</p>
      ) : null}
    </section>
  );
}

export default memo(ProviderCoverageAuditSection);
