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

function RejectionLines({ rejections = {} }) {
  const rows = Object.entries(rejections || {}).filter(([, count]) => Number(count) > 0);
  if (!rows.length) return null;
  return (
    <p className="prop-pipeline-counters prop-pipeline-counters--meta" aria-label="Pipeline filter rejections">
      Rejections — {rows.map(([reason, count]) => `${reason}: ${count}`).join(" · ")}
    </p>
  );
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
    counts?.providerFetchDiagnostics ||
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
  const dropOffLine =
    stageAudit?.dropOffStage && stageAudit?.dropOffDetail
      ? `Drop-off at ${stageAudit.dropOffStage}: ${stageAudit.dropOffDetail}`
      : "";

  if (compact) {
    return (
      <p className="prop-pipeline-counters" aria-label="Prop pipeline counts">
        PP: {stageAudit?.rawPrizePicks ?? prizepicksFetch} · UD: {stageAudit?.rawUnderdog ?? underdogFetch} · Combined:{" "}
        {stageAudit?.combinedRaw ?? raw} · Projected: {stageAudit?.projectedProps ?? projected} · Verified:{" "}
        {stageAudit?.verifiedProps ?? verified}
        {dropOffLine ? ` · ${dropOffLine}` : ""}
      </p>
    );
  }

  return (
    <div className="prop-pipeline-counters-block" aria-label="Prop pipeline counts">
      <p className="prop-pipeline-counters">
        Raw: {raw} · Normalized: {normalized} · Projected: {projected} · Verified: {verified} · Rendered: {rendered}
      </p>
      {stageAudit ? (
        <>
          <p className="prop-pipeline-counters prop-pipeline-counters--meta" aria-label="Pipeline stage counts">
            rawPrizePicks: {stageAudit.rawPrizePicks ?? 0} · rawUnderdog: {stageAudit.rawUnderdog ?? 0} · combinedRaw:{" "}
            {stageAudit.combinedRaw ?? stageAudit.rawPropsFetched ?? 0} · normalizedProps:{" "}
            {stageAudit.normalizedProps ?? 0}
          </p>
          <p className="prop-pipeline-counters prop-pipeline-counters--meta">
            afterSportFilter: {stageAudit.afterSportFilter ?? 0} · afterMlbOnlyFilter:{" "}
            {stageAudit.afterMlbOnlyFilter ?? 0} · afterMarketFilter: {stageAudit.afterMarketFilter ?? 0} ·
            afterPlayerNormalization: {stageAudit.afterPlayerNormalization ?? 0}
          </p>
          <p className="prop-pipeline-counters prop-pipeline-counters--meta">
            projectionCandidates: {stageAudit.projectionCandidates ?? stageAudit.afterProjectionFilter ?? 0} ·
            projectedProps: {stageAudit.projectedProps ?? stageAudit.afterProjectionMerge ?? 0} ·
            afterHistoricalAttachment: {stageAudit.afterHistoricalAttachment ?? 0} · verifiedProps:{" "}
            {stageAudit.verifiedProps ?? stageAudit.afterVerificationFilter ?? 0} · displayedProps:{" "}
            {stageAudit.displayedProps ?? 0}
          </p>
        </>
      ) : null}
      <RejectionLines rejections={stageAudit?.rejections} />
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
