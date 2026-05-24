/**
 * Central usable-prop counting and provider status labels for API health UI.
 */

import { countUsableProps, isUsableParsedProp } from "./propShape.js";
import {
  isVerifiedSportsbookProp,
  validateCuratedPropRejectReason,
} from "./propValidation.js";
import { resolvePropSportLabel } from "./underdogSportDetection.js";
import { HEALTH_STATES } from "../services/sourceHealth.js";
import { isTimeoutPreview } from "./apiTimeout.js";

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function countVerifiedUsableProps(props = []) {
  return (props || []).filter(isVerifiedSportsbookProp).length;
}

export function countMlbVerifiedUsableProps(props = []) {
  return (props || []).filter(
    (prop) => isVerifiedSportsbookProp(prop) && resolvePropSportLabel(prop) === "MLB"
  ).length;
}

export function auditPropRejections(props = [], rejectFn = validateCuratedPropRejectReason) {
  const reasons = {};
  let accepted = 0;
  (props || []).forEach((prop) => {
    const reason = rejectFn(prop);
    if (!reason) {
      accepted += 1;
      return;
    }
    const key = reason.replace(/^Rejected:\s*/i, "").trim() || "unknown";
    reasons[key] = (reasons[key] || 0) + 1;
  });
  return { accepted, rejected: (props || []).length - accepted, reasons };
}

function failureDetail(lastError = "", timedOut = false) {
  const text = String(lastError || "").trim();
  if (timedOut || /timed?\s*out|timeout/i.test(text)) return "timeout";
  if (text) return text.split("|")[0].trim().slice(0, 80);
  return "timeout";
}

/**
 * Human-readable provider status — never "Live" without usable parsed props.
 */
export function formatProviderStatusLabel({
  badge = "",
  status = "",
  usableCount = 0,
  rawCount = 0,
  parsedCount = 0,
  failed = false,
  timedOut = false,
  cached = false,
  lastError = "",
} = {}) {
  const usable = finiteOr(usableCount, 0);
  const raw = finiteOr(rawCount, 0);
  const parsed = finiteOr(parsedCount, 0);
  const normalizedBadge = String(badge || status || "").toUpperCase();
  const errorText = String(lastError || "");

  if (timedOut || isTimeoutPreview(errorText) || /timed?\s*out/i.test(normalizedBadge)) {
    return "Timed out — fallback disabled";
  }
  if (
    failed ||
    normalizedBadge === HEALTH_STATES.FAILED ||
    normalizedBadge === "UNAVAILABLE" ||
    normalizedBadge === "OFFLINE"
  ) {
    return `Failed — ${failureDetail(errorText, timedOut)}`;
  }
  if (usable > 0) {
    if (cached || normalizedBadge === HEALTH_STATES.CACHED || /cached/i.test(String(status || ""))) {
      return `Cached — ${usable} usable props`;
    }
    return `Live — ${usable} usable props`;
  }
  if (raw > 0 && parsed === 0) {
    return "Connected — parser returned 0 props";
  }
  if (raw > 0) {
    return "Connected — no usable props";
  }
  if (normalizedBadge === HEALTH_STATES.EMPTY || normalizedBadge === "EMPTY") {
    return "Empty — no props parsed";
  }
  if (normalizedBadge === HEALTH_STATES.NOT_CONFIGURED || normalizedBadge === "NOT CONFIGURED") {
    return "Not configured";
  }
  return normalizedBadge ? String(badge || status) : "Pending";
}

export function summarizeSourceUsability(row = {}, propsSample = []) {
  const rawCount = finiteOr(row.rawPropsLoaded ?? row.rawCount, 0);
  const parsedCount = finiteOr(row.propsAfterParsing ?? row.parsedCount, 0);
  const sampleUsable = countUsableProps(propsSample);
  const usableCount = finiteOr(row.usablePropsCount ?? row.usableCount, sampleUsable || parsedCount);
  return { rawCount, parsedCount, usableCount };
}

export function resolveLiveBadge({ usableCount = 0, cached = false, failed = false, timedOut = false } = {}) {
  if (timedOut) return "TIMED OUT";
  if (failed) return HEALTH_STATES.FAILED;
  if (usableCount > 0) return cached ? HEALTH_STATES.CACHED : HEALTH_STATES.LIVE;
  return HEALTH_STATES.EMPTY;
}
