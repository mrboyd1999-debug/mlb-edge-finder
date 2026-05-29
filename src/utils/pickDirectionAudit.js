/**
 * Canonical projection-vs-line lean and pick direction validation.
 */

import { classifyVerifiedTier } from "./verifiedTierSystem.js";

const LEAN_PASS_TOLERANCE = 0.01;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function resolveProjectionValues(prop = {}) {
  const projection = finite(prop.projection ?? prop.projectedValue);
  const line = finite(prop.line);
  return { projection, line };
}

/** HIGHER | LOWER | PASS — always derived from projection vs line. */
export function resolveProjectionLean(prop = {}) {
  const { projection, line } = resolveProjectionValues(prop);
  if (projection == null || line == null || line <= 0) return "PASS";
  if (Math.abs(projection - line) <= LEAN_PASS_TOLERANCE) return "PASS";
  return projection > line ? "HIGHER" : "LOWER";
}

export function resolveProjectionLeanDisplay(prop = {}) {
  const lean = resolveProjectionLean(prop);
  if (lean === "HIGHER") return "Higher";
  if (lean === "LOWER") return "Lower";
  return "Pass";
}

export function resolveProjectionPickSide(prop = {}) {
  const lean = resolveProjectionLean(prop);
  if (lean === "HIGHER") return "OVER";
  if (lean === "LOWER") return "UNDER";
  return "WATCH";
}

function normalizeLeanToken(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

export function leanMatchesProjection(prop = {}, leanValue = "") {
  const expected = resolveProjectionLean(prop);
  const normalized = normalizeLeanToken(leanValue);
  if (expected === "PASS") return normalized === "PASS" || normalized === "WATCH" || !normalized;
  if (expected === "HIGHER") return ["HIGHER", "OVER", "MORE"].includes(normalized);
  if (expected === "LOWER") return ["LOWER", "UNDER", "LESS"].includes(normalized);
  return false;
}

export function isVerifiedHighestProbabilityPick(prop = {}) {
  return prop.verifiedTier === "A";
}

export function validatePickDirectionBeforeRender(prop = {}, context = "card") {
  const errors = [];
  const { projection, line } = resolveProjectionValues(prop);
  const expectedLean = resolveProjectionLean(prop);
  const displayLean = prop.lean || prop.leanDirection || prop.direction || prop.recommendedSide;

  if (projection != null && line != null && displayLean && !leanMatchesProjection(prop, displayLean)) {
    const message = `Lean "${displayLean}" does not match projection ${projection} vs line ${line} (expected ${expectedLean})`;
    errors.push({ type: "lean_mismatch", message });
    console.error(`[PickDirection] ${context}: ${message}`, {
      player: prop.playerName || prop.player,
      stat: prop.statType || prop.market,
      projection,
      line,
      edge: prop.edge,
      edgePercent: prop.edgePercent,
      lean: displayLean,
      expectedLean,
    });
  }

  const labeledHighest =
    prop.isHighestProbabilityPick === true ||
    /highest probability pick/i.test(String(prop.highestProbabilityLabel || prop.bettingLabel || ""));

  if (labeledHighest && !isVerifiedHighestProbabilityPick(prop)) {
    const message = "Highest probability pick must come from verified plays";
    errors.push({ type: "unverified_highest_probability", message });
    console.error(`[PickDirection] ${context}: ${message}`, {
      player: prop.playerName || prop.player,
      pickTierLabel: prop.pickTierLabel,
      verified: prop.verified,
      verifiedTier: prop.verifiedTier,
    });
  }

  return { valid: errors.length === 0, errors, expectedLean };
}

export function enrichPickDirectionFields(prop = {}) {
  const previousLean = prop.lean || prop.leanDirection || prop.direction;
  const leanDisplay = resolveProjectionLeanDisplay(prop);
  const pickSide = resolveProjectionPickSide(prop);
  const enriched = {
    ...prop,
    lean: leanDisplay,
    leanDirection: pickSide === "WATCH" ? "PASS" : pickSide,
    direction: pickSide === "WATCH" ? "PASS" : pickSide,
    recommendedSide: pickSide === "WATCH" ? "PASS" : pickSide,
    projectionLean: resolveProjectionLean(prop),
  };

  if (previousLean && !leanMatchesProjection(prop, previousLean)) {
    console.error("[PickDirection] enrich: corrected lean to match projection vs line", {
      player: prop.playerName || prop.player,
      previousLean,
      correctedLean: leanDisplay,
      projection: enriched.projection ?? enriched.projectedValue,
      line: enriched.line,
    });
  }

  return enriched;
}

export function formatHitRatePercent(value) {
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const pct = num <= 1 ? Math.round(num * 100) : Math.round(num);
  return `${pct}%`;
}

export function resolveBreakdownTitle(prop = {}) {
  const verifiedTierA = prop.verifiedTier === "A" || classifyVerifiedTier(prop) === "A";

  if (verifiedTierA && prop.isHighestProbabilityPick) {
    return "Highest Probability Pick Breakdown";
  }
  if (verifiedTierA) return "Verified Play Breakdown · Tier A";
  if (prop.verifiedTier === "B") return "Verified Play Breakdown · Tier B";
  if (prop.verifiedTier === "C" || prop.pickTierLabel === "Verified Play") {
    return "Verified Play Breakdown · Tier C";
  }
  if (
    prop.displayResearchOnly ||
    prop.pickTierLabel === "Research Candidate" ||
    /research/i.test(String(prop.bettingLabel || ""))
  ) {
    return "Research Candidate Breakdown";
  }
  return "Prop Breakdown";
}
