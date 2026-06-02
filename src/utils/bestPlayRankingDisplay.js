import { resolvePickSide as resolvePickSideLegacy } from "./pickRecommendation.js";
import { hasValidProjection } from "./propValidation.js";

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function readPropMultiplier(prop = {}) {
  const side = resolvePickSideLegacy(prop);
  const options = prop.streakOptions || [];
  const match = options.find((opt) => {
    const label = String(opt.side || opt.label || "").toLowerCase();
    if (side === "OVER") return label.includes("higher") || label.includes("over") || label.includes("more");
    if (side === "UNDER") return label.includes("lower") || label.includes("under") || label.includes("less");
    return false;
  });
  const mult = Number(match?.multiplier ?? prop.multiplier ?? prop.payout ?? prop.payoutMultiplier);
  return Number.isFinite(mult) && mult > 0 && mult !== 1 ? mult : null;
}

export function readPropProbability(prop = {}) {
  if (!hasValidProjection(prop)) return null;
  const evaluation = prop.sideEvaluation;
  if (evaluation?.confidence != null) return Math.round(evaluation.confidence);
  const conf = finiteOr(prop.confidenceScore ?? prop.confidence, null);
  if (Number.isFinite(conf) && conf !== 50) return Math.round(conf);
  const options = prop.streakOptions || [];
  const side = resolvePickSideLegacy(prop);
  const match = options.find((opt) => {
    const label = String(opt.side || opt.label || "").toLowerCase();
    if (side === "OVER") return label.includes("higher") || label.includes("over") || label.includes("more");
    return label.includes("lower") || label.includes("under") || label.includes("less");
  });
  const rawProb = Number(match?.rawProbability);
  if (Number.isFinite(rawProb) && rawProb > 0 && rawProb <= 1) return Math.round(rawProb * 100);
  return null;
}
