/**
 * Tier classification — metric-based A/B/C with soft caps (not hard C demotions).
 */

import { PITCHER_VERIFICATION, resolvePitcherVerification } from "./opponentStarter.js";
import {
  resolveVerificationStatus,
  VERIFICATION_STATUS,
} from "./verificationStatus.js";

export const TIER_A_METRICS = { confidence: 80, probability: 70 };
export const ELITE_TIER_METRICS = { confidence: 75, probability: 70 };
/** Playable tier — probability >= 60, confidence >= 68 */
export const TIER_B_METRICS = { confidence: 68, probability: 60 };
export const RESEARCH_TIER_METRICS = { confidence: 65 };
/** Best Plays board — stricter than Playable; below this stays on MLB Props only */
export const BEST_PLAYS_BOARD_MIN = { confidence: 70, probability: 62 };
export const BEST_PLAY_DISPLAY_MIN = BEST_PLAYS_BOARD_MIN;

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
  return finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence);
}

export function resolvePropProbability(prop = {}) {
  return finite(prop.probabilityScore ?? prop.verifiedProbability);
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
  return status === VERIFICATION_STATUS.FULL || status === VERIFICATION_STATUS.PARTIAL;
}

export function isMissingSeasonSource(prop = {}) {
  if (prop.seasonRateValid) return false;
  const seasonLabel = prop.hitRateSnapshot?.seasonLabel ?? prop.seasonHitRate;
  if (seasonLabel == null || seasonLabel === "" || seasonLabel === "—" || seasonLabel === "0%") return true;
  return finite(prop.seasonHitRate) == null && finite(prop.seasonGamesPlayed ?? prop.seasonGames) == null;
}

export function applyTierCaps(prop = {}, tier = "C") {
  let capped = tier;
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const pitcherVerification =
    prop.pitcherVerification || resolvePitcherVerification(prop).pitcherVerification;

  if (isMissingSeasonSource(prop) && capped === "A") {
    capped = "B";
  }

  if (pitcherVerification === PITCHER_VERIFICATION.FAIL) {
    if (confidence < TIER_B_METRICS.confidence || probability < TIER_B_METRICS.probability) {
      return "C";
    }
    if (capped === "A") capped = "B";
  }

  return capped;
}

export function passesResearchPlayThresholds(prop = {}) {
  if (!hasTierBasics(prop)) return false;
  if (!hasPositiveEdge(prop)) return false;
  const status = prop.verificationStatus || resolveVerificationStatus(prop);
  if (status === VERIFICATION_STATUS.UNVERIFIED) return false;
  if (status !== VERIFICATION_STATUS.FULL && status !== VERIFICATION_STATUS.PARTIAL) return false;
  const confidence = resolvePropConfidence(prop);
  return Number.isFinite(confidence) && confidence >= RESEARCH_TIER_METRICS.confidence;
}

export function resolvePlayCategory(prop = {}) {
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
  const category = resolvePlayCategory(prop);
  if (category === "ELITE") return "Elite";
  if (category === "BEST") return "Best Play";
  if (category === "PLAYABLE") return "Playable";
  return "Research";
}

export function classifyPropTier(prop = {}) {
  if (!hasTierBasics(prop)) return "C";
  if (!hasAllowedVerification(prop)) return "C";
  if (!hasPositiveEdge(prop)) return "C";

  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);

  let tier = "C";
  if (confidence >= TIER_A_METRICS.confidence && probability >= TIER_A_METRICS.probability) {
    tier = "A";
  } else if (confidence >= TIER_B_METRICS.confidence && probability >= TIER_B_METRICS.probability) {
    tier = "B";
  }

  if (tier === "C") return "C";
  return applyTierCaps(prop, tier);
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
  if (capped === "B") {
    if (isMissingSeasonSource(prop)) failures.push("capped at B: missing season source");
    const pitcherVerification =
      prop.pitcherVerification || resolvePitcherVerification(prop).pitcherVerification;
    if (pitcherVerification === PITCHER_VERIFICATION.FAIL) failures.push("capped at B: pitcherVerification FAIL");
  }
  if (capped === "C") {
    failures.push("capped at C after applying pitcher/season caps");
  }
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
      failures.push("capped at C: pitcherVerification FAIL with confidence < 68 or probability < 60");
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
