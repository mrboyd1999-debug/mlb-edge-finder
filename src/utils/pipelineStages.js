import { filterApprovedMarkets, applySportProcessingLimits } from "./approvedMarkets.js";
import { filterIngestionProps } from "./ingestionFilter.js";
import { slimPropsForUi } from "./renderProp.js";
import { shouldTrackRejectedProps } from "./devMode.js";

/**
 * FILTER PIPELINE — ingestion, approved markets, slate, validation, active/preScore caps.
 * No scoring, projections, or confidence work happens before this returns.
 */
export function runFilterPipeline({
  rawProps = [],
  pipelineAudit,
  recordFilterReason,
  filterOptions,
  filterUpcomingSlate,
  validateAndFilterProps,
  canonicalizeSportProp,
  labelPartialIfMissingTime,
  ensurePropStartTime,
  getBaseActiveFilterReason,
  getPreScoringFilterReason,
  matchesStatTypeFilter,
  prioritizePreScoringProps,
  maxPreScoreProps,
  statType = "all",
  logFilteredProp = () => {},
}) {
  const track = shouldTrackRejectedProps();
  const record = track ? recordFilterReason : null;
  const logFiltered = track ? logFilteredProp : () => {};

  const sportFiltered = filterIngestionProps(rawProps, pipelineAudit, record);
  const approvedProps = filterApprovedMarkets(sportFiltered, pipelineAudit, record);
  const cappedProps = applySportProcessingLimits(approvedProps);

  const slateProps = filterUpcomingSlate(cappedProps, filterOptions, pipelineAudit, {
    recordFilterReason: record,
    logFilteredProp: logFiltered,
  });

  const canonicalProps = validateAndFilterProps(slateProps.map(canonicalizeSportProp), (reason, prop) => {
    if (record) {
      record(pipelineAudit, reason, prop, "verified");
      logFiltered(prop, reason);
    }
  });

  const activeProps = canonicalProps
    .map((prop) => labelPartialIfMissingTime(ensurePropStartTime(prop)))
    .filter((prop) => {
      const filterReason = getBaseActiveFilterReason(prop, filterOptions);
      if (filterReason) {
        if (record) {
          record(pipelineAudit, filterReason, prop, "active");
          logFiltered(prop, filterReason);
        }
        return false;
      }
      return true;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const preScorePool = activeProps.filter((prop) => {
    const filterReason = getPreScoringFilterReason(prop, filterOptions);
    if (filterReason) {
      if (record) {
        record(pipelineAudit, filterReason, prop, "preScore");
        logFiltered(prop, filterReason);
      }
      return false;
    }
    if (!matchesStatTypeFilter(prop, statType)) {
      if (record) {
        record(pipelineAudit, "stat type UI filter", prop, "preScore");
      }
      return false;
    }
    return true;
  });

  const normalProps = prioritizePreScoringProps(preScorePool).slice(0, maxPreScoreProps);

  return {
    approvedProps,
    cappedProps,
    slateProps,
    canonicalProps,
    activeProps,
    preScorePool,
    normalProps,
  };
}

/**
 * UI PIPELINE — lightweight render-ready props.
 */
export function runUiPipeline({ displayProps = [], streakProps = [], watchlist = [] }) {
  return {
    props: slimPropsForUi(displayProps),
    streakProps: slimPropsForUi(streakProps),
    watchlist: slimPropsForUi(watchlist),
  };
}
