import { formatNumber } from "../utils/formatters.js";

export const DATA_STATUS = {
  VERIFIED: "Verified MLB data",
  PARTIAL: "Partial MLB data",
  FALLBACK: "Estimated fallback projection",
};

export const VERIFIED_PROJECTION_LABEL = "Verified MLB projection";

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
  return DATA_STATUS.FALLBACK;
}

export function dataStatusLabel(dataStatus = DATA_STATUS.FALLBACK) {
  if (dataStatus === DATA_STATUS.VERIFIED) return DATA_STATUS.VERIFIED;
  if (dataStatus === DATA_STATUS.PARTIAL) return DATA_STATUS.PARTIAL;
  return DATA_STATUS.FALLBACK;
}

export function isFallbackDataStatus(dataStatus) {
  return dataStatus === DATA_STATUS.FALLBACK;
}

export function projectionLabelFromDataStatus(dataStatus) {
  if (dataStatus === DATA_STATUS.FALLBACK) return DATA_STATUS.FALLBACK;
  return VERIFIED_PROJECTION_LABEL;
}

export function isVerifiedProjectionStatus(dataStatus) {
  return dataStatus === DATA_STATUS.VERIFIED || dataStatus === DATA_STATUS.PARTIAL;
}

export function projectionConfidenceFromDataStatus(dataStatus, sampleSize = 0) {
  if (dataStatus === DATA_STATUS.VERIFIED) return Math.min(88, 72 + Math.min(sampleSize, 10) * 1.2);
  if (dataStatus === DATA_STATUS.PARTIAL) return Math.min(72, 58 + Math.min(sampleSize, 8));
  return 48;
}

export function buildFallbackBreakdown(fairLine, note = "No verified game logs") {
  return [
    buildBreakdownRow("Baseline estimate", fairLine, { display: formatNumber(fairLine), contribution: fairLine }),
    buildBreakdownRow("Note", note, { display: note, contribution: 0 }),
    buildBreakdownRow("Data status", DATA_STATUS.FALLBACK, { display: DATA_STATUS.FALLBACK, contribution: 0 }),
  ];
}
