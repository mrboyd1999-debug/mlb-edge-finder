/** Projection counts aligned with Best Plays pipeline diagnostics. */

import { resolveBestPlayProjection } from "./bestPlaysPipelineDebug.js";

export function countPropsWithProjections(props = []) {
  if (!Array.isArray(props)) return 0;
  return props.filter((prop) => {
    const proj = resolveBestPlayProjection(prop);
    return proj != null && proj > 0;
  }).length;
}

/**
 * Merge pipeline projection stats from the same sources as the Best Plays banner.
 */
export function resolvePipelineProjectionStats({
  allDisplayProps = [],
  filterDiagnostics = null,
  debugPipelineCounts = null,
  liveRenderCounts = null,
} = {}) {
  const pipelineCounts = filterDiagnostics?.pipelineCounts || debugPipelineCounts || {};
  const normalized = Number(
    pipelineCounts.normalized ?? liveRenderCounts?.normalized ?? allDisplayProps.length ?? 0
  );
  const projectionCount = Number(
    pipelineCounts.withProjections ?? countPropsWithProjections(allDisplayProps) ?? 0
  );
  const coverage = normalized > 0 ? projectionCount / normalized : 0;
  return {
    projectionCount,
    normalizedCount: normalized,
    verifiedCount: Number(pipelineCounts.filtered ?? pipelineCounts.verified ?? 0),
    projectionCoverage: coverage,
  };
}

const COVERAGE_LIMITED_THRESHOLD = 0.25;

/**
 * CONNECTED if projectionCount > 0.
 * LIMITED if count === 0 OR coverage < 25%.
 * FAILED if count === 0 and projection fetch failed.
 */
export function resolveProjectionEngineStatus({
  projectionCount = 0,
  normalizedCount = 0,
  projectionCoverage = 0,
  fetchFailed = false,
  lastError = "",
} = {}) {
  const count = Number(projectionCount) || 0;
  const normalized = Number(normalizedCount) || 0;
  const coverage = Number.isFinite(Number(projectionCoverage))
    ? Number(projectionCoverage)
    : normalized > 0
      ? count / normalized
      : 0;

  if (count > 0) {
    const pct = normalized > 0 ? Math.round(coverage * 100) : 100;
    return {
      status: "Connected",
      detail: `${count} projections${normalized > 0 ? ` · ${pct}% of ${normalized} props` : ""}`,
    };
  }

  if (fetchFailed) {
    return {
      status: "Failed",
      detail: lastError || "Projection fetch failed",
    };
  }

  if (normalized > 0 && coverage < COVERAGE_LIMITED_THRESHOLD) {
    return {
      status: "Limited",
      detail: `Low projection coverage (${Math.round(coverage * 100)}% of ${normalized} props)`,
    };
  }

  return {
    status: "Limited",
    detail: normalized > 0 ? "No projections on current props" : "No projections generated",
  };
}
