import { formatNumber } from "../utils/formatters.js";

export const DATA_STATUS = {
  VERIFIED: "Verified MLB data",
  PARTIAL: "Partial MLB data",
  UNAVAILABLE: "Missing verified projection data",
};

export const VERIFIED_PROJECTION_LABEL = "Verified MLB projection";
export const PROJECTION_UNAVAILABLE_LABEL = "Projection unavailable";
export const AWAITING_VERIFIED_MLB_DATA = "Awaiting verified MLB data";
export const EDGE_FORMULA_DISABLED = "Disabled until projection exists";
export const EDGE_CALCULATION_UNAVAILABLE = "Edge calculation unavailable";
export const PROJECTION_SOURCE_MISSING = "Missing";
export const DATA_UNAVAILABLE_CONFIDENCE = "Data unavailable";
export const LIVE_LINE_PROJECTION_UNAVAILABLE = "Live line available; projection data unavailable";

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

export function buildBreakdownRow(label, value, { weight = null, contribution = null, display = null } = {}) {
  const numeric = Number(value);
  const contrib = contribution != null ? contribution : weight != null && Number.isFinite(numeric) ? round(numeric * weight, 2) : numeric;
  return {
    label,
    value: Number.isFinite(numeric) ? numeric : value,
    weight,
    contribution: Number.isFinite(Number(contrib)) ? round(contrib, 2) : contrib,
    display: display ?? (Number.isFinite(numeric) ? formatNumber(numeric) : String(value ?? "")),
  };
}

export function appendFinalProjectionRow(breakdown, projection, label = "Final projection") {
  breakdown.push(
    buildBreakdownRow(label, round(projection, 1), {
      display: formatNumber(round(projection, 1)),
      contribution: round(projection, 1),
    })
  );
  return breakdown;
}

export function appendDataStatusRow(breakdown, dataStatus) {
  breakdown.push(
    buildBreakdownRow("Data status", dataStatus, {
      display: dataStatus,
      contribution: 0,
    })
  );
  return breakdown;
}

export function resolveDataStatus({ hasGameLogs, hasCoreRates, hasOpponent, hasWorkload }) {
  if (hasGameLogs && hasCoreRates && hasOpponent && hasWorkload) return DATA_STATUS.VERIFIED;
  if (hasGameLogs && hasCoreRates) return DATA_STATUS.PARTIAL;
  return DATA_STATUS.UNAVAILABLE;
}

export function dataStatusLabel(dataStatus = DATA_STATUS.UNAVAILABLE) {
  if (dataStatus === DATA_STATUS.VERIFIED) return DATA_STATUS.VERIFIED;
  if (dataStatus === DATA_STATUS.PARTIAL) return DATA_STATUS.PARTIAL;
  return DATA_STATUS.UNAVAILABLE;
}

export function isUnavailableDataStatus(dataStatus) {
  return dataStatus === DATA_STATUS.UNAVAILABLE || dataStatus === "Estimated fallback projection";
}

export function isFallbackDataStatus(dataStatus) {
  return isUnavailableDataStatus(dataStatus);
}

export function projectionLabelFromDataStatus(dataStatus) {
  if (isUnavailableDataStatus(dataStatus)) return PROJECTION_UNAVAILABLE_LABEL;
  return VERIFIED_PROJECTION_LABEL;
}

export function isVerifiedProjectionStatus(dataStatus) {
  return dataStatus === DATA_STATUS.VERIFIED || dataStatus === DATA_STATUS.PARTIAL;
}

export function projectionConfidenceFromDataStatus(dataStatus, sampleSize = 0) {
  if (dataStatus === DATA_STATUS.VERIFIED) return Math.min(88, 72 + Math.min(sampleSize, 10) * 1.2);
  if (dataStatus === DATA_STATUS.PARTIAL) return Math.min(72, 58 + Math.min(sampleSize, 8));
  return null;
}

export function buildUnavailableProjectionBreakdown(note = "Insufficient verified MLB game logs") {
  return [
    buildBreakdownRow("Note", note, { display: note, contribution: 0 }),
    buildBreakdownRow("Data status", DATA_STATUS.UNAVAILABLE, { display: DATA_STATUS.UNAVAILABLE, contribution: 0 }),
  ];
}

/** @deprecated Use buildUnavailableProjectionBreakdown */
export const buildFallbackBreakdown = buildUnavailableProjectionBreakdown;
