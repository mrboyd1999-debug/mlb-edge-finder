import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { getPropVolatilityTier } from "./marketConfidenceModels.js";

export function isPositiveEdge(prop = {}) {
  const edge = Number(prop.edge);
  return Number.isFinite(edge) && edge > 0 && Boolean(prop.bestPick);
}

/**
 * Strict acceptance thresholds — confidence ≥ 58, EV score ≥ 85, DQ ≥ 50,
 * volatility must not be HIGH. Adaptive softening below catches the case
 * where the strict pool is empty so the board never goes to zero.
 */
export const QUALITY_THRESHOLDS = {
  ACCEPTED_MIN_CONFIDENCE: 58,
  VALUE_MIN_CONFIDENCE: 58,
  PLAYABLE_MIN_CONFIDENCE: 60,
  READY_MIN_CONFIDENCE: 62,
  SAFE_MIN_CONFIDENCE: 70,
  TOP_PICK_MIN_CONFIDENCE: 68,
  ELITE_MIN_CONFIDENCE: 75,
  RESEARCH_MAX_CONFIDENCE: 58,
  MIN_MEANINGFUL_EDGE: 0.25,
  HIGH_VOLATILITY_NUM: 4.0,
  SEVERE_VOLATILITY_NUM: 4.75,
  MIN_EV_SCORE: 85,
  MIN_DATA_QUALITY: 50,
  CATASTROPHIC_LINE_MOVE: 1.25,
};

/**
 * Auto-soften thresholds when the strict pool would leave fewer than ~3
 * accepted props. Keeps verified-only protection intact and only loosens the
 * confidence / EV / data-quality floors.
 */
export const RELAXED_THRESHOLDS = {
  ACCEPTED_MIN_CONFIDENCE: 50,
  VALUE_MIN_CONFIDENCE: 50,
  MIN_MEANINGFUL_EDGE: 0.18,
  MIN_EV_SCORE: 40,
  MIN_DATA_QUALITY: 38,
};

export const DYNAMIC_TIER_LABELS = {
  SAFE: "SAFE",
  PLAYABLE: "PLAYABLE",
  VALUE: "VALUE",
  RESEARCH: "RESEARCH",
};

export function confidenceValue(prop = {}) {
  return Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
}

export function edgeValue(prop = {}) {
  return Number(prop.edge ?? prop.modelSignal?.edge ?? 0);
}

export function hasVerifiedStats(prop = {}) {
  return Boolean(prop.hasVerifiedStats || prop.manualEnriched || prop.strongData || prop.verifiedHistory);
}

export function hasMatchupData(prop = {}) {
  if (Number.isFinite(Number(prop.opponentAllowed)) || Number.isFinite(Number(prop.opponentRank))) return true;
  if (prop.handednessMatchup || prop.matchupNote || prop.strikeoutTrend || prop.pitchCountTrend) return true;
  const rating = String(prop.matchupRating || "");
  if (/favorable|tough|playable|neutral|elite|plus|weakness/i.test(rating)) return true;
  if ((Number(prop.sampleSize) || 0) >= 5 && hasVerifiedStats(prop)) return true;
  return false;
}

export function hasNegativeEv(prop = {}, minEvScore = QUALITY_THRESHOLDS.MIN_EV_SCORE) {
  const ev = Number(prop.expectedValue ?? prop.modelSignal?.expectedValue);
  if (Number.isFinite(ev) && ev < -0.05) return true;
  const evScore = Number(prop.expectedValueScore ?? prop.modelSignal?.expectedValueScore);
  if (Number.isFinite(evScore) && evScore < minEvScore) return true;
  return false;
}

export function getDataQualityScore(prop = {}) {
  const dq = Number(prop.dataQualityScore ?? prop.modelSignal?.dataQualityScore);
  return Number.isFinite(dq) ? dq : null;
}

export function hasPositiveEv(prop = {}) {
  return !hasNegativeEv(prop);
}

export function isStaleOrExpiredLine(prop = {}) {
  if (prop.freshnessTier === "EXPIRED") return true;
  if (prop.lineSourceBadge === "STALE" && prop.freshnessTier === "STALE_WARNING") return true;
  return false;
}

export function isResearchOnlyMarket(prop = {}) {
  return Boolean(prop.marketResearchOnly || prop.marketSupportTier === 2 || prop.noveltyMarket);
}

/** LOW | MEDIUM | HIGH — numeric volatility fallback when tier missing. */
export function getVolatilityLabel(prop = {}) {
  const tier = getPropVolatilityTier(prop);
  if (tier === "LOW" || tier === "MEDIUM" || tier === "HIGH") return tier;
  const vol = Number(prop.volatility ?? prop.volatilityScore);
  if (!Number.isFinite(vol)) return "MEDIUM";
  if (vol <= 2.25) return "LOW";
  if (vol <= 3.25) return "MEDIUM";
  return "HIGH";
}

export function volatilitySafetyScore(prop = {}) {
  const label = getVolatilityLabel(prop);
  if (label === "LOW") return 3;
  if (label === "MEDIUM") return 2;
  return 1;
}

export function lineStabilityScore(prop = {}) {
  const tag = String(prop.lineMovementTag || prop.lineMovement?.tag || "").toLowerCase();
  if (prop.lineMovement?.againstPick && tag === "steamed") return 0;
  if (tag === "volatile" || tag === "steamed") return 1;
  if (tag === "stable" || tag === "flat") return 3;
  if (prop.lineMovement?.supportsPick) return 3;
  return 2;
}

/**
 * Dynamic acceptance tier — purely confidence/edge driven label that always returns one of
 * SAFE / PLAYABLE / VALUE / RESEARCH so the UI can show a consistent badge per card.
 */
export function dynamicAcceptanceTier(prop = {}) {
  const conf = confidenceValue(prop);
  const positiveEdge = isPositiveEdge(prop);
  if (conf >= QUALITY_THRESHOLDS.SAFE_MIN_CONFIDENCE) return DYNAMIC_TIER_LABELS.SAFE;
  if (conf >= QUALITY_THRESHOLDS.PLAYABLE_MIN_CONFIDENCE && positiveEdge) return DYNAMIC_TIER_LABELS.PLAYABLE;
  if (conf >= QUALITY_THRESHOLDS.VALUE_MIN_CONFIDENCE && positiveEdge) return DYNAMIC_TIER_LABELS.VALUE;
  return DYNAMIC_TIER_LABELS.RESEARCH;
}

/** Slight downward line movement is fine as long as projection edge remains positive. */
function lineMovementBlocksAcceptance(prop = {}) {
  const movementTag = String(prop.lineMovementTag || prop.lineMovement?.tag || "").toLowerCase();
  if (!movementTag) return false;
  if (movementTag !== "steamed") return false;
  if (!prop.lineMovement?.againstPick) return false;
  const delta = Math.abs(Number(prop.lineMovement?.delta ?? prop.lineMovement?.change ?? 0));
  if (delta < QUALITY_THRESHOLDS.CATASTROPHIC_LINE_MOVE) return false;
  if (isPositiveEdge(prop) && edgeValue(prop) >= 0.6) return false;
  return true;
}

/**
 * Strict accepted-prop quality gates:
 *   confidence ≥ ACCEPTED_MIN_CONFIDENCE (58)
 *   EV score ≥ MIN_EV_SCORE (85)
 *   data quality ≥ MIN_DATA_QUALITY (50)
 *   volatility label not HIGH
 *   verified live line + not expired/research-only
 *
 * Callers can override individual floors via `options` (used by the adaptive
 * softening loop in `filterAcceptedQualityProps` to backfill the board if the
 * strict pool would otherwise be empty).
 */
export function meetsAcceptedPropQuality(prop = {}, options = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (isStaleOrExpiredLine(prop)) return false;

  const minConfidence = options.minConfidence ?? QUALITY_THRESHOLDS.ACCEPTED_MIN_CONFIDENCE;
  if (confidenceValue(prop) < minConfidence) return false;

  if (!isPositiveEdge(prop)) {
    if (confidenceValue(prop) < QUALITY_THRESHOLDS.SAFE_MIN_CONFIDENCE) return false;
  } else if (edgeValue(prop) < (options.minEdge ?? QUALITY_THRESHOLDS.MIN_MEANINGFUL_EDGE)) {
    return false;
  }

  if (isResearchOnlyMarket(prop) && confidenceValue(prop) < QUALITY_THRESHOLDS.SAFE_MIN_CONFIDENCE) return false;

  const vol = Number(prop.volatility);
  if (Number.isFinite(vol) && vol >= QUALITY_THRESHOLDS.SEVERE_VOLATILITY_NUM) return false;

  // HIGH volatility blocks acceptance unless confidence is in the elite band.
  if (getVolatilityLabel(prop) === "HIGH" && confidenceValue(prop) < QUALITY_THRESHOLDS.ELITE_MIN_CONFIDENCE) {
    return false;
  }

  const minEv = options.minEvScore ?? QUALITY_THRESHOLDS.MIN_EV_SCORE;
  if (hasNegativeEv(prop, minEv)) {
    // Elite confidence can still rescue a sub-EV prop.
    if (confidenceValue(prop) < QUALITY_THRESHOLDS.ELITE_MIN_CONFIDENCE) return false;
  }

  const minDq = options.minDataQuality ?? QUALITY_THRESHOLDS.MIN_DATA_QUALITY;
  const dq = getDataQualityScore(prop);
  if (Number.isFinite(dq) && dq < minDq) return false;

  return !lineMovementBlocksAcceptance(prop);
}

export function meetsReadyToBetQuality(prop = {}, options = {}) {
  if (!meetsAcceptedPropQuality(prop, options)) return false;
  if (confidenceValue(prop) < (options.readyMin ?? QUALITY_THRESHOLDS.READY_MIN_CONFIDENCE)) return false;
  return true;
}

export function meetsTopPickQuality(prop = {}, options = {}) {
  if (!meetsReadyToBetQuality(prop, options)) return false;
  if (confidenceValue(prop) < (options.topMin ?? QUALITY_THRESHOLDS.TOP_PICK_MIN_CONFIDENCE)) return false;
  if (lineStabilityScore(prop) < 1) return false;
  if (getVolatilityLabel(prop) === "HIGH" && confidenceValue(prop) < QUALITY_THRESHOLDS.SAFE_MIN_CONFIDENCE + 5) return false;
  return edgeValue(prop) >= 0.3 || confidenceValue(prop) >= QUALITY_THRESHOLDS.ELITE_MIN_CONFIDENCE;
}

/** Sort: confidence → edge → volatility safety → line stability. */
export function comparePropQuality(a = {}, b = {}) {
  const confDelta = confidenceValue(b) - confidenceValue(a);
  if (confDelta !== 0) return confDelta;
  const edgeDelta = edgeValue(b) - edgeValue(a);
  if (edgeDelta !== 0) return edgeDelta;
  const volDelta = volatilitySafetyScore(b) - volatilitySafetyScore(a);
  if (volDelta !== 0) return volDelta;
  return lineStabilityScore(b) - lineStabilityScore(a);
}

/**
 * Auto-soften acceptance when the strict pool would leave fewer than 3 props.
 * Keeps verified-only protection, just lowers confidence / edge / EV / DQ
 * floors progressively. Level 3 falls all the way back to RELAXED_THRESHOLDS.
 */
function relaxedOptions(level = 0) {
  if (level <= 0) return {};
  if (level === 1) {
    return {
      minConfidence: 54,
      minEdge: 0.22,
      minEvScore: 70,
      minDataQuality: 45,
    };
  }
  if (level === 2) {
    return {
      minConfidence: 50,
      minEdge: 0.2,
      minEvScore: 55,
      minDataQuality: 42,
    };
  }
  return {
    minConfidence: RELAXED_THRESHOLDS.ACCEPTED_MIN_CONFIDENCE,
    minEdge: RELAXED_THRESHOLDS.MIN_MEANINGFUL_EDGE,
    minEvScore: RELAXED_THRESHOLDS.MIN_EV_SCORE,
    minDataQuality: RELAXED_THRESHOLDS.MIN_DATA_QUALITY,
  };
}

export function filterAcceptedQualityProps(props = [], options = {}) {
  const cleaned = (props || []).filter(Boolean);
  let accepted = cleaned.filter((prop) => meetsAcceptedPropQuality(prop, options)).sort(comparePropQuality);
  if (accepted.length >= 3 || options.skipAutoSoften) return accepted;

  for (let level = 1; level <= 3 && accepted.length < 5; level += 1) {
    const merged = { ...options, ...relaxedOptions(level) };
    accepted = cleaned.filter((prop) => meetsAcceptedPropQuality(prop, merged)).sort(comparePropQuality);
  }
  return accepted;
}

export function filterReadyQualityProps(props = [], limit = 20, options = {}) {
  const accepted = filterAcceptedQualityProps(props, options);
  let ready = accepted.filter((prop) => meetsReadyToBetQuality(prop, options));
  if (ready.length < 5 && accepted.length) {
    ready = accepted.slice(0, Math.min(limit, Math.max(5, accepted.length)));
  }
  return ready.slice(0, limit);
}

export function filterTopPickQualityProps(props = [], limit = 2, options = {}) {
  const cleaned = (props || []).filter(Boolean);
  const strict = cleaned.filter((prop) => meetsTopPickQuality(prop, options)).sort(comparePropQuality);
  if (strict.length >= limit) return strict.slice(0, limit);
  const relaxed = filterReadyQualityProps(cleaned, limit * 4, options).sort(comparePropQuality);
  if (relaxed.length >= limit) return relaxed.slice(0, limit);
  const fallback = filterAcceptedQualityProps(cleaned, options);
  return fallback.slice(0, limit);
}
