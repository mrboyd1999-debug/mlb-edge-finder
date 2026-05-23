import { CONFIDENCE_THRESHOLDS } from "./confidenceEngine.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { getMlbQualityTierWeight } from "../utils/mlbOnlyMode.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickDirection(prop = {}) {
  return prop.bestPick || prop.pick || prop.pickDirection || prop.side || "";
}

function confidenceValue(prop = {}) {
  return Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
}

function hasUsableProjection(prop = {}) {
  if (Number.isFinite(finiteNumber(prop.projectedValue ?? prop.projection))) return true;
  if (prop.projectionSource && prop.projectionSource !== "missing") return true;
  if (prop.sportsbookComparison || prop.lineComparison) return true;
  if (prop.isQualificationAccepted) return true;
  if (prop.qualificationTier && prop.qualificationTier !== "reject") return true;
  return false;
}

/** Only block Top Picks output for true safety failures — not elite-tier preferences. */
export function explainTopPickRejection(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return "unverified";
  if (prop.freshnessTier === "EXPIRED") return "stale cache";
  const status = String(prop.status || "").toLowerCase();
  if (["live", "expired", "locked"].includes(status)) return `status ${status}`;
  if (Number(prop.edge || 0) <= 0) return "no positive edge";
  if (!pickDirection(prop)) return "missing pick direction";
  if (confidenceValue(prop) < CONFIDENCE_THRESHOLDS.PLAYABLE) return "below playable confidence";
  if (!hasUsableProjection(prop)) return "broken projection";

  const vol = finiteNumber(prop.volatility);
  if (Number.isFinite(vol) && vol >= 5) return "severe volatility";

  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (prop.lineMovement?.againstPick && movementTag === "steamed") {
    const delta = Math.abs(Number(prop.lineMovement?.delta ?? prop.lineMovement?.change ?? 0));
    if (delta >= 1) return "catastrophic line movement";
  }

  return "";
}

export function isTopPickOutputEligible(prop = {}) {
  return explainTopPickRejection(prop) === "";
}

function volatilityPenalty(prop = {}) {
  const vol = finiteNumber(prop.volatility);
  if (!Number.isFinite(vol)) return 0;
  if (vol >= 4) return 10;
  if (vol >= 3.5) return 7;
  if (vol >= 3) return 4;
  if (vol >= 2.75) return 2;
  return 0;
}

function lineMovementPenalty(prop = {}) {
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (prop.lineMovement?.againstPick) return 6;
  if (movementTag === "steamed") return 5;
  if (movementTag === "volatile") return 3;
  return 0;
}

/** Output-only weighted score for final Top 2 ranking. */
export function computeTopPickWeightedScore(prop = {}) {
  const confidence = confidenceValue(prop);
  const edge = Number(prop.edge || 0);
  const marketReliability = Number(prop.marketReliabilityScore ?? 50);
  const projection = finiteNumber(prop.projectedValue ?? prop.projection);
  const line = finiteNumber(prop.line);
  let projectionStrength = 0;
  if (Number.isFinite(projection) && Number.isFinite(line) && line > 0) {
    projectionStrength = clamp((Math.abs(projection - line) / line) * 20, 0, 12);
  }

  const volPenalty = volatilityPenalty(prop);
  const movePenalty = lineMovementPenalty(prop);

  let score =
    confidence +
    clamp(edge * 6, 0, 18) +
    projectionStrength +
    (marketReliability - 50) * 0.12 +
    getMlbQualityTierWeight(prop) * 6;
  score -= volPenalty + movePenalty;

  return round(clamp(score, 0, 100), 1);
}

/** Elite > Strong > Playable priority for fallback ordering. */
export function topPickConfidenceBand(prop = {}) {
  const confidence = confidenceValue(prop);
  if (confidence >= CONFIDENCE_THRESHOLDS.ELITE) return 3;
  if (confidence >= CONFIDENCE_THRESHOLDS.STRONG) return 2;
  if (confidence >= CONFIDENCE_THRESHOLDS.PLAYABLE) return 1;
  return 0;
}

function rankTopPick(a = {}, b = {}) {
  const bandDelta = topPickConfidenceBand(b) - topPickConfidenceBand(a);
  if (bandDelta !== 0) return bandDelta;
  const scoreDelta = Number(b.topPickWeightedScore || 0) - Number(a.topPickWeightedScore || 0);
  if (scoreDelta !== 0) return scoreDelta;
  return confidenceValue(b) - confidenceValue(a) || Number(b.edge || 0) - Number(a.edge || 0);
}

function annotateTopPick(prop = {}, fallback = false) {
  return {
    ...prop,
    topPickWeightedScore: computeTopPickWeightedScore(prop),
    topPickConfidenceBand: topPickConfidenceBand(prop),
    topPickFallback: fallback,
  };
}

/**
 * Final Top 2 output selection from accepted props only.
 * Never returns empty when accepted props exist unless all fail hard safety checks.
 */
export function selectTopPicks(acceptedProps = [], limit = 2) {
  const pool = Array.isArray(acceptedProps) ? acceptedProps.filter(Boolean) : [];
  const rejectedTopPickReasons = [];
  const eligible = [];

  pool.forEach((prop) => {
    const reason = explainTopPickRejection(prop);
    if (reason) {
      rejectedTopPickReasons.push({
        id: prop.id,
        playerName: prop.playerName,
        statType: prop.statType,
        confidence: confidenceValue(prop),
        reason,
      });
      return;
    }
    eligible.push(annotateTopPick(prop, false));
  });

  let ranked = [...eligible].sort(rankTopPick);

  if (!ranked.length && pool.length) {
    const fallback = pool
      .filter((prop) => isVerifiedSportsbookProp(prop) && confidenceValue(prop) >= CONFIDENCE_THRESHOLDS.PLAYABLE && Number(prop.edge || 0) > 0)
      .map((prop) => annotateTopPick(prop, true))
      .sort(rankTopPick);
    ranked = fallback;
    if (fallback.length) {
      rejectedTopPickReasons.push({
        note: "playable fallback used because strict output gate rejected all candidates",
        count: fallback.length,
      });
    }
  }

  const topPicks = ranked.slice(0, limit);

  if (!topPicks.length && pool.length) {
    const lastResort = pool
      .map((prop) => annotateTopPick(prop, true))
      .sort((a, b) => confidenceValue(b) - confidenceValue(a) || Number(b.edge || 0) - Number(a.edge || 0))
      .slice(0, limit);
    topPicks.push(...lastResort);
    rejectedTopPickReasons.push({ note: "last-resort accepted props used to avoid empty Top Picks board", count: lastResort.length });
  }

  console.log("TOP PICK CANDIDATES", pool);
  console.log("FINAL TOP PICKS", topPicks);
  console.log("TOP PICK REJECTION REASONS", rejectedTopPickReasons);

  return topPicks;
}
