/**
 * Prop sanity checks — role/stat match, sport lock, recommendation vs projection.
 */

import { lockSportFromStatType, sportStatMismatchReason } from "./propStatSportLock.js";
import { resolvePropSportLabel } from "./underdogSportDetection.js";
import { playerRoleStatMismatchReason } from "./propPlayerRole.js";
import { resolveProjectionValue } from "./projectionQuality.js";

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/** Projection-driven side — source of truth for recommendations. */
export function recommendSideFromProjection(prop = {}) {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  if (projection == null || !Number.isFinite(line) || line <= 0) {
    return { side: "PASS", edge: 0 };
  }
  if (projection > line) {
    return { side: "OVER", edge: projection - line };
  }
  if (projection < line) {
    return { side: "UNDER", edge: line - projection };
  }
  return { side: "PASS", edge: 0 };
}

export function computeSignedEdgeForSide(prop = {}, side = "") {
  const projection = resolveProjectionValue(prop);
  const line = finiteOr(prop.line, NaN);
  if (projection == null || !Number.isFinite(line)) return 0;
  const pick = String(side || prop.recommendedSide || "").toUpperCase();
  if (pick === "UNDER" || pick === "LESS" || pick === "LOWER") {
    return line - projection;
  }
  if (pick === "OVER" || pick === "MORE" || pick === "HIGHER") {
    return projection - line;
  }
  const rec = recommendSideFromProjection(prop);
  return rec.edge;
}

export function validatePropSanityRejectReason(prop = {}) {
  const roleMismatch = playerRoleStatMismatchReason(prop);
  if (roleMismatch) return roleMismatch;

  const statType = prop.statType || prop.market || prop.propType || "";
  const sport = resolvePropSportLabel(prop) || prop.inferredSport || prop.sport || prop.league || "";
  const statLock = lockSportFromStatType(statType);

  if (statLock === "NBA" || statLock === "WNBA" || statLock === "NHL") {
    return "Rejected: non-MLB stat";
  }
  if (sport && sport !== "MLB" && sport !== "Unknown" && sport !== "") {
    const mismatch = sportStatMismatchReason("MLB", statType);
    if (mismatch) return mismatch;
    if (sport !== "MLB") return "Rejected: non-MLB sport";
  }
  if (statLock && statLock !== "MLB") return "Rejected: non-MLB stat type";

  return "";
}

export function isPropSanityValid(prop = {}) {
  return !validatePropSanityRejectReason(prop);
}

export function auditPropSanityRejections(props = []) {
  const reasons = {};
  let accepted = 0;
  (props || []).forEach((prop) => {
    const reason = validatePropSanityRejectReason(prop);
    if (!reason) {
      accepted += 1;
      return;
    }
    const key = reason.replace(/^Rejected:\s*/i, "").trim() || "unknown";
    reasons[key] = (reasons[key] || 0) + 1;
  });
  return { accepted, rejected: (props || []).length - accepted, reasons };
}
