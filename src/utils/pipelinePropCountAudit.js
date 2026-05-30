/**
 * Stage-by-stage prop count diagnostics — pinpoints pipeline drop-off.
 */

import { passesVerifiedBestPlaysFilter } from "./bestPlaysPipelineDebug.js";
import { countMergedProjections } from "./projectionCoverageAudit.js";

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

export function countVerifiedFilterProps(props = []) {
  return (props || []).filter((prop) => passesVerifiedBestPlaysFilter(prop)).length;
}

export function buildPipelinePropCountAudit({
  rawPropsFetched = 0,
  normalizedProps = 0,
  afterSportFilter = 0,
  afterMarketFilter = 0,
  afterProjectionFilter = 0,
  afterProjectionMerge = 0,
  afterVerificationFilter = 0,
  displayedProps = 0,
} = {}) {
  const stages = [
    { key: "raw_fetch", label: "Raw props fetched", count: finiteCount(rawPropsFetched) },
    { key: "normalized", label: "Normalized props", count: finiteCount(normalizedProps) },
    { key: "sport_filter", label: "After sport filter", count: finiteCount(afterSportFilter) },
    { key: "market_filter", label: "After market filter", count: finiteCount(afterMarketFilter) },
    { key: "projection_filter", label: "After projection filter", count: finiteCount(afterProjectionFilter) },
    { key: "projection_merge", label: "After projection merge", count: finiteCount(afterProjectionMerge) },
    { key: "verification_filter", label: "After verification filter", count: finiteCount(afterVerificationFilter) },
    { key: "displayed", label: "Displayed props", count: finiteCount(displayedProps) },
  ];

  let dropOffStage = null;
  let dropOffDetail = "";

  for (let index = 1; index < stages.length; index += 1) {
    const prev = stages[index - 1];
    const next = stages[index];
    if (prev.count <= 0) continue;
    const lost = prev.count - next.count;
    const lossPct = lost / prev.count;
    if (lost > 0 && (lossPct >= 0.35 || (prev.count >= 200 && lost >= 100))) {
      dropOffStage = next.key;
      dropOffDetail = `${prev.label} ${prev.count} → ${next.label} ${next.count} (−${lost}, ${Math.round(lossPct * 100)}%)`;
      break;
    }
  }

  return {
    stages,
    rawPropsFetched: stages[0].count,
    normalizedProps: stages[1].count,
    afterSportFilter: stages[2].count,
    afterMarketFilter: stages[3].count,
    afterProjectionFilter: stages[4].count,
    afterProjectionMerge: stages[5].count,
    afterVerificationFilter: stages[6].count,
    displayedProps: stages[7].count,
    dropOffStage,
    dropOffDetail,
    updatedAt: new Date().toISOString(),
  };
}

export function logPipelinePropCountAudit(audit = {}) {
  const header = "[Pipeline Prop Counts]";
  console.info(header, {
    rawPropsFetched: audit.rawPropsFetched ?? 0,
    normalizedProps: audit.normalizedProps ?? 0,
    afterSportFilter: audit.afterSportFilter ?? 0,
    afterMarketFilter: audit.afterMarketFilter ?? 0,
    afterProjectionFilter: audit.afterProjectionFilter ?? 0,
    afterProjectionMerge: audit.afterProjectionMerge ?? 0,
    afterVerificationFilter: audit.afterVerificationFilter ?? 0,
    displayedProps: audit.displayedProps ?? 0,
    dropOffStage: audit.dropOffStage || null,
  });
  console.info(`${header} Raw props fetched:`, audit.rawPropsFetched ?? 0);
  console.info(`${header} Normalized props:`, audit.normalizedProps ?? 0);
  console.info(`${header} After sport filter:`, audit.afterSportFilter ?? 0);
  console.info(`${header} After market filter:`, audit.afterMarketFilter ?? 0);
  console.info(`${header} After projection filter:`, audit.afterProjectionFilter ?? 0);
  console.info(`${header} After projection merge:`, audit.afterProjectionMerge ?? 0);
  console.info(`${header} After verification filter:`, audit.afterVerificationFilter ?? 0);
  console.info(`${header} Displayed props:`, audit.displayedProps ?? 0);
  if (audit.dropOffStage) {
    console.warn(`${header} Primary drop-off at "${audit.dropOffStage}":`, audit.dropOffDetail || "");
  }
  return audit;
}

export function summarizePipelinePropCounts(props = []) {
  return {
    withProjections: countMergedProjections(props),
    verified: countVerifiedFilterProps(props),
  };
}
