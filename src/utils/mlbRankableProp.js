/**
 * Hard gates for Top MLB Plays — only verified, projected, positive-edge props rank.
 */

import { isVerifiedSportsbookProp } from "./propValidation.js";
import { validatePropSanityRejectReason } from "./propSanity.js";
import { evaluateBothSides } from "./sideEvaluationEngine.js";
import {
  hasMatchupContext,
  hasRenderableProjection,
  isTopMlbPlayCandidate,
  resolveProjectionValue,
  validateProjectionRejectReason,
} from "./projectionQuality.js";

const MIN_RANKABLE_CONFIDENCE = 51;

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function validateTopMlbPlayRejectReason(prop = {}) {
  if (!prop) return "Rejected: missing prop";
  if (!isVerifiedSportsbookProp(prop)) return "Rejected: unverified sportsbook prop";

  const sanity = validatePropSanityRejectReason(prop);
  if (sanity) return sanity;

  if (!isTopMlbPlayCandidate(prop)) return "Rejected: not MLB candidate";

  const projection = resolveProjectionValue(prop);
  if (projection == null) return "Rejected: no projection data available";

  const projectionReject = validateProjectionRejectReason(prop);
  if (projectionReject) return projectionReject;

  if (!hasMatchupContext(prop)) return "Rejected: matchup missing";

  const evaluation = prop.sideEvaluation || evaluateBothSides(prop);
  if (evaluation.pass || evaluation.recommendedSide === "PASS") {
    return "Rejected: PASS — insufficient edge";
  }
  if (finiteOr(evaluation.edge, 0) <= 0) return "Rejected: zero signed edge";

  const conf = finiteOr(evaluation.confidence ?? prop.confidenceScore ?? prop.confidence, NaN);
  if (!Number.isFinite(conf) || conf <= MIN_RANKABLE_CONFIDENCE) {
    return "Rejected: confidence too low";
  }

  if (!hasRenderableProjection(prop)) return "Rejected: projection not renderable";

  return "";
}

export function isTopMlbPlayRankable(prop = {}) {
  return !validateTopMlbPlayRejectReason(prop);
}

export function filterTopMlbPlayRankable(props = []) {
  return (props || []).filter(isTopMlbPlayRankable);
}

export function auditTopMlbPlayRankableRejections(props = []) {
  const reasons = {};
  let accepted = 0;
  (props || []).forEach((prop) => {
    const reason = validateTopMlbPlayRejectReason(prop);
    if (!reason) {
      accepted += 1;
      return;
    }
    const key = reason.replace(/^Rejected:\s*/i, "").trim() || "unknown";
    reasons[key] = (reasons[key] || 0) + 1;
  });
  return { accepted, rejected: (props || []).length - accepted, reasons };
}
