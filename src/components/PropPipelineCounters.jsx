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
  pipelinePropCountAudit = null,
  compact = false,
}) {
  if (!counts && !projectionCoverageAudit && !statsAttachmentAudit && !pipelinePropCountAudit) return null;
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
  const stageAudit = pipelinePropCountAudit || counts?.pipelinePropCountAudit || null;
  const coverageLine = coverageAudit
    ? `Coverage: ${coverageAudit.projectedProps ?? projected} projected · ${coverageAudit.historicalMatches ?? 0} historical · ${coverageAudit.historicalMissing ?? 0} missing · ${coverageAudit.projectionCoveragePercent ?? 0}%`
    : "";
  const attachLine = attachAudit
    ? `Attach: ${attachAudit.profilesFound ?? 0} found · ${attachAudit.profilesMissing ?? 0} missing · ${attachAudit.gameLogsAttached ?? 0} logs · ${attachAudit.historicalCoveragePercent ?? 0}%`
    : "";
  const stageLine = stageAudit
    ? `Stages: raw ${stageAudit.rawPropsFetched ?? 0} · norm ${stageAudit.normalizedProps ?? 0} · sport ${stageAudit.afterSportFilter ?? 0} · market ${stageAudit.afterMarketFilter ?? 0} · proj filt ${stageAudit.afterProjectionFilter ?? 0} · merge ${stageAudit.afterProjectionMerge ?? 0} · verify ${stageAudit.afterVerificationFilter ?? 0} · shown ${stageAudit.displayedProps ?? 0}`
    : "";
  const dropOffLine =
    stageAudit?.dropOffStage && stageAudit?.dropOffDetail
      ? `Drop-off at ${stageAudit.dropOffStage}: ${stageAudit.dropOffDetail}`
      : "";

  if (compact) {
    return (
      <p className="prop-pipeline-counters" aria-label="Prop pipeline counts">
        Raw: {raw} · Normalized: {normalized} · Projected: {projected} · Verified: {verified} · Rendered:{" "}
        {rendered}
        {coverageLine ? ` · ${coverageLine}` : ""}
        {attachLine ? ` · ${attachLine}` : ""}
        {stageLine ? ` · ${stageLine}` : ""}
      </p>
    );
  }

  return (
    <div className="prop-pipeline-counters-block" aria-label="Prop pipeline counts">
      <p className="prop-pipeline-counters">
        Raw: {raw} · Normalized: {normalized} · Projected: {projected} · Verified: {verified} · Rendered: {rendered}
      </p>
      {stageAudit ? (
        <p className="prop-pipeline-counters prop-pipeline-counters--meta" aria-label="Pipeline stage counts">
          Raw fetched: {stageAudit.rawPropsFetched ?? 0} · Normalized: {stageAudit.normalizedProps ?? 0} · After sport
          filter: {stageAudit.afterSportFilter ?? 0} · After market filter: {stageAudit.afterMarketFilter ?? 0} · After
          projection filter: {stageAudit.afterProjectionFilter ?? 0} · After projection merge:{" "}
          {stageAudit.afterProjectionMerge ?? 0} · After verification filter: {stageAudit.afterVerificationFilter ?? 0}{" "}
          · Displayed: {stageAudit.displayedProps ?? 0}
        </p>
      ) : null}
      {dropOffLine ? (
        <p className="compact-form-notice prop-pipeline-counters__failure" role="status">
          {dropOffLine}
        </p>
      ) : null}
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
