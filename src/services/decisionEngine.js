import { MAX_DECISION_DEBUG_SAMPLES, buildGroupedDebugEntries } from "../utils/propPipelineDebug.js";
import { isHeavyDebugEnabled } from "../utils/devMode.js";
import { filterActiveSportProps } from "../utils/mlbOnlyMode.js";
import {
  calculateConfidenceScore,
  CONFIDENCE_THRESHOLDS,
} from "./confidenceEngine.js";
import { historicalConfidenceBoost, historicalVolatilityPenalty, historicalMissPenalty, marketHitRateAdjustment, marketReliabilityScore } from "./outcomeTracking.js";
import { calibrateConfidence } from "./confidenceCalibration.js";
import { lineMovementTrustScore, enrichLineMovementWithTags } from "./lineMovementTrust.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { isDemonProp, isGoblinProp } from "../utils/propLabels.js";
import { getPropVolatilityTier, meetsVolatilityTierRequirements, PROP_VOLATILITY_TIERS } from "./marketConfidenceModels.js";
import { getMlbQualityTierWeight, getMlbMinEdgeForTier, isMlbQualityTierS, MLB_ONLY_MODE } from "../utils/mlbOnlyMode.js";

export { CONFIDENCE_THRESHOLDS };

export const DECISION_THRESHOLDS = {
  ...CONFIDENCE_THRESHOLDS,
  TOP_PICKS_DQ: 65,
  READY_DQ: 45,
  STRONG_EDGE: 1,
  HIGH_VOLATILITY: 3.5,
  STRONG_EV: 0.02,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Confidence 0-100 using the 8 weighted components + historical learning.
 */
export function calculateProjectionConfidence(prop = {}, options = {}) {
  const line = finiteNumber(prop.line);
  const hasLine = Number.isFinite(line) && line > 0;
  const historyRows = options.historyRows || prop.historyRows || [];
  const base = calculateConfidenceScore(prop, options);
  const historicalBoost = options.historicalBoost || historicalConfidenceBoost(prop, historyRows);
  const historicalPenalty = options.historicalPenalty || historicalVolatilityPenalty(prop, historyRows);
  const missPenalty = options.missPenalty || historicalMissPenalty(prop, historyRows);
  const marketHistory = options.marketHistory || marketHitRateAdjustment(prop, historyRows);
  const marketReliability = marketReliabilityScore(prop, historyRows);

  const histPen = Number(historicalPenalty.penalty || 0);
  const missPen = Number(missPenalty.penalty || 0);
  const combinedHistPenalty =
    histPen > 0 && missPen > 0
      ? Math.min(12, Math.max(histPen, missPen) + Math.min(histPen, missPen) * 0.35)
      : Math.min(12, histPen * 0.75 + missPen * 0.55);

  let score = clamp(
    Math.round(
      base.score +
        Number(historicalBoost.boost || 0) -
        combinedHistPenalty +
        (marketReliability.reliable ? 2 : marketReliability.score < 42 ? -3 : 0)
    ),
    hasLine ? 28 : 0,
    100
  );

  const calibration = calibrateConfidence(prop, score, historyRows, options.calibrationMap);
  const calibratedConfidence = calibration.calibratedConfidence;
  const lineTrust = lineMovementTrustScore(prop, prop.lineMovement);
  const movementTags = enrichLineMovementWithTags(prop.lineMovement, prop.bestPick);
  if (lineTrust.supportsPick) score = Math.min(100, score + 2);
  else if (lineTrust.againstPick) score = Math.max(hasLine ? 28 : 0, score - 3);
  if (movementTags.tag === "steamed" && lineTrust.againstPick) score = Math.max(hasLine ? 28 : 0, score - 4);

  if (options.statCap != null) score = Math.min(score, options.statCap);
  if (options.sportCap != null) score = Math.min(score, options.sportCap);

  const explanation = [
    ...(base.explanation || []),
    {
      key: "historicalBoost",
      label: "Historical Boost",
      score: round(Number(historicalBoost.boost || 0), 1),
      max: 12,
      detail: historicalBoost.note || "Not enough settled history yet.",
    },
    {
      key: "historicalVolatilityPenalty",
      label: "Historical Volatility Penalty",
      score: round(-Number(historicalPenalty.penalty || 0), 1),
      max: 10,
      detail: historicalPenalty.note || "No historical volatility penalty.",
    },
    {
      key: "calibration",
      label: "Confidence Calibration",
      score: round(Number(calibration.calibrationAdjustment || 0), 1),
      max: 12,
      detail: calibration.calibrationNote || "Calibration pending more settled picks.",
    },
    {
      key: "lineMovementTrust",
      label: "Line Movement Trust",
      score: round((lineTrust.score - 50) * 0.2, 1),
      max: 6,
      detail: lineTrust.note || lineTrust.label,
    },
    {
      key: "marketReliability",
      label: "Market Reliability",
      score: round((marketReliability.score - 50) * 0.15, 1),
      max: 8,
      detail: marketReliability.label,
    },
  ];

  return {
    ...base,
    score,
    confidence: score,
    calibratedConfidence,
    calibrationAdjustment: calibration.calibrationAdjustment,
    calibrationNote: calibration.calibrationNote,
    tierActualHitRate: calibration.tierActualHitRate,
    tierBaselineHitRate: calibration.tierBaselineHitRate,
    marketHistoricalHitRate: marketHistory.hitRate,
    marketHistoricalSample: marketHistory.sample,
    marketReliabilityScore: marketReliability.score,
    marketReliabilityLabel: marketReliability.label,
    lineMovementTrustScore: lineTrust.score,
    lineMovementTrustLabel: lineTrust.label,
    explanation,
    breakdown: base.breakdown,
    historicalBoost,
    historicalPenalty,
    marketModel: base.marketModel || null,
    marketModelLabel: base.marketModelLabel || null,
    volatilityTier: base.volatilityTier || getPropVolatilityTier(prop),
    projectionAgreement: base.projectionAgreement ?? null,
    meetsVolatilityRequirements: base.meetsVolatilityRequirements ?? meetsVolatilityTierRequirements({ ...prop, projectionAgreement: base.projectionAgreement }, score),
    meetsReady: score >= CONFIDENCE_THRESHOLDS.READY && Number(prop.edge || 0) > 0 && (base.meetsVolatilityRequirements ?? true),
    meetsTopPicks: score >= CONFIDENCE_THRESHOLDS.TOP_PICKS && Number(prop.edge || 0) > 0 && (base.meetsVolatilityRequirements ?? true),
    meetsDemon: score >= CONFIDENCE_THRESHOLDS.DEMON && Number(prop.edge || 0) >= DECISION_THRESHOLDS.STRONG_EDGE && (base.meetsVolatilityRequirements ?? true),
  };
}

export function detectBookDisagreement(prop = {}) {
  const line = finiteNumber(prop.line);
  const sportsbook = prop.sportsbookComparison || null;
  const lineComparison = prop.lineComparison || null;
  const bookLine = finiteNumber(sportsbook?.marketAverageLine);
  const peerLine = finiteNumber(lineComparison?.marketAverageLine);
  const discrepancy = finiteNumber(prop.sportsbookDiscrepancy);
  const books = Number(sportsbook?.books || 0);

  const signals = [];
  let softLine = false;
  let staleLine = false;
  let sharpDisagreement = false;
  let bestAvailableLine = line;

  if (Number.isFinite(bookLine) && Number.isFinite(line)) {
    const gap = bookLine - line;
    if (Math.abs(gap) >= 0.5) {
      softLine = Math.abs(gap) >= 0.5;
      signals.push(gap > 0 ? "DFS line below book average (soft)" : "DFS line above book average");
      bestAvailableLine = prop.bestPick === "More" ? Math.min(line, bookLine) : Math.max(line, bookLine);
    }
    if (books >= 3 && Math.abs(gap) >= 1) sharpDisagreement = true;
  }

  if (lineComparison && Number.isFinite(lineComparison.difference) && lineComparison.difference >= 0.75) {
    softLine = true;
    signals.push(`Cross-platform gap ${round(lineComparison.difference)}`);
  }

  if (prop.lineMovement?.againstPick) {
    sharpDisagreement = true;
    signals.push("Market moved against recommendation");
  }

  if (Number.isFinite(discrepancy) && discrepancy >= 0.5) {
    softLine = true;
    signals.push(`Book edge +${round(discrepancy)}`);
  }

  if (prop.lineSourceBadge === "CACHED" || prop.status === "locked") {
    staleLine = true;
    signals.push("Stale or cached line");
  }

  return {
    softLine,
    staleLine,
    sharpDisagreement,
    bestAvailableLine: Number.isFinite(bestAvailableLine) ? round(bestAvailableLine) : null,
    sportsbookLine: Number.isFinite(bookLine) ? round(bookLine) : null,
    peerLine: Number.isFinite(peerLine) ? round(peerLine) : null,
    summary: signals.length ? signals.join(" · ") : "No major book disagreement",
    books,
  };
}

export function computeLineValueScore(prop = {}, bookDisagreement = null) {
  const book = bookDisagreement || detectBookDisagreement(prop);
  let score = 0;
  if (book.softLine) score += 35;
  if (Number.isFinite(book.sportsbookLine) && Number.isFinite(prop.line)) {
    score += clamp(Math.abs(book.sportsbookLine - Number(prop.line)) * 12, 0, 30);
  }
  if (prop.lineComparison?.difference >= 0.5) score += clamp(Number(prop.lineComparison.difference) * 10, 0, 20);
  if (prop.lineMovement?.supportsPick) score += 15;
  if (prop.lineMovement?.againstPick) score -= 20;
  if (book.sharpDisagreement && !book.softLine) score -= 10;
  if (book.staleLine) score -= 15;
  return round(clamp(score, 0, 100));
}

export function computeVolatilityScore(prop = {}) {
  const volatility = finiteNumber(prop.volatility);
  const sport = String(prop.sport || "");
  let baseline = 2.5;
  if (sport === "MLB") baseline = 1.8;
  if (sport === "NBA" || sport === "WNBA") baseline = 2.8;
  if (/tennis/i.test(sport)) baseline = 2.4;

  if (!Number.isFinite(volatility)) return 50;
  const ratio = volatility / baseline;
  if (ratio <= 0.75) return 92;
  if (ratio <= 1) return 80;
  if (ratio <= 1.25) return 65;
  if (ratio <= 1.5) return 48;
  if (ratio <= 2) return 32;
  return 18;
}

export function computeExpectedValueScore(prop = {}) {
  const ev = finiteNumber(prop.expectedValue);
  const prob = finiteNumber(prop.modelProbability);
  const edge = finiteNumber(prop.edge);
  const line = finiteNumber(prop.line);
  const confidence = Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
  const rawConfidence = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const volatilityScore = Number(prop.volatilityScore ?? computeVolatilityScore(prop));
  const lineTrust = Number(prop.lineMovementTrustScore ?? lineMovementTrustScore(prop, prop.lineMovement).score);
  const marketHit = finiteNumber(prop.marketHistoricalHitRate);
  const multiplier = Number(prop.multiplier) || 1;
  let score = 0;

  if (Number.isFinite(ev)) score += clamp(ev * 280, -20, 45);
  if (Number.isFinite(prob) && Number.isFinite(prop.impliedProbability)) {
    score += clamp((prob - Number(prop.impliedProbability)) * 80, -10, 25);
  }
  if (Number.isFinite(edge) && Number.isFinite(line) && line > 0) {
    score += clamp((edge / line) * 55 + edge * 3, 0, 25);
  }
  score += clamp((confidence - 50) * 0.38, -8, 14);
  score += clamp((rawConfidence - confidence) * 0.15, -3, 3);
  score += clamp((volatilityScore - 50) * 0.12, -8, 8);
  score += clamp((lineTrust - 50) * 0.1, -5, 6);
  if (Number.isFinite(marketHit)) score += clamp((marketHit - 0.5) * 18, -6, 8);
  if (multiplier > 1) score += clamp((multiplier - 1) * 8, 0, 10);

  return round(clamp(score, 0, 100));
}

export function computeDecisionRankScore(prop = {}) {
  const evScore = Number(prop.expectedValueScore ?? computeExpectedValueScore(prop));
  const confidence = Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
  const edge = Number(prop.edge || 0);
  const volatilityScore = Number(prop.volatilityScore ?? computeVolatilityScore(prop));
  const dq = Number(prop.dataQualityScore || 0);
  const lineValueScore = Number(prop.lineValueScore ?? computeLineValueScore(prop));

  return round(
    evScore * 0.34 +
      confidence * 0.26 +
      clamp(edge * 8, 0, 20) +
      volatilityScore * 0.12 +
      dq * 0.1 +
      lineValueScore * 0.08,
    1
  );
}

export function isBestValueEligible(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (Number(prop.edge || 0) <= 0 || !prop.bestPick) return false;
  const status = String(prop.status || "").toLowerCase();
  if (["live", "expired", "locked"].includes(status)) return false;
  const ev = Number(prop.expectedValueScore ?? computeExpectedValueScore(prop));
  const dq = Number(prop.dataQualityScore || 0);
  return ev >= 45 && dq >= 40;
}

export function classifyDecisionTier(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return "hidden";
  if (prop.marketResearchOnly || prop.noveltyMarket || prop.marketSupportTier === 2) return "research";
  if (!Number.isFinite(prop.projectedValue ?? prop.projection) && prop.projectionSource === "missing") return "research";
  if (Number(prop.volatility) >= DECISION_THRESHOLDS.HIGH_VOLATILITY && Number(prop.edge || 0) < 1.5) return "research";
  if (Number(prop.dataQualityScore || 0) < 35) return "research";

  if (isTopPickEligible(prop)) return "topPicks";
  if (isReadyToBetEligible(prop)) return "ready";
  if (isDemonEligible(prop)) return "demon";
  if (Number(prop.confidenceScore ?? prop.confidence ?? 0) >= 50 && Number(prop.edge || 0) > 0) return "watch";
  return "research";
}

export function isTopPickEligible(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (!prop.hasVerifiedStats && !prop.manualEnriched) return false;
  if (Number(prop.edge || 0) <= 0 || !prop.bestPick) return false;
  const rawConfidence = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const calibrated = Number(prop.calibratedConfidence ?? rawConfidence);
  const dq = Number(prop.dataQualityScore || 0);
  const status = String(prop.status || "").toLowerCase();
  if (["live", "expired", "locked", "in progress", "inprogress"].includes(status)) return false;
  if (prop.lineSourceBadge === "CACHED" && !prop.sportsbookVerified) return false;
  const risk = String(prop.riskLevel || "").toUpperCase();
  if (risk === "HIGH") return false;
  if (!Number.isFinite(prop.projectedValue ?? prop.projection)) return false;
  if (prop.projectionSource === "missing") return false;
  const tier = getPropVolatilityTier(prop);
  const tierRules = PROP_VOLATILITY_TIERS[tier];
  if (Number(prop.edge || 0) < tierRules.minEdge) return false;
  if (MLB_ONLY_MODE) {
    const tierMinEdge = getMlbMinEdgeForTier(prop);
    if (Number(prop.edge || 0) < tierMinEdge) return false;
  }
  const confidenceForGate = Math.max(rawConfidence, calibrated);
  if (confidenceForGate < tierRules.topConfidence) return false;
  if (!meetsVolatilityTierRequirements(prop, confidenceForGate)) return false;
  const meetsRaw = rawConfidence >= CONFIDENCE_THRESHOLDS.TOP_PICKS;
  const meetsCalibrated = calibrated >= 70 && rawConfidence >= CONFIDENCE_THRESHOLDS.TOP_PICKS - 4;
  return (meetsRaw || meetsCalibrated) && dq >= DECISION_THRESHOLDS.TOP_PICKS_DQ;
}

/** Strict gate for elite-labeled picks — S-tier MLB markets, ≥80 confidence, stable lines. */
export function isEliteTopPickEligible(prop = {}) {
  if (!isTopPickEligible(prop)) return false;
  if (!prop.hasVerifiedStats && !prop.manualEnriched) return false;
  const rawConfidence = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const calibrated = Number(prop.calibratedConfidence ?? rawConfidence);
  if (Math.max(rawConfidence, calibrated) < CONFIDENCE_THRESHOLDS.ELITE) return false;
  if (Number(prop.edge || 0) <= 0) return false;
  if (MLB_ONLY_MODE && Number(prop.edge || 0) < getMlbMinEdgeForTier(prop)) return false;
  if (prop.lineSourceBadge === "CACHED" || prop.lineSourceBadge === "STALE") return false;
  if (prop.projectionSource === "missing") return false;
  if (prop.marketResearchOnly || prop.noveltyMarket) return false;
  if (MLB_ONLY_MODE && !isMlbQualityTierS(prop)) return false;
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (["steamed", "volatile"].includes(movementTag)) return false;
  if (movementTag === "falling" && prop.lineMovement?.againstPick) return false;
  if (movementTag === "rising" && prop.lineMovement?.againstPick) return false;
  const trust = Number(prop.lineMovementTrustScore ?? 50);
  if (trust < 45 && prop.lineMovement?.againstPick) return false;
  const vol = Number(prop.volatility);
  if (Number.isFinite(vol) && vol >= 3.5) return false;
  return true;
}

export function isReadyToBetEligible(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (!prop.hasVerifiedStats && !prop.manualEnriched) return false;
  if (Number(prop.edge || 0) <= 0 || !prop.bestPick) return false;
  const status = String(prop.status || "").toLowerCase();
  if (["live", "expired", "locked"].includes(status)) return false;
  const start = new Date(prop.startTime).getTime();
  if (!Number.isFinite(start) || start <= Date.now()) return false;
  if (prop.marketResearchOnly || prop.noveltyMarket) return false;
  if (prop.freshnessTier === "EXPIRED") return false;
  const vol = finiteNumber(prop.volatility);
  if (Number.isFinite(vol) && vol >= 4.5) return false;
  const confidence = Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
  const tier = getPropVolatilityTier(prop);
  const tierRules = PROP_VOLATILITY_TIERS[tier];
  if (Number(prop.edge || 0) < tierRules.minEdge) return false;
  if (MLB_ONLY_MODE && Number(prop.edge || 0) < getMlbMinEdgeForTier(prop)) return false;
  if (!meetsVolatilityTierRequirements(prop, confidence)) return false;
  return confidence >= Math.max(CONFIDENCE_THRESHOLDS.PLAYABLE, tierRules.readyConfidence);
}

/** Weighted top-pick score: confidence + edge + reliability − volatility − line movement. */
export function computeTopPickWeightedScore(prop = {}) {
  const confidence = Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
  const edge = Number(prop.edge || 0);
  const marketReliability = Number(prop.marketReliabilityScore ?? 50);
  const historicalBoost = Number(prop.historicalBoost?.boost ?? 0);
  const vol = Number(prop.volatility ?? 2.5);
  const lineTrust = Number(prop.lineMovementTrustScore ?? 50);
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;

  let score =
    confidence * 0.45 +
    clamp(edge * 6, 0, 18) +
    (marketReliability - 50) * 0.12 +
    historicalBoost * 0.8 +
    getMlbQualityTierWeight(prop) * 8;
  score -= clamp((vol - 2) * 3, 0, 12);
  if (prop.lineMovement?.againstPick || movementTag === "steamed") score -= 8;
  else if (movementTag === "volatile") score -= 4;
  score += (lineTrust - 50) * 0.08;
  return round(clamp(score, 0, 100), 1);
}

export function isTopPickCandidate(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (!prop.hasVerifiedStats && !prop.manualEnriched) return false;
  if (Number(prop.edge || 0) <= 0 || !prop.bestPick) return false;
  const status = String(prop.status || "").toLowerCase();
  if (["live", "expired", "locked"].includes(status)) return false;
  if (prop.freshnessTier === "EXPIRED") return false;
  if (prop.projectionSource === "missing") return false;
  if (!Number.isFinite(prop.projectedValue ?? prop.projection)) return false;
  const confidence = Number(prop.calibratedConfidence ?? prop.confidenceScore ?? prop.confidence ?? 0);
  if (confidence < CONFIDENCE_THRESHOLDS.PLAYABLE) return false;
  const vol = finiteNumber(prop.volatility);
  if (Number.isFinite(vol) && vol >= 4.5) return false;
  return true;
}

/** Always attempt to surface the top 2 props by weighted score from accepted candidates. */
export function selectTopPicks(props = [], limit = 2) {
  const candidates = props.filter(
    (prop) =>
      isTopPickCandidate(prop) &&
      (prop.isQualificationAccepted || Number(prop.confidenceScore ?? prop.confidence ?? 0) >= CONFIDENCE_THRESHOLDS.PLAYABLE)
  );
  return [...candidates]
    .sort(
      (a, b) =>
        computeTopPickWeightedScore(b) - computeTopPickWeightedScore(a) ||
        Number(b.calibratedConfidence ?? b.confidenceScore ?? 0) - Number(a.calibratedConfidence ?? a.confidenceScore ?? 0) ||
        Number(b.edge || 0) - Number(a.edge || 0)
    )
    .slice(0, limit)
    .map((prop) => ({
      ...prop,
      topPickWeightedScore: computeTopPickWeightedScore(prop),
    }));
}

export function isDemonEligible(prop = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (!isDemonProp(prop)) return false;
  if (!prop.hasVerifiedStats && !prop.manualEnriched) return false;
  const confidence = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const edge = Number(prop.edge || 0);
  return confidence >= CONFIDENCE_THRESHOLDS.DEMON && edge >= DECISION_THRESHOLDS.STRONG_EDGE;
}

export function shouldRouteResearchOnly(prop = {}) {
  if (prop.marketResearchOnly || prop.noveltyMarket || prop.marketSupportTier === 2) return true;
  if (Number(prop.dataQualityScore || 0) < 35) return true;
  if (!Number.isFinite(prop.projectedValue ?? prop.projection) && prop.projectionSource === "missing") return true;
  if (Number(prop.volatility) >= DECISION_THRESHOLDS.HIGH_VOLATILITY && Number(prop.edge || 0) < 1.5) return true;
  return false;
}

export function enrichPropDecision(prop = {}, context = {}) {
  const bookDisagreement = detectBookDisagreement(prop);
  const lineValueScore = computeLineValueScore(prop, bookDisagreement);
  const volatilityScore = computeVolatilityScore(prop);
  const expectedValueScore = computeExpectedValueScore({ ...prop, volatilityScore });
  const decisionRankScore = computeDecisionRankScore({
    ...prop,
    lineValueScore,
    volatilityScore,
    expectedValueScore,
  });
  const decisionTier = classifyDecisionTier(prop);
  const researchOnly = shouldRouteResearchOnly(prop) || decisionTier === "research";

  let qualificationReason = prop.qualificationReason || "";
  const parts = [];
  if (Number.isFinite(prop.projectedValue ?? prop.projection)) parts.push(`Projects ${round(prop.projectedValue ?? prop.projection)}`);
  if (bookDisagreement.sportsbookLine != null) parts.push(`book ${bookDisagreement.sportsbookLine}`);
  if (Number(prop.edge) > 0) parts.push(`${prop.bestPick} +${round(prop.edge)} edge`);
  if (prop.confidenceScore) parts.push(`${prop.confidenceScore}% conf`);
  if (prop.calibratedConfidence && prop.calibratedConfidence !== prop.confidenceScore) {
    parts.push(`${prop.calibratedConfidence}% calibrated`);
  }
  if (expectedValueScore >= 55) parts.push(`EV score ${expectedValueScore}`);
  if (volatilityScore >= 70) parts.push("stable volatility");
  if (decisionTier === "topPicks") parts.push("Top Pick tier");
  else if (decisionTier === "ready") parts.push("Ready to Bet tier");
  else if (decisionTier === "demon") parts.push("Demon tier");
  if (parts.length) qualificationReason = parts.join(" · ");

  return {
    ...prop,
    bookDisagreement,
    lineValueScore,
    volatilityScore,
    expectedValueScore,
    decisionRankScore,
    decisionTier,
    marketResearchOnly: researchOnly || prop.marketResearchOnly,
    qualificationReason,
    sportsbookLine: bookDisagreement.sportsbookLine,
    bestAvailableLine: bookDisagreement.bestAvailableLine,
    volatilityTier: prop.volatilityTier || getPropVolatilityTier(prop),
    marketModel: prop.marketModel || null,
    marketModelLabel: prop.marketModelLabel || null,
    projectionAgreement: prop.projectionAgreement ?? prop.marketConfidenceAgreement ?? null,
    meetsVolatilityRequirements: prop.meetsVolatilityRequirements ?? meetsVolatilityTierRequirements(prop, prop.confidenceScore ?? prop.confidence ?? 0),
  };
}

export function sortDecisionBoard(props = []) {
  return [...props].sort(
    (a, b) =>
      Number(b.expectedValueScore ?? computeExpectedValueScore(b)) - Number(a.expectedValueScore ?? computeExpectedValueScore(a)) ||
      Number(b.calibratedConfidence ?? b.confidenceScore ?? b.confidence ?? 0) -
        Number(a.calibratedConfidence ?? a.confidenceScore ?? a.confidence ?? 0) ||
      Number(b.edge || 0) - Number(a.edge || 0) ||
      Number(a.volatility ?? Number.MAX_SAFE_INTEGER) - Number(b.volatility ?? Number.MAX_SAFE_INTEGER) ||
      Number(b.dataQualityScore || 0) - Number(a.dataQualityScore || 0) ||
      Number(b.decisionRankScore || 0) - Number(a.decisionRankScore || 0)
  );
}

export function buildScoringDebugSample(prop = {}) {
  return {
    playerName: prop.playerName,
    sport: prop.sport,
    statType: prop.statType,
    line: prop.line,
    projectedValue: prop.projectedValue ?? prop.projection,
    edge: prop.edge,
    confidenceScore: prop.confidenceScore ?? prop.confidence,
    dataQualityScore: prop.dataQualityScore,
    lineValueScore: prop.lineValueScore,
    expectedValueScore: prop.expectedValueScore,
    volatilityScore: prop.volatilityScore,
    decisionRankScore: prop.decisionRankScore,
    decisionTier: prop.decisionTier,
    riskLevel: prop.riskLevel,
  };
}

export function buildProjectionDebugSample(prop = {}) {
  return {
    playerName: prop.playerName,
    statType: prop.statType,
    projectedValue: prop.projectedValue ?? prop.projection,
    projectionSource: prop.projectionSource,
    reasoning: (prop.projectionReasoning || []).slice(0, 3).join(" | "),
    last5Average: prop.last5Average,
    last10Average: prop.last10Average,
    volatility: prop.volatility,
  };
}

export function buildLineMovementDebugSample(prop = {}) {
  const movement = prop.lineMovement || {};
  const book = prop.bookDisagreement || detectBookDisagreement(prop);
  return {
    playerName: prop.playerName,
    statType: prop.statType,
    openingLine: movement.openingLine ?? prop.lineAtGeneration,
    currentLine: movement.currentLine ?? prop.line,
    movementAmount: movement.amount ?? movement.difference,
    direction: movement.direction || movement.label,
    supportsPick: movement.supportsPick,
    againstPick: movement.againstPick,
    sportsbookLine: book.sportsbookLine,
    softLine: book.softLine,
    timestamp: movement.updatedAt || prop.generatedAt,
  };
}

export function attachDecisionDebug(audit = {}, scoredProps = []) {
  const scopedProps = filterActiveSportProps(scoredProps);
  if (!isHeavyDebugEnabled()) {
    return {
      ...audit,
      scoringDebug: [],
      projectionDebug: [],
      lineMovementDebug: [],
    };
  }
  return {
    ...audit,
    scoringDebug: buildGroupedDebugEntries(scopedProps, {
      stage: "scoring",
      reasonField: (prop) => `tier:${prop.decisionTier || "unknown"}`,
      max: MAX_DECISION_DEBUG_SAMPLES,
    }),
    projectionDebug: buildGroupedDebugEntries(scopedProps, {
      stage: "projection",
      reasonField: (prop) => prop.projectionSource || "missing",
      max: MAX_DECISION_DEBUG_SAMPLES,
    }),
    lineMovementDebug: buildGroupedDebugEntries(scopedProps, {
      stage: "lineMovement",
      reasonField: (prop) => prop.lineMovement?.label || prop.lineMovement?.direction || "none",
      max: MAX_DECISION_DEBUG_SAMPLES,
    }),
  };
}
