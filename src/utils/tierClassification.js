/**
 * Tier classification — metric-based A/B/C with soft caps (not hard C demotions).
 */

import { PITCHER_VERIFICATION, resolvePitcherVerification } from "./opponentStarter.js";
import { isInflatedProbabilityProp } from "./probabilityIntegrity.js";
import { hasAggressiveProjectionWarning } from "./projectionSanity.js";
import {
  resolveVerificationStatus,
  VERIFICATION_STATUS,
} from "./verificationStatus.js";

export const TIER_A_METRICS = { confidence: 72, probability: 70 };
export const ELITE_TIER_METRICS = { confidence: 72, probability: 70 };
/** Playable tier — probability >= 65, confidence >= 68 */
export const TIER_B_METRICS = { confidence: 68, probability: 65 };
export const TIER_C_METRICS = { confidence: 62, probability: 60 };
export const RESEARCH_TIER_METRICS = { confidence: 62 };
/** Best Plays board — same thresholds as Tier B */
export const BEST_PLAYS_BOARD_MIN = { confidence: 68, probability: 65 };
export const BEST_PLAY_DISPLAY_MIN = BEST_PLAYS_BOARD_MIN;
export const PITCHER_PENDING_CONFIDENCE_PENALTY = 1;
export const PITCHER_UNAVAILABLE_CONFIDENCE_PENALTY = 2;

function finite(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatMetric(value) {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value * 10) / 10;
}

export function resolveSideForTier(prop = {}) {
  const side = String(prop.recommendedSide || prop.lean || prop.pick || prop.side || "").toUpperCase();
  if (side.includes("UNDER") || side.includes("LESS")) return "UNDER";
  if (side.includes("OVER") || side.includes("MORE")) return "OVER";
  const projection = finite(prop.projection ?? prop.projectedValue);
  const line = finite(prop.line);
  if (Number.isFinite(projection) && Number.isFinite(line) && projection !== line) {
    return projection > line ? "OVER" : "UNDER";
  }
  return "PASS";
}

export function resolvePropConfidence(prop = {}) {
  return finite(
    prop.finalConfidence ??
      prop.displayConfidenceScore ??
      prop.confidenceScore ??
      prop.confidence
  );
}

export function resolvePropProbability(prop = {}) {
  return finite(prop.finalProbability ?? prop.probabilityScore ?? prop.verifiedProbability);
}

/** Apply post-penalty SSOT metrics used by tier gates and Best Plays display. */
export function attachFinalPlayMetrics(prop = {}, { confidence, probability } = {}) {
  const finalConfidence = finite(confidence ?? resolvePropConfidence(prop));
  const finalProbability = finite(probability ?? resolvePropProbability(prop));
  return {
    ...prop,
    ...(Number.isFinite(finalConfidence)
      ? {
          finalConfidence,
          displayConfidenceScore: finalConfidence,
          confidenceScore: finalConfidence,
          confidence: finalConfidence,
        }
      : {}),
    ...(Number.isFinite(finalProbability)
      ? {
          finalProbability,
          probabilityScore: finalProbability,
          verifiedProbability: finalProbability,
        }
      : {}),
  };
}

export function applyPitcherPendingMetricPenalty(prop = {}) {
  const verification =
    prop.pitcherVerification || resolvePitcherVerification(prop).pitcherVerification;
  const status = String(prop.pitcherStatus || "").toLowerCase();
  let penalty = 0;
  if (status === "unavailable" || status === "unknown") {
    penalty = PITCHER_UNAVAILABLE_CONFIDENCE_PENALTY;
  } else if (status === "pending" || verification === PITCHER_VERIFICATION.PENDING) {
    penalty = PITCHER_PENDING_CONFIDENCE_PENALTY;
  } else if (verification === PITCHER_VERIFICATION.PENDING) {
    penalty = PITCHER_PENDING_CONFIDENCE_PENALTY;
  }
  if (!penalty) return prop;
  const confidence = resolvePropConfidence(prop);
  if (!Number.isFinite(confidence)) return prop;
  const penalized = Math.max(0, confidence - penalty);
  return attachFinalPlayMetrics(prop, { confidence: penalized });
}

export function hasPositiveEdge(prop = {}) {
  const edge = finite(prop.edge);
  const side = resolveSideForTier(prop);
  if (Number.isFinite(edge)) {
    if (side === "OVER") return edge > 0;
    if (side === "UNDER") return edge < 0;
    return edge !== 0;
  }
  const line = finite(prop.line);
  const projection = finite(prop.projection ?? prop.projectedValue);
  if (!Number.isFinite(line) || !Number.isFinite(projection) || side === "PASS") return false;
  if (side === "OVER") return projection > line;
  if (side === "UNDER") return projection < line;
  return false;
}

export function hasTierBasics(prop = {}) {
  const line = finite(prop.line);
  const projection = finite(prop.projection ?? prop.projectedValue);
  const side = resolveSideForTier(prop);
  return Number.isFinite(line) && line > 0 && Number.isFinite(projection) && projection > 0 && side !== "PASS";
}

export function hasAllowedVerification(prop = {}) {
  const status = prop.verificationStatus || resolveVerificationStatus(prop);
  return (
    status === VERIFICATION_STATUS.FULL ||
    status === VERIFICATION_STATUS.PARTIAL ||
    status === VERIFICATION_STATUS.RESEARCH
  );
}

export function isMissingSeasonSource(prop = {}) {
  if (prop.seasonRateValid) return false;
  const seasonLabel = prop.hitRateSnapshot?.seasonLabel ?? prop.seasonHitRate;
  if (seasonLabel == null || seasonLabel === "" || seasonLabel === "—" || seasonLabel === "0%") return true;
  return finite(prop.seasonHitRate) == null && finite(prop.seasonGamesPlayed ?? prop.seasonGames) == null;
}

export function applyTierCaps(prop = {}, tier = "C") {
  if (tier === "A" && hasAggressiveProjectionWarning(prop)) return "B";
  return tier;
}

export function passesResearchPlayThresholds(prop = {}) {
  if (!hasTierBasics(prop)) return false;
  if (!hasPositiveEdge(prop)) return false;
  const status = prop.verificationStatus || resolveVerificationStatus(prop);
  if (status === VERIFICATION_STATUS.UNVERIFIED) return false;
  if (
    status !== VERIFICATION_STATUS.FULL &&
    status !== VERIFICATION_STATUS.PARTIAL &&
    status !== VERIFICATION_STATUS.RESEARCH
  ) {
    return false;
  }
  const confidence = resolvePropConfidence(prop);
  return Number.isFinite(confidence) && confidence >= RESEARCH_TIER_METRICS.confidence;
}

export function resolvePlayCategory(prop = {}) {
  if (isInflatedProbabilityProp(prop)) return "RESEARCH";
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  if (!Number.isFinite(confidence) || !Number.isFinite(probability)) return "RESEARCH";
  if (confidence >= ELITE_TIER_METRICS.confidence && probability >= ELITE_TIER_METRICS.probability) {
    return "ELITE";
  }
  if (confidence >= BEST_PLAYS_BOARD_MIN.confidence && probability >= BEST_PLAYS_BOARD_MIN.probability) {
    return "BEST";
  }
  if (confidence >= TIER_B_METRICS.confidence && probability >= TIER_B_METRICS.probability) {
    return "PLAYABLE";
  }
  return "RESEARCH";
}

export function resolvePlayCategoryLabel(prop = {}) {
  const tier = classifyPropTier(prop);
  if (tier === "A") return "Elite";
  if (tier === "B") return "Best Play";
  if (tier === "C") return "Research";
  const category = resolvePlayCategory(prop);
  if (category === "ELITE") return "Elite";
  if (category === "BEST") return "Best Play";
  if (category === "PLAYABLE") return "Playable";
  return "Research";
}

export function classifyPropTier(prop = {}) {
  if (isInflatedProbabilityProp(prop)) return null;
  if (!hasTierBasics(prop)) return null;
  if (!hasPositiveEdge(prop)) return null;

  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const status = prop.verificationStatus || resolveVerificationStatus(prop);

  if (confidence >= TIER_A_METRICS.confidence && probability >= TIER_A_METRICS.probability) {
    if (status === VERIFICATION_STATUS.FULL || status === VERIFICATION_STATUS.PARTIAL) {
      if (hasAggressiveProjectionWarning(prop)) {
        return applyTierCaps(prop, "B");
      }
      return applyTierCaps(prop, "A");
    }
  }
  if (confidence >= TIER_B_METRICS.confidence && probability >= TIER_B_METRICS.probability) {
    if (status === VERIFICATION_STATUS.FULL || status === VERIFICATION_STATUS.PARTIAL) {
      return applyTierCaps(prop, "B");
    }
  }
  if (confidence >= TIER_C_METRICS.confidence && probability >= TIER_C_METRICS.probability) {
    return "C";
  }
  return null;
}

export function getTierAFailures(prop = {}) {
  const failures = [];
  if (!hasTierBasics(prop)) failures.push("missing line, projection, or recommended side");
  if (!hasAllowedVerification(prop)) {
    failures.push(`verificationStatus ${prop.verificationStatus || resolveVerificationStatus(prop) || "UNVERIFIED"}`);
  }
  if (!hasPositiveEdge(prop)) failures.push("edge is not positive for recommended side");
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  if (confidence < TIER_A_METRICS.confidence) {
    failures.push(`confidence ${formatMetric(confidence)} < ${TIER_A_METRICS.confidence}`);
  }
  if (probability < TIER_A_METRICS.probability) {
    failures.push(`probability ${formatMetric(probability)} < ${TIER_A_METRICS.probability}`);
  }
  const capped = applyTierCaps(prop, "A");
  if (capped !== "A") failures.push("capped below Tier A after review");
  return failures;
}

export function getTierBFailures(prop = {}) {
  const failures = [];
  if (!hasTierBasics(prop)) failures.push("missing line, projection, or recommended side");
  if (!hasAllowedVerification(prop)) {
    failures.push(`verificationStatus ${prop.verificationStatus || resolveVerificationStatus(prop) || "UNVERIFIED"}`);
  }
  if (!hasPositiveEdge(prop)) failures.push("edge is not positive for recommended side");
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  if (confidence < TIER_B_METRICS.confidence) {
    failures.push(`confidence ${formatMetric(confidence)} < ${TIER_B_METRICS.confidence}`);
  }
  if (probability < TIER_B_METRICS.probability) {
    failures.push(`probability ${formatMetric(probability)} < ${TIER_B_METRICS.probability}`);
  }
  const capped = applyTierCaps(prop, "B");
  if (capped === "C") {
    const pitcherVerification =
      prop.pitcherVerification || resolvePitcherVerification(prop).pitcherVerification;
    if (pitcherVerification === PITCHER_VERIFICATION.FAIL) {
      failures.push("capped at C: pitcherVerification FAIL with invalid lookup data");
    }
  }
  return failures;
}

export function passesBestPlayDisplayGate(prop = {}) {
  if (!hasAllowedVerification(prop)) return false;
  if (!hasPositiveEdge(prop)) return false;
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  if (!Number.isFinite(confidence) || confidence < BEST_PLAYS_BOARD_MIN.confidence) return false;
  if (!Number.isFinite(probability) || probability < BEST_PLAYS_BOARD_MIN.probability) return false;
  return true;
}

export function buildTierDebugSummary(pool = []) {
  const rows = pool || [];
  const counts = { tierA: 0, tierB: 0, tierC: 0 };
  const capSamples = [];

  for (const prop of rows) {
    const tier = classifyPropTier(prop);
    if (tier === "A") counts.tierA += 1;
    else if (tier === "B") counts.tierB += 1;
    else counts.tierC += 1;

    const rawTier =
      hasTierBasics(prop) && hasAllowedVerification(prop) && hasPositiveEdge(prop)
        ? resolvePropConfidence(prop) >= TIER_A_METRICS.confidence &&
            resolvePropProbability(prop) >= TIER_A_METRICS.probability
          ? "A"
          : resolvePropConfidence(prop) >= TIER_B_METRICS.confidence &&
              resolvePropProbability(prop) >= TIER_B_METRICS.probability
            ? "B"
            : "C"
        : "C";

    if (rawTier !== tier && capSamples.length < 8) {
      capSamples.push({
        player: prop.playerName || prop.player || "Unknown",
        market: prop.statType || prop.propType || prop.market || "—",
        rawTier,
        finalTier: tier,
        reason: tier === "B" && rawTier === "A" ? getTierAFailures(prop).slice(-2).join("; ") : getTierBFailures(prop).slice(-1).join("; "),
      });
    }
  }

  return { ...counts, capSamples };
}
