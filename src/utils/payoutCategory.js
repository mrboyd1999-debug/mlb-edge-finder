/**
 * Goblin / Standard / Demon payout category badges.
 */

import { resolvePropConfidence, resolvePropProbability, hasPositiveEdge } from "./tierClassification.js";

export const PAYOUT_GOBLIN = "GOBLIN";
export const PAYOUT_STANDARD = "STANDARD";
export const PAYOUT_DEMON = "DEMON";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isLowOrMediumRisk(prop = {}) {
  const risk = String(prop.riskLevel || "").toUpperCase();
  return risk === "LOW" || risk === "MEDIUM" || !risk;
}

function isHighVariance(prop = {}) {
  const risk = String(prop.riskLevel || "").toUpperCase();
  if (risk === "HIGH") return true;
  return Boolean(
    prop.projectionOutlierDetected ||
      prop.projectionSanityStatus === "outlier" ||
      prop.projectionLargeEdgeWarning
  );
}

export function resolvePayoutCategory(prop = {}) {
  const probability = resolvePropProbability(prop);
  const confidence = resolvePropConfidence(prop);
  const edge = finite(prop.edge);
  const line = finite(prop.line);
  const projection = finite(prop.projection ?? prop.projectedValue);

  if (!Number.isFinite(probability) || !Number.isFinite(confidence)) return null;
  if (!hasPositiveEdge(prop)) return null;
  if (!Number.isFinite(line) || line <= 0 || !Number.isFinite(projection) || projection <= 0) return null;

  if (
    probability >= 72 &&
    confidence >= 72 &&
    edge > 0 &&
    isLowOrMediumRisk(prop)
  ) {
    return PAYOUT_GOBLIN;
  }

  if (probability >= 65 && confidence >= 68 && edge > 0) {
    return PAYOUT_STANDARD;
  }

  if (probability >= 60 && confidence >= 65 && edge > 0 && isHighVariance(prop)) {
    return PAYOUT_DEMON;
  }

  if (probability >= 65 && confidence >= 68) {
    return PAYOUT_STANDARD;
  }

  return null;
}

export function resolvePayoutCategoryLabel(prop = {}) {
  const category = resolvePayoutCategory(prop);
  if (category === PAYOUT_GOBLIN) return "Goblin";
  if (category === PAYOUT_STANDARD) return "Standard";
  if (category === PAYOUT_DEMON) return "Demon";
  return null;
}

export function isSafestPayoutEligible(prop = {}) {
  const category = resolvePayoutCategory(prop);
  if (category === PAYOUT_DEMON) {
    const probability = resolvePropProbability(prop);
    const confidence = resolvePropConfidence(prop);
    return probability >= 70 && confidence >= 70;
  }
  return category === PAYOUT_GOBLIN || category === PAYOUT_STANDARD;
}

export function attachPayoutCategoryFields(prop = {}) {
  const payoutCategory = resolvePayoutCategory(prop);
  return {
    ...prop,
    payoutCategory,
    payoutCategoryLabel: resolvePayoutCategoryLabel({ ...prop, payoutCategory }),
    safestPayoutEligible: isSafestPayoutEligible({ ...prop, payoutCategory }),
  };
}
