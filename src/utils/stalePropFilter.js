import { normalize } from "./formatters.js";
import {
  getSlateFilterReason,
  isGameStarted,
  isUpcomingSlateProp,
  MIN_START_BUFFER_MS,
} from "./slateFilter.js";

const LOCKED_STATUSES = new Set(["locked", "suspended", "closed", "inactive", "unavailable", "disabled"]);

export { isGameStarted, MIN_START_BUFFER_MS };

export function isLiveProp(prop) {
  const label = normalize(`${prop.league || ""} ${prop.status || ""} ${prop.gameStatus || ""}`);
  return label.includes("live") || label.includes("inprogress") || prop.status === "live";
}

export function isLockedOrSuspended(prop) {
  const status = normalize(prop.status || prop.lineStatus || "");
  return LOCKED_STATUSES.has(status) || status.includes("locked") || status.includes("suspend");
}

export function isSourceUnavailable(prop) {
  return Boolean(prop.unavailable || prop.isUnavailable || normalize(prop.availability) === "unavailable");
}

export function hasWeakMissingTime(prop) {
  const start = new Date(prop.startTime).getTime();
  const missingTime = !Number.isFinite(start);
  const weakData =
    prop.dataQualityBadge?.tone === "weak" ||
    prop.projectionSource === "missing" ||
    Number(prop.dataQualityScore || 0) < 35;
  return missingTime && weakData;
}

export function getStaleFilterReason(prop, options = {}) {
  const slateReason = getSlateFilterReason(prop, options);
  if (slateReason) return slateReason;

  if (options.includeUncertain) {
    if (isSourceUnavailable(prop)) return "source marked unavailable";
    if (prop.status === "locked" || prop.status === "expired") return "prop is locked or expired";
    return "";
  }
  if (isSourceUnavailable(prop)) return "source marked unavailable";
  if (isLockedOrSuspended(prop)) return "prop is locked or suspended";
  if (hasWeakMissingTime(prop) && !prop.partialTimeLabel) return "missing game time with weak data";
  return "";
}

export function filterStaleProps(props = [], options = {}) {
  return props.filter((prop) => isUpcomingSlateProp(prop, options) && !getStaleFilterReason(prop, options));
}

export function labelPartialIfMissingTime(prop) {
  const start = new Date(prop.startTime).getTime();
  if (Number.isFinite(start)) return prop;
  return {
    ...prop,
    partialTimeLabel: true,
    dataQualityBadge: prop.dataQualityBadge || { label: "Partial data", tone: "partial" },
  };
}
