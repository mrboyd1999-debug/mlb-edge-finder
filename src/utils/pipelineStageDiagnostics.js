/**
 * End-to-end pipeline stage counts + rejection diagnostics.
 */

import { countMergedProjections } from "./projectionCoverageAudit.js";
import { countVerifiedFilterProps } from "./pipelinePropCountAudit.js";
import { auditProjectionAttachment } from "./pipelineProjectionAttach.js";

export function buildPipelineStageCounts({
  raw = 0,
  normalized = 0,
  projected = 0,
  verified = 0,
  displayed = 0,
} = {}) {
  return {
    RAW_COUNT: Number(raw) || 0,
    NORMALIZED_COUNT: Number(normalized) || 0,
    PROJECTED_COUNT: Number(projected) || 0,
    VERIFIED_COUNT: Number(verified) || 0,
    DISPLAYED_COUNT: Number(displayed) || 0,
  };
}

export function buildPipelineStageCountsFromBoard({
  rawProps = [],
  normalizedProps = [],
  projectedProps = [],
  verifiedProps = [],
  displayedProps = [],
} = {}) {
  return buildPipelineStageCounts({
    raw: rawProps.length,
    normalized: normalizedProps.length,
    projected: countMergedProjections(projectedProps.length ? projectedProps : normalizedProps),
    verified: verifiedProps.length || countVerifiedFilterProps(normalizedProps),
    displayed: displayedProps.length,
  });
}

export function auditPipelineRejectionReasons(props = [], sourceProps = []) {
  return auditProjectionAttachment(props, sourceProps);
}

export function logPipelineStageDiagnostics(stageCounts = {}, rejectionAudit = null) {
  console.log("[Pipeline Stage Counts]", stageCounts);
  if (rejectionAudit?.topRejectionReasons?.length) {
    console.log("[Pipeline] TOP REJECTION REASONS", rejectionAudit.topRejectionReasons);
  }
}
