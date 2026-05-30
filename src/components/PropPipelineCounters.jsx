import { memo } from "react";
import { getProviderFetchDiagnostics } from "../utils/providerFetchDiagnostics.js";

function ProviderStatusLine({ label, row = {} }) {
  if (row.skipped) return `${label}: skipped`;
  const ms = row.responseTimeMs != null ? `${row.responseTimeMs}ms` : "pending";
  const status = row.httpStatus ?? "—";
  const parsed = row.parsedPropsCount ?? 0;
  const finalCount = row.finalPropsCount ?? 0;
  const flag = row.timedOut ? " (timeout)" : row.slow ? " (slow)" : "";
  const reason = row.failureReason || row.lastError || "";
  const reasonSuffix = reason ? ` · ${reason}` : "";
  return `${label}: ${finalCount || parsed} props · ${ms} · HTTP ${status}${flag}${reasonSuffix}`;
}

function PropPipelineCounters({
  counts = null,
  projectionCoverageAudit = null,
  statsAttachmentAudit = null,
  compact = false,
}) {
  if (!counts && !projectionCoverageAudit && !statsAttachmentAudit) return null;
  const providerDiag =
    counts.providerFetchDiagnostics ||
    (typeof window !== "undefined" ? window.__PROVIDER_FETCH_DIAGNOSTICS__ : null) ||
    getProviderFetchDiagnostics();
  const {
    raw = counts?.fetched ?? 0,
    normalized = 0,
    projected = counts?.withProjections ?? counts?.projected ?? 0,
    verified = 0,
    rendered = 0,
    prizepicksFetch = 0,
    underdogFetch = 0,
    fallbackMode = null,
    failureReason = "",
    bottleneckStage = null,
  } = counts || {};

  const coverageAudit = projectionCoverageAudit || counts?.projectionCoverageAudit || null;
  const attachAudit = statsAttachmentAudit || counts?.statsAttachmentAudit || null;
  const coverageLine = coverageAudit
    ? `Coverage: ${coverageAudit.projectedProps ?? projected} projected · ${coverageAudit.historicalMatches ?? 0} historical · ${coverageAudit.historicalMissing ?? 0} missing · ${coverageAudit.projectionCoveragePercent ?? 0}%`
    : "";
  const attachLine = attachAudit
    ? `Attach: ${attachAudit.profilesFound ?? 0} found · ${attachAudit.profilesMissing ?? 0} missing · ${attachAudit.gameLogsAttached ?? 0} logs · ${attachAudit.historicalCoveragePercent ?? 0}%`
    : "";

  if (compact) {
    return (
      <p className="prop-pipeline-counters" aria-label="Prop pipeline counts">
        Raw: {raw} · Normalized: {normalized} · Projected: {projected} · Verified: {verified} · Rendered:{" "}
        {rendered}
        {coverageLine ? ` · ${coverageLine}` : ""}
        {attachLine ? ` · ${attachLine}` : ""}
      </p>
    );
  }

  return (
    <div className="prop-pipeline-counters-block" aria-label="Prop pipeline counts">
      <p className="prop-pipeline-counters">
        Raw: {raw} · Normalized: {normalized} · Projected: {projected} · Verified: {verified} · Rendered: {rendered}
      </p>
      {attachAudit ? (
        <p className="prop-pipeline-counters prop-pipeline-counters--meta" aria-label="Historical stats attachment">
          Profiles Found: {attachAudit.profilesFound ?? 0} · Profiles Missing: {attachAudit.profilesMissing ?? 0} ·
          Game Logs Attached: {attachAudit.gameLogsAttached ?? 0} · Historical Coverage %:{" "}
          {attachAudit.historicalCoveragePercent ?? 0}
        </p>
      ) : null}
      {coverageAudit ? (
        <p className="prop-pipeline-counters prop-pipeline-counters--meta" aria-label="Projection coverage audit">
          Projected Props: {coverageAudit.projectedProps ?? projected} · Historical Matches:{" "}
          {coverageAudit.historicalMatches ?? 0} · Historical Missing: {coverageAudit.historicalMissing ?? 0} ·
          Projection Coverage %: {coverageAudit.projectionCoveragePercent ?? 0}
        </p>
      ) : null}
      <p className="prop-pipeline-counters prop-pipeline-counters--meta">
        Providers — PrizePicks: {prizepicksFetch} · Underdog: {underdogFetch}
        {fallbackMode ? ` · Fallback: ${fallbackMode}` : ""}
      </p>
      {providerDiag ? (
        <p className="prop-pipeline-counters prop-pipeline-counters--meta">
          <ProviderStatusLine label="PrizePicks" row={providerDiag.prizepicks || {}} />
          {" · "}
          <ProviderStatusLine label="Underdog" row={providerDiag.underdog || {}} />
        </p>
      ) : null}
      {failureReason ? (
        <p className="compact-form-notice prop-pipeline-counters__failure" role="status">
          {bottleneckStage ? `[${bottleneckStage}] ` : ""}
          {failureReason}
        </p>
      ) : null}
    </div>
  );
}

export default memo(PropPipelineCounters);
