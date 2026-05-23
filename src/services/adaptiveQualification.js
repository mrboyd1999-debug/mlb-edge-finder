import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { getMarketReadyThreshold } from "./marketThresholds.js";
import { getPropVolatilityTier } from "./marketConfidenceModels.js";
import {
  hasValidPickFields,
  isPositiveEdge,
} from "./pickScoring.js";
import { shouldRouteMlbHitterToResearch } from "./mlbHitterConfidence.js";
import { getMlbQualityTier } from "../utils/mlbOnlyMode.js";
import { meetsAcceptedPropQuality, hasPositiveEv, hasMatchupData } from "./propQualityGates.js";

export const QUALIFICATION_TIERS = {
  ELITE: "elite",
  STRONG: "strong",
  NEAR_MISS: "nearMiss",
  WATCHLIST: "watchlist",
  REJECT: "reject",
};

export const QUALIFICATION_TIER_LABELS = {
  elite: "Elite",
  strong: "Strong",
  nearMiss: "Near Miss",
  watchlist: "Watchlist",
  reject: "Reject",
};

const DEFAULT_TIER_THRESHOLDS = {
  elite: 75,
  strong: 65,
  nearMiss: 58,
  watchlist: 50,
};

/** Playable confidence floor for accepted props. */
export const PLAYABLE_CONFIDENCE_MIN = 60;
export const TIER3_CONFIDENCE_MIN = 68;

/** Soft penalties stack — concerns reduce score; only extreme stacks cap to watchlist. */
const SOFT_PENALTY_HARD_REJECT = 32;

const METRIC_WEIGHTS = {
  matchupQuality: 0.18,
  recentForm: 0.14,
  consistency: 0.12,
  lineStability: 0.1,
  edge: 0.16,
  volatility: 0.1,
  projectionConfidence: 0.12,
  verifiedStatsQuality: 0.08,
};

/** Market-specific qualification intelligence — adjusts metric tolerance, not hard gates. */
const MARKET_QUALIFICATION_RULES = {
  strikeouts: {
    verifiedStatsWeight: 1.25,
    minVerifiedStatsScore: 52,
    volatilityTolerance: 1.15,
    lineMovementPenaltyScale: 0.55,
    requiresPitcherVerification: true,
  },
  outs: { verifiedStatsWeight: 1.2, minVerifiedStatsScore: 52, volatilityTolerance: 1.1 },
  pitchesThrown: { verifiedStatsWeight: 1.2, minVerifiedStatsScore: 52, volatilityTolerance: 1.1 },
  totalBases: {
    volatilityTolerance: 1.5,
    volatilityWeight: 0.75,
    consistencyWeight: 0.88,
  },
  hrr: {
    volatilityTolerance: 1.4,
    matchupEdgeBoost: 8,
    moderateVarianceMatchupMin: 62,
  },
  hits: { volatilityTolerance: 1.2, matchupEdgeBoost: 6 },
  rbis: { volatilityTolerance: 1.2, matchupEdgeBoost: 6 },
  runs: { volatilityTolerance: 1.2, matchupEdgeBoost: 6 },
  earnedRuns: {
    minMatchupQuality: 50,
    requiresStableMatchup: false,
    volatilityTolerance: 1.05,
    minEdgeScale: 0.85,
  },
  hitsAllowed: { minMatchupQuality: 52, requiresStableMatchup: false, volatilityTolerance: 1.0 },
  fantasyScore: { volatilityTolerance: 1.05, minConfidenceFloor: TIER3_CONFIDENCE_MIN },
  batterWalks: { volatilityTolerance: 1.0, minConfidenceFloor: TIER3_CONFIDENCE_MIN },
  homeRuns: { volatilityTolerance: 0.95, minMatchupQuality: 55, minConfidenceFloor: TIER3_CONFIDENCE_MIN },
  stolenBases: { volatilityTolerance: 0.9, minMatchupQuality: 54, minConfidenceFloor: TIER3_CONFIDENCE_MIN },
};

const RECOVERY_GAP = 4;
const MAX_RECOVERY_BOOST = 5;
const TARGET_ACCEPTED_MIN = 8;
const TARGET_ACCEPTED_MAX = 20;
const MAX_PER_MARKET_RATIO = 0.5;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getMarketRules(prop = {}) {
  const key = canonicalMarketKey(prop.statType || prop.marketKey || prop.market);
  return { key, ...(MARKET_QUALIFICATION_RULES[key] || {}) };
}

function hasProjectionIntegrity(prop = {}) {
  const projection = finiteNumber(prop.projection ?? prop.projectedValue);
  if (Number.isFinite(projection)) return true;
  if (prop.sportsbookComparison || prop.lineComparison) return true;
  if (prop.manualEnriched || prop.manualStats?.last5Average || prop.manualStats?.seasonAverage) return true;
  if (prop.projectionSource && prop.projectionSource !== "missing") return true;
  return false;
}

/** Hard gates — only true safety blockers; concerns become weighted penalties elsewhere. */
export function checkQualificationHardGates(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return { pass: false, reason: "not a verified sportsbook prop", gate: "verification" };
  if (prop.unsupportedSport || prop.marketUnsupported || prop.esports) {
    return { pass: false, reason: "unsupported sport or market", gate: "market" };
  }
  if (!hasValidPickFields(prop)) return { pass: false, reason: "missing required pick fields", gate: "fields" };
  if (!hasProjectionIntegrity(prop)) {
    return { pass: false, reason: "projection integrity — missing projection context", gate: "projection" };
  }
  if (prop.freshnessTier === "EXPIRED" || (prop.lineSourceBadge === "STALE" && prop.freshnessTier === "EXPIRED")) {
    return { pass: false, reason: "expired verified cache", gate: "stale" };
  }
  const vol = finiteNumber(prop.volatility);
  if (Number.isFinite(vol) && vol >= 5) {
    return { pass: false, reason: "severe volatility", gate: "volatility" };
  }
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (prop.lineMovement?.againstPick && movementTag === "steamed") {
    const delta = Math.abs(Number(prop.lineMovement?.delta ?? prop.lineMovement?.change ?? 0));
    if (delta >= 1) {
      return { pass: false, reason: "catastrophic line movement against pick", gate: "lineMovement" };
    }
  }
  const status = String(prop.status || "").toLowerCase();
  if (status === "locked" || status === "expired" || status === "live") {
    return { pass: false, reason: `prop status is ${status}`, gate: "timing" };
  }
  const start = new Date(prop.startTime).getTime();
  if (!Number.isFinite(start) || start <= Date.now()) {
    return { pass: false, reason: "game already started or missing start time", gate: "timing" };
  }
  return { pass: true, reason: "", gate: "" };
}

export function acceptanceConfidenceFloor(prop = {}) {
  const rules = getMarketRules(prop);
  const tier3 = getMlbQualityTier(prop) === "C";
  return Math.max(rules.minConfidenceFloor || 0, tier3 ? TIER3_CONFIDENCE_MIN : PLAYABLE_CONFIDENCE_MIN);
}

/** Secondary acceptance path when tier score is close but confidence/market context is playable. */
export function isSmartAcceptanceEligible(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (prop.freshnessTier === "EXPIRED") return false;
  if (!hasProjectionIntegrity(prop)) return false;
  if (!isPositiveEdge(prop)) return false;
  if (!hasPositiveEv(prop)) return false;
  if (!hasMatchupData(prop)) return false;
  const status = String(prop.status || "").toLowerCase();
  if (["locked", "expired", "live"].includes(status)) return false;
  const start = new Date(prop.startTime).getTime();
  if (!Number.isFinite(start) || start <= Date.now()) return false;
  const confidence = Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
  if (confidence < acceptanceConfidenceFloor(prop)) return false;
  const vol = finiteNumber(prop.volatility);
  if (Number.isFinite(vol) && vol >= 5) return false;
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (prop.lineMovement?.againstPick && movementTag === "steamed") {
    const delta = Math.abs(Number(prop.lineMovement?.delta ?? prop.lineMovement?.change ?? 0));
    if (delta >= 1) return false;
  }
  if (prop.bookDisagreement?.sharpDisagreement && prop.bookDisagreement?.staleLine) return false;
  return true;
}

function scoreMatchupQuality(prop = {}) {
  let score = Number(prop.matchupRating) || 48;
  const opponentAllowed = finiteNumber(prop.opponentAllowed);
  const line = finiteNumber(prop.line);
  if (Number.isFinite(opponentAllowed) && Number.isFinite(line) && line > 0) {
    score += clamp(((opponentAllowed - line) / line) * 35, -12, 18);
  }
  if (prop.handednessMatchup) score += 10;
  if (/favorable|weakness|elite|plus/i.test(String(prop.matchupNote || prop.handednessMatchup || ""))) score += 8;
  if (/tough|mismatch|elite pitch/i.test(String(prop.matchupNote || ""))) score -= 8;
  if (finiteNumber(prop.weatherRating)) score += clamp(Number(prop.weatherRating) * 8, -4, 10);
  if (finiteNumber(prop.parkFactorNote) || /hitter|pitcher friendly/i.test(String(prop.parkFactorNote || ""))) score += 4;
  if (prop.opponentRank && Number(prop.opponentRank) <= 8) score += 6;
  return clamp(Math.round(score), 0, 100);
}

function scoreRecentForm(prop = {}) {
  const hitRate = finiteNumber(prop.recentHitRate ?? prop.last5HitRate ?? prop.last10HitRate);
  const last5 = finiteNumber(prop.last5Average);
  const line = finiteNumber(prop.line);
  let score = 45;
  if (Number.isFinite(hitRate)) score = clamp(Math.round((hitRate - 0.35) * 120 + 40), 0, 100);
  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    score = Math.round(score * 0.65 + clamp(50 + ((last5 - line) / line) * 45, 0, 100) * 0.35);
  }
  if (prop.hitStreak >= 3) score += 8;
  if (/hot|surge|trending up/i.test(String(prop.formNote || ""))) score += 5;
  return clamp(score, 0, 100);
}

function scoreConsistency(prop = {}) {
  const sample = finiteNumber(prop.sampleSize) || 0;
  const vol = finiteNumber(prop.volatility);
  let score = sample >= 10 ? 72 : sample >= 5 ? 58 : sample >= 3 ? 46 : 32;
  if (Number.isFinite(vol)) {
    if (vol <= 2) score += 12;
    else if (vol <= 2.75) score += 4;
    else if (vol >= 4) score -= 14;
    else if (vol >= 3.25) score -= 8;
  }
  const l5 = finiteNumber(prop.last5HitRate);
  const l10 = finiteNumber(prop.last10HitRate);
  if (Number.isFinite(l5) && Number.isFinite(l10) && Math.abs(l5 - l10) <= 0.12) score += 6;
  return clamp(score, 0, 100);
}

function scoreLineStability(prop = {}) {
  let score = 62;
  const tag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (tag === "stable" || tag === "hold") score += 12;
  if (tag === "steam" && !prop.lineMovement?.againstPick) score += 4;
  if (tag === "volatile" || tag === "steamed") score -= 12;
  if (prop.lineMovement?.againstPick) score -= 10;
  if (prop.lineSourceBadge === "LIVE") score += 6;
  if (Number(prop.sportsbookDiscrepancy) > 0) score += 4;
  return clamp(score, 0, 100);
}

function scoreEdgeMetric(prop = {}, marketThresholds = {}) {
  const edge = Number(prop.edge || 0);
  const minEdge = marketThresholds.minEdge || 0.5;
  if (edge <= 0) return 0;
  const ratio = edge / Math.max(minEdge, 0.01);
  return clamp(Math.round(42 + ratio * 22), 0, 100);
}

function scoreVolatilityMetric(prop = {}, rules = {}) {
  const vol = finiteNumber(prop.volatility);
  const tier = getPropVolatilityTier(prop);
  const tolerance = rules.volatilityTolerance || 1;
  let score = tier === "LOW" ? 78 : tier === "MEDIUM" ? 62 : 48;
  if (Number.isFinite(vol)) {
    const adjustedVol = vol / tolerance;
    if (adjustedVol <= 2) score += 14;
    else if (adjustedVol <= 2.75) score += 4;
    else if (adjustedVol >= 4) score -= 16;
    else if (adjustedVol >= 3.25) score -= 8;
  }
  if (prop.meetsVolatilityRequirements === true) score += 8;
  if (prop.meetsVolatilityRequirements === false) score -= 6;
  return clamp(score, 0, 100);
}

function scoreProjectionConfidence(prop = {}) {
  const confidence = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const dq = Number(prop.dataQualityScore ?? 0);
  return clamp(Math.round(confidence * 0.72 + dq * 0.28), 0, 100);
}

function scoreVerifiedStatsQuality(prop = {}, rules = {}) {
  const sample = finiteNumber(prop.sampleSize) || 0;
  const dq = Number(prop.dataQualityScore ?? 0);
  let score = prop.hasVerifiedStats || prop.manualEnriched ? 58 : 20;
  if (sample >= 10) score += 22;
  else if (sample >= 5) score += 12;
  else if (sample >= 3) score += 6;
  score += clamp((dq - 40) * 0.35, -8, 18);
  if (prop.verifiedHistory || prop.strongData) score += 8;
  if (rules.requiresPitcherVerification && !/pitch|strikeout|out|earned|hit allowed/i.test(prop.statType || "")) {
    score -= 4;
  }
  return clamp(Math.round(score), 0, 100);
}

function hasEliteMatchupSignals(prop = {}, metrics = {}) {
  return (
    metrics.matchupQuality >= 72 ||
    /elite|favorable|weakness|plus matchup/i.test(String(prop.matchupNote || prop.handednessMatchup || "")) ||
    (finiteNumber(prop.weatherRating) >= 0.65 && metrics.matchupQuality >= 65) ||
    Boolean(prop.handednessMatchup && metrics.recentForm >= 68)
  );
}

function hasStrongOpposingWeakness(prop = {}, metrics = {}) {
  const opponentAllowed = finiteNumber(prop.opponentAllowed);
  const line = finiteNumber(prop.line);
  return (
    (Number.isFinite(opponentAllowed) && Number.isFinite(line) && opponentAllowed >= line * 1.08) ||
    (Number(prop.opponentRank) >= 22 && metrics.matchupQuality >= 65)
  );
}

function computeQualificationMetrics(prop = {}) {
  const marketThresholds = getMarketReadyThreshold(prop);
  const rules = getMarketRules(prop);
  const metrics = {
    matchupQuality: scoreMatchupQuality(prop),
    recentForm: scoreRecentForm(prop),
    consistency: scoreConsistency(prop),
    lineStability: scoreLineStability(prop),
    edge: scoreEdgeMetric(prop, marketThresholds),
    volatility: scoreVolatilityMetric(prop, rules),
    projectionConfidence: scoreProjectionConfidence(prop),
    verifiedStatsQuality: scoreVerifiedStatsQuality(prop, rules),
  };

  if (rules.matchupEdgeBoost && metrics.matchupQuality >= (rules.moderateVarianceMatchupMin || 65)) {
    metrics.volatility = clamp(metrics.volatility + rules.matchupEdgeBoost, 0, 100);
  }

  return metrics;
}

function computeWeightedQualificationScore(metrics = {}, rules = {}) {
  const weights = { ...METRIC_WEIGHTS };
  if (rules.verifiedStatsWeight) weights.verifiedStatsQuality *= rules.verifiedStatsWeight;
  if (rules.volatilityWeight) weights.volatility *= rules.volatilityWeight;
  if (rules.consistencyWeight) weights.consistency *= rules.consistencyWeight;

  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  let score = 0;
  Object.entries(weights).forEach(([key, weight]) => {
    score += (metrics[key] || 0) * (weight / totalWeight);
  });
  return clamp(Math.round(score), 0, 100);
}

function applyMarketQualificationAdjustments(prop = {}, metrics = {}, rules = {}, baseScore = 0) {
  let score = baseScore;
  let capTier = null;
  const notes = [];
  const penaltyStack = [];

  if (rules.minVerifiedStatsScore && metrics.verifiedStatsQuality < rules.minVerifiedStatsScore) {
    penaltyStack.push({ key: "verificationDepth", label: "Verification depth penalty", penalty: 5 });
    score -= 5;
    notes.push("verification depth below market minimum");
  }
  if (rules.minMatchupQuality && metrics.matchupQuality < rules.minMatchupQuality) {
    penaltyStack.push({ key: "matchupQuality", label: "Matchup quality penalty", penalty: 6 });
    score -= 6;
    notes.push("matchup quality below market minimum");
  }
  if (rules.requiresStableMatchup && metrics.lineStability < 52) {
    penaltyStack.push({ key: "lineStability", label: "Line stability penalty", penalty: 5 });
    score -= 5;
    notes.push("unstable line for matchup-sensitive market");
  }

  return { score: clamp(score, 0, 100), capTier, notes, penaltyStack };
}

/** Weighted concern penalties — single flags reduce score; stacked flags can reject. */
export function computeSoftConcernPenalties(prop = {}, metrics = {}, rules = getMarketRules(prop)) {
  const stack = [];
  let totalPenalty = 0;
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  const movementScale = rules.lineMovementPenaltyScale ?? 1;

  if (prop.lineMovement?.againstPick) {
    const penalty = Math.round(6 * movementScale);
    stack.push({ key: "lineMovement", label: "Line movement penalty", penalty });
    totalPenalty += penalty;
  } else if (movementTag === "volatile" || movementTag === "steamed") {
    const penalty = Math.round(4 * movementScale);
    stack.push({ key: "lineMovement", label: "Line movement penalty", penalty });
    totalPenalty += penalty;
  }

  const vol = finiteNumber(prop.volatility);
  const volTolerance = rules.volatilityTolerance || 1;
  if (Number.isFinite(vol)) {
    const adjustedVol = vol / volTolerance;
    if (adjustedVol >= 3.75) {
      stack.push({ key: "volatility", label: "Volatility penalty", penalty: 8 });
      totalPenalty += 8;
    } else if (adjustedVol >= 3.25) {
      stack.push({ key: "volatility", label: "Volatility penalty", penalty: 5 });
      totalPenalty += 5;
    } else if (adjustedVol >= 2.85) {
      stack.push({ key: "volatility", label: "Volatility penalty", penalty: 3 });
      totalPenalty += 3;
    }
  } else if (prop.meetsVolatilityRequirements === false) {
    stack.push({ key: "volatility", label: "Volatility penalty", penalty: 4 });
    totalPenalty += 4;
  }

  const edge = Number(prop.edge || 0);
  const marketThresholds = getMarketReadyThreshold(prop);
  const minEdge = marketThresholds.minEdge * (rules.minEdgeScale || 1);
  if (edge <= 0) {
    stack.push({ key: "weakEdge", label: "Non-positive edge penalty", penalty: 8 });
    totalPenalty += 8;
  } else if (edge < minEdge * 0.85) {
    stack.push({ key: "weakEdge", label: "Weak edge penalty", penalty: 4 });
    totalPenalty += 4;
  }

  if (prop.marketResearchOnly || prop.marketSupportTier === 2 || prop.noveltyMarket) {
    stack.push({ key: "researchMarket", label: "Research-only market penalty", penalty: 5 });
    totalPenalty += 5;
  }

  if (prop.bookDisagreement?.sharpDisagreement && prop.bookDisagreement?.staleLine) {
    stack.push({ key: "bookDisagreement", label: "Conflicting sportsbook data penalty", penalty: 6 });
    totalPenalty += 6;
  }

  if (metrics.lineStability != null && metrics.lineStability < 48) {
    stack.push({ key: "lineStability", label: "Line stability penalty", penalty: 4 });
    totalPenalty += 4;
  }

  if (prop.freshnessTier === "STALE_WARNING") {
    stack.push({ key: "cacheAge", label: "Stale cache penalty", penalty: 3 });
    totalPenalty += 3;
  }

  if (!prop.hasVerifiedStats && !prop.manualEnriched) {
    stack.push({ key: "verification", label: "Unverified stats penalty", penalty: 6 });
    totalPenalty += 6;
  }

  if (
    shouldRouteMlbHitterToResearch(
      prop,
      {
        sampleSize: prop.sampleSize || prop.modelSignal?.sampleSize,
        sparse: prop.sparseProfile,
        fallback: prop.fallbackProfile,
        manualEnriched: prop.manualEnriched,
      },
      { lineOnly: prop.lineOnlyData }
    )
  ) {
    stack.push({ key: "hitterData", label: "Thin hitter data penalty", penalty: 5 });
    totalPenalty += 5;
  }

  return { stack, totalPenalty };
}

function applySmartRecovery(prop = {}, metrics = {}, score = 0, tierThresholds = {}) {
  const recoveries = [];
  let boost = 0;
  const marketThresholds = getMarketReadyThreshold(prop);

  const strongThreshold = tierThresholds.strong ?? DEFAULT_TIER_THRESHOLDS.strong;
  const nearThreshold = tierThresholds.nearMiss ?? DEFAULT_TIER_THRESHOLDS.nearMiss;
  const watchThreshold = tierThresholds.watchlist ?? DEFAULT_TIER_THRESHOLDS.watchlist;

  const gapToStrong = strongThreshold - score;
  const gapToNear = nearThreshold - score;
  const gapToWatch = watchThreshold - score;
  const nearestGap = Math.min(
    gapToStrong > 0 ? gapToStrong : Infinity,
    gapToNear > 0 ? gapToNear : Infinity,
    gapToWatch > 0 ? gapToWatch : Infinity
  );

  if (nearestGap > RECOVERY_GAP) {
    return { score, recoveries, recoveryBoost: 0 };
  }

  if (hasEliteMatchupSignals(prop, metrics)) {
    boost = Math.max(boost, 4);
    recoveries.push("matchup override");
  }
  if (metrics.recentForm >= 76 || prop.hitStreak >= 4) {
    boost = Math.max(boost, 3);
    recoveries.push("trend override");
  }
  if (Number(prop.edge || 0) >= marketThresholds.minEdge * 1.45 && metrics.lineStability >= 68) {
    boost = Math.max(boost, 3);
    recoveries.push("market override");
  }
  if (hasStrongOpposingWeakness(prop, metrics)) {
    boost = Math.max(boost, 2);
    recoveries.push("opposing weakness");
  }

  boost = Math.min(MAX_RECOVERY_BOOST, boost);
  return { score: clamp(score + boost, 0, 100), recoveries, recoveryBoost: boost };
}

function resolveTierFromScore(score = 0, tierThresholds = DEFAULT_TIER_THRESHOLDS) {
  if (score >= tierThresholds.elite) return QUALIFICATION_TIERS.ELITE;
  if (score >= tierThresholds.strong) return QUALIFICATION_TIERS.STRONG;
  if (score >= tierThresholds.nearMiss) return QUALIFICATION_TIERS.NEAR_MISS;
  if (score >= tierThresholds.watchlist) return QUALIFICATION_TIERS.WATCHLIST;
  return QUALIFICATION_TIERS.REJECT;
}

function capTier(currentTier, capTier) {
  if (!capTier) return currentTier;
  const order = [
    QUALIFICATION_TIERS.ELITE,
    QUALIFICATION_TIERS.STRONG,
    QUALIFICATION_TIERS.NEAR_MISS,
    QUALIFICATION_TIERS.WATCHLIST,
    QUALIFICATION_TIERS.REJECT,
  ];
  return order.indexOf(currentTier) < order.indexOf(capTier) ? currentTier : capTier;
}

export function evaluateAdaptiveQualification(prop = {}, options = {}) {
  const hardGate = checkQualificationHardGates(prop);
  if (!hardGate.pass) {
    return {
      qualificationScore: 0,
      qualificationTier: QUALIFICATION_TIERS.REJECT,
      hardFail: true,
      hardFailReason: hardGate.reason,
      hardFailGate: hardGate.gate,
      metrics: {},
      recoveries: [],
      recoveryBoost: 0,
      marketRules: getMarketRules(prop),
      weakestMetrics: [],
      strongestMetrics: [],
    };
  }

  const rules = getMarketRules(prop);
  const metrics = computeQualificationMetrics(prop);
  const baseScore = computeWeightedQualificationScore(metrics, rules);
  const adjusted = applyMarketQualificationAdjustments(prop, metrics, rules, baseScore);
  const softPenalties = computeSoftConcernPenalties(prop, metrics, rules);
  const tierThresholds = options.tierThresholds || DEFAULT_TIER_THRESHOLDS;
  const penalizedScore = clamp(adjusted.score - softPenalties.totalPenalty, 0, 100);
  const recovery = applySmartRecovery(prop, metrics, penalizedScore, tierThresholds);
  let tier = resolveTierFromScore(recovery.score, tierThresholds);
  tier = capTier(tier, adjusted.capTier);

  const penaltyStack = [...(adjusted.penaltyStack || []), ...softPenalties.stack];
  if (softPenalties.totalPenalty >= SOFT_PENALTY_HARD_REJECT && tier !== QUALIFICATION_TIERS.REJECT) {
    tier = QUALIFICATION_TIERS.WATCHLIST;
  }

  const metricEntries = Object.entries(metrics).sort((a, b) => b[1] - a[1]);
  const strongestMetrics = metricEntries.slice(0, 3).map(([key, value]) => ({ key, value }));
  const weakestMetrics = [...metricEntries].reverse().slice(0, 3).map(([key, value]) => ({ key, value }));

  return {
    qualificationScore: recovery.score,
    baseQualificationScore: baseScore,
    qualificationTier: tier,
    hardFail: false,
    hardFailReason: "",
    hardFailGate: "",
    metrics,
    recoveries: recovery.recoveries,
    recoveryBoost: recovery.recoveryBoost,
    marketRules: rules,
    adjustmentNotes: adjusted.notes,
    penaltyStack,
    softPenaltyTotal: softPenalties.totalPenalty,
    weakestMetrics,
    strongestMetrics,
    tierThresholds,
  };
}

export function resolveAdaptiveTierThresholds(acceptedCount = 0) {
  if (acceptedCount >= TARGET_ACCEPTED_MIN) return { ...DEFAULT_TIER_THRESHOLDS, adaptive: false };
  const deficit = Math.max(0, TARGET_ACCEPTED_MIN - acceptedCount);
  const loosen = Math.min(6, Math.ceil(deficit / 2));
  return {
    elite: DEFAULT_TIER_THRESHOLDS.elite - Math.min(3, loosen),
    strong: DEFAULT_TIER_THRESHOLDS.strong - loosen,
    nearMiss: DEFAULT_TIER_THRESHOLDS.nearMiss - Math.min(4, loosen + 1),
    watchlist: DEFAULT_TIER_THRESHOLDS.watchlist,
    adaptive: true,
  };
}

export function isAcceptedQualificationTier(tier = "", prop = {}) {
  if (tier === QUALIFICATION_TIERS.REJECT || tier === QUALIFICATION_TIERS.WATCHLIST) return false;
  const confidence = Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
  if (confidence < acceptanceConfidenceFloor(prop)) return false;
  if (!meetsAcceptedPropQuality(prop)) return false;
  return tier === QUALIFICATION_TIERS.ELITE || tier === QUALIFICATION_TIERS.STRONG || tier === QUALIFICATION_TIERS.NEAR_MISS;
}

export function qualificationTierToDisplayTier(tier = "", prop = {}) {
  if (isAcceptedQualificationTier(tier, prop)) return "ready";
  if (tier === QUALIFICATION_TIERS.NEAR_MISS) return "near";
  if (tier === QUALIFICATION_TIERS.WATCHLIST) return "research";
  return null;
}

export function qualificationTierLabel(tier = "") {
  return QUALIFICATION_TIER_LABELS[tier] || "Reject";
}

function marketKey(prop = {}) {
  return canonicalMarketKey(prop.statType || prop.marketKey || prop.market) || "unknown";
}

/** Keep accepted props spread across market types. */
export function selectDiverseAcceptedProps(props = [], limit = TARGET_ACCEPTED_MAX) {
  const sorted = [...props].sort(
    (a, b) =>
      Number(b.qualificationScore || 0) - Number(a.qualificationScore || 0) ||
      Number(b.priorityScore || 0) - Number(a.priorityScore || 0)
  );
  const maxPerMarket = Math.max(2, Math.ceil(limit * MAX_PER_MARKET_RATIO));
  const selected = [];
  const marketCounts = new Map();

  for (const prop of sorted) {
    const key = marketKey(prop);
    if ((marketCounts.get(key) || 0) >= maxPerMarket) continue;
    selected.push(prop);
    marketCounts.set(key, (marketCounts.get(key) || 0) + 1);
    if (selected.length >= limit) break;
  }

  if (selected.length < Math.min(limit, sorted.length)) {
    sorted.forEach((prop) => {
      if (selected.length >= limit) return;
      if (selected.some((item) => item.id === prop.id)) return;
      selected.push(prop);
    });
  }

  return selected;
}

export function buildQualificationAnalytics(evaluated = []) {
  const scored = evaluated.filter((row) => !row.hardFail && row.qualificationScore > 0);
  const accepted = evaluated.filter((row) => isAcceptedQualificationTier(row.qualificationTier, row.prop));
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, row) => sum + row.qualificationScore, 0) / scored.length)
      : 0;

  const metricTotals = {};
  const metricCounts = {};
  scored.forEach((row) => {
    Object.entries(row.metrics || {}).forEach(([key, value]) => {
      metricTotals[key] = (metricTotals[key] || 0) + value;
      metricCounts[key] = (metricCounts[key] || 0) + 1;
    });
  });

  const metricAverages = Object.entries(metricTotals)
    .map(([key, total]) => ({ key, avg: Math.round(total / Math.max(1, metricCounts[key])) }))
    .sort((a, b) => b.avg - a.avg);

  const rejectionCauses = {};
  const restrictiveFilters = {};
  evaluated.forEach((row) => {
    if (row.hardFail) {
      rejectionCauses[row.hardFailReason] = (rejectionCauses[row.hardFailReason] || 0) + 1;
      restrictiveFilters[row.hardFailGate] = (restrictiveFilters[row.hardFailGate] || 0) + 1;
      return;
    }
    if (row.qualificationTier === QUALIFICATION_TIERS.REJECT) {
      const weakest = row.weakestMetrics?.[0]?.key || "composite";
      rejectionCauses[`low ${weakest}`] = (rejectionCauses[`low ${weakest}`] || 0) + 1;
      restrictiveFilters[weakest] = (restrictiveFilters[weakest] || 0) + 1;
    }
  });

  const tierCounts = {};
  evaluated.forEach((row) => {
    tierCounts[row.qualificationTier] = (tierCounts[row.qualificationTier] || 0) + 1;
  });

  return {
    avgQualificationScore: avgScore,
    accepted: accepted.length,
    evaluated: evaluated.length,
    strongestMetrics: metricAverages.slice(0, 3),
    weakestMetrics: [...metricAverages].reverse().slice(0, 3),
    topRejectionCauses: Object.entries(rejectionCauses)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
    mostRestrictiveFilters: Object.entries(restrictiveFilters)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([filter, count]) => ({ filter, count })),
    tierCounts,
    adaptiveApplied: Boolean(evaluated[0]?.tierThresholds?.adaptive),
  };
}

export function evaluateQualificationPool(props = [], options = {}) {
  let tierThresholds = { ...DEFAULT_TIER_THRESHOLDS, adaptive: false };
  let evaluated = props.map((prop) => {
    const result = evaluateAdaptiveQualification(prop, { tierThresholds, ...options });
    return { prop, ...result };
  });

  let acceptedCount = evaluated.filter((row) => isAcceptedQualificationTier(row.qualificationTier, row.prop)).length;

  for (let pass = 0; pass < 4 && acceptedCount < TARGET_ACCEPTED_MIN; pass += 1) {
    tierThresholds = resolveAdaptiveTierThresholds(acceptedCount);
    evaluated = props.map((prop) => {
      const result = evaluateAdaptiveQualification(prop, { tierThresholds, ...options });
      return { prop, ...result };
    });
    acceptedCount = evaluated.filter((row) => isAcceptedQualificationTier(row.qualificationTier, row.prop)).length;
  }

  return {
    evaluated,
    tierThresholds,
    acceptedCount,
    analytics: {
      ...buildQualificationAnalytics(evaluated),
      adaptiveApplied: Boolean(tierThresholds.adaptive),
    },
  };
}
