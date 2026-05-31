/**
 * Hard gates for Top MLB Plays — strict + relaxed + demo fallback tiers.
 */

import { isVerifiedSportsbookProp } from "./propValidation.js";
import { validatePropSanityRejectReason } from "./propSanity.js";
import { unsupportedMarketRejectReason } from "./mlbAllowedMarkets.js";
import { evaluateBothSides } from "./sideEvaluationEngine.js";
import { getStaleFilterReason } from "./stalePropFilter.js";
import { isMinimalRenderableProp } from "./normalizeProp.js";
import { isFakeOrFallbackProp } from "./livePropRender.js";
import {
  hasMatchupContext,
  hasRenderableProjection,
  isTopMlbPlayCandidate,
  resolveProjectionValue,
  validateProjectionRejectReason,
} from "./projectionQuality.js";

export const MIN_RANKABLE_EDGE = 0.15;
export const MIN_RANKABLE_CONFIDENCE = 52;
export const RELAXED_MIN_EDGE = 0.1;
export const RELAXED_MIN_CONFIDENCE = 50;

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function baseRejectReason(prop = {}, { requireVerified = false, requireMatchup = false } = {}) {
  if (!prop) return "Rejected: missing prop";
  if (isFakeOrFallbackProp(prop)) return "Rejected: non-live prop";
  if (requireVerified && !isVerifiedSportsbookProp(prop)) {
    return "Rejected: unverified sportsbook prop";
  }
  if (!isMinimalRenderableProp(prop)) return "Rejected: missing player/line/stat";
  if (!prop.isDemoData) {
    const unsupported = unsupportedMarketRejectReason(prop);
    if (unsupported) return unsupported;
    const sanity = validatePropSanityRejectReason(prop);
    if (sanity) return sanity;
    if (!isTopMlbPlayCandidate(prop)) return "Rejected: not MLB candidate";
  }
  if (requireMatchup && !hasMatchupContext(prop)) return "Rejected: matchup missing";
  return "";
}

export function validateTopMlbPlayRejectReason(prop = {}) {
  if (isLiveLineRankable(prop)) return "";

  const base = baseRejectReason(prop, { requireVerified: false, requireMatchup: false });
  if (base) return base;

  const projection = resolveProjectionValue(prop);
  if (projection == null || projection <= 0) return "Rejected: missing projection";

  const projectionReject = validateProjectionRejectReason(prop);
  if (projectionReject && !prop.estimatedProjection && !prop.isDemoData) return projectionReject;

  const stale = getStaleFilterReason(prop);
  if (stale && !prop.isDemoData) return `Rejected: stale line (${stale})`;

  const evaluation = prop.sideEvaluation || evaluateBothSides(prop);
  if (evaluation.pass || evaluation.recommendedSide === "PASS") {
    return "Rejected: PASS — insufficient edge";
  }
  if (finiteOr(evaluation.edge, 0) < MIN_RANKABLE_EDGE) return "Rejected: edge below floor";

  const conf = finiteOr(evaluation.confidence ?? prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(conf) || conf < MIN_RANKABLE_CONFIDENCE) {
    return "Rejected: confidence too low";
  }

  if (!hasRenderableProjection(prop) && !prop.isDemoData) return "Rejected: projection not renderable";

  return "";
}

export function validateRelaxedRankableRejectReason(prop = {}) {
  if (isLiveLineRankable(prop)) return "";
  if (prop.isDemoData) return "";

  const base = baseRejectReason(prop, { requireVerified: false, requireMatchup: false });
  if (base && !/unverified/.test(base)) return base;

  const projection = resolveProjectionValue(prop);
  if (projection == null || projection <= 0) return "Rejected: missing projection";

  const evaluation = prop.sideEvaluation || evaluateBothSides(prop);
  if (evaluation.pass || evaluation.recommendedSide === "PASS") {
    return "Rejected: PASS — insufficient edge";
  }
  if (finiteOr(evaluation.edge, 0) < RELAXED_MIN_EDGE) return "Rejected: edge below relaxed floor";

  const conf = finiteOr(evaluation.confidence ?? prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(conf) || conf < RELAXED_MIN_CONFIDENCE) {
    return "Rejected: confidence below relaxed floor";
  }

  return "";
}

export function isTopMlbPlayRankable(prop = {}) {
  return !validateTopMlbPlayRejectReason(prop);
}

export function isRelaxedRankable(prop = {}) {
  return !validateRelaxedRankableRejectReason(prop);
}

export function filterTopMlbPlayRankable(props = [], { relaxed = false } = {}) {
  const fn = relaxed ? isRelaxedRankable : isTopMlbPlayRankable;
  return (props || []).filter(fn);
}

/** Verified platform line — no synthetic projection required. */
export function validateLiveLineRejectReason(prop = {}) {
  if (isFakeOrFallbackProp(prop)) return "Rejected: non-live prop";
  if (prop.isDemoData) return "Rejected: demo prop";
  if (!isMinimalRenderableProp(prop)) return "Rejected: missing player/line/stat";
  const unsupported = unsupportedMarketRejectReason(prop);
  if (unsupported) return unsupported;
  const sanity = validatePropSanityRejectReason(prop);
  if (sanity) return sanity;
  return "";
}

export function isLiveLineRankable(prop = {}) {
  return !validateLiveLineRejectReason(prop);
}

export function isRelaxedRankableOrLiveLine(prop = {}) {
  return isRelaxedRankable(prop) || isLiveLineRankable(prop);
}

export function auditTopMlbPlayRankableRejections(props = [], { relaxed = false } = {}) {
  const reasons = {};
  let accepted = 0;
  const rejectFn = relaxed ? validateRelaxedRankableRejectReason : validateTopMlbPlayRejectReason;
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
