import {
  buildMarketConfidenceExplanation,
  getPropVolatilityTier,
  scoreMarketConfidence,
} from "./marketConfidenceModels.js";
import { getMlbQualityTier, getMlbQualityTierWeight, getMlbMinEdgeForTier } from "../utils/mlbOnlyMode.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sideAligned(edge, side = "") {
  const pick = String(side || "").toLowerCase();
  if (!Number.isFinite(edge) || !pick) return null;
  if (pick === "more" || pick === "higher") return edge > 0;
  if (pick === "less" || pick === "lower") return edge < 0;
  return Math.abs(edge) > 0;
}

function componentScore(score, max, label, detail) {
  return {
    score: round(clamp(score, 0, max), 1),
    max,
    label,
    detail,
  };
}

export const CONFIDENCE_THRESHOLDS = {
  READY: 58,
  TOP_PICKS: 72,
  ELITE: 80,
  DEMON: 80,
};

/** MLB weighted confidence pillars — normalized 0-100 output. */
export const MLB_CONFIDENCE_WEIGHTS = {
  recentHitRate: 0.14,
  matchupQuality: 0.12,
  projectionEdge: 0.2,
  lineMovement: 0.14,
  consistencyScore: 0.12,
  historicalAccuracy: 0.1,
  verifiedStatsQuality: 0.1,
  volatilityScore: 0.08,
};

export const MLB_QUALITY_TIER_WEIGHT = {
  S: 1,
  A: 0.93,
  B: 0.84,
  C: 0.72,
  UNKNOWN: 0.6,
};

export const CONFIDENCE_COMPONENTS = [
  { key: "projectionEdge", label: "Projection Edge", max: 25 },
  { key: "recentForm", label: "Recent Form", max: 15 },
  { key: "matchupQuality", label: "Matchup Quality", max: 15 },
  { key: "lineValue", label: "Line Value", max: 10 },
  { key: "volatilityControl", label: "Volatility Control", max: 10 },
  { key: "minutesUsage", label: "Minutes / Usage", max: 10 },
  { key: "marketSharpness", label: "Market Sharpness", max: 10 },
  { key: "dataQuality", label: "Data Quality", max: 5 },
];

function scoreProjectionEdge(prop = {}) {
  const line = finiteNumber(prop.line);
  const projection = finiteNumber(prop.projection);
  const edge = finiteNumber(prop.edge);
  const bestPick = prop.bestPick || prop.modelSide || "";
  let score = 0;
  let detail = "No projection edge available.";

  if (Number.isFinite(projection) && Number.isFinite(line) && line > 0) {
    const rawEdge = projection - line;
    const aligned = sideAligned(rawEdge, bestPick);
    const magnitude = Math.abs(rawEdge);
    const ratio = magnitude / line;
    score = clamp(ratio * 70 + magnitude * 4, 0, 25);
    if (aligned === false) score *= 0.35;
    detail = `Projected ${round(projection)} vs line ${round(line)} (${aligned ? "supports" : "conflicts with"} ${bestPick || "pick"}).`;
  } else if (Number.isFinite(edge) && Number.isFinite(line) && line > 0) {
    score = clamp((Math.abs(edge) / line) * 55 + Math.abs(edge) * 3, 0, 20);
    detail = `Stat edge ${round(edge)} vs line ${round(line)}.`;
  } else if (Number.isFinite(edge) && edge > 0) {
    score = clamp(edge * 6, 0, 12);
    detail = `Positive edge ${round(edge)} without full projection context.`;
  }

  return componentScore(score, 25, "Projection Edge", detail);
}

function scoreRecentForm(prop = {}) {
  const line = finiteNumber(prop.line);
  const last5 = finiteNumber(prop.last5Average);
  const last10 = finiteNumber(prop.last10Average ?? prop.seasonAverage);
  const l5Hit = finiteNumber(prop.last5HitRate);
  const l10Hit = finiteNumber(prop.last10HitRate ?? prop.recentHitRate);
  const sampleSize = finiteNumber(prop.sampleSize) || 0;
  let score = 0;
  const parts = [];

  if (Number.isFinite(l10Hit)) {
    score += clamp((l10Hit - 0.45) * 24, 0, 8);
    parts.push(`L10 hit rate ${Math.round(l10Hit * 100)}%`);
  } else if (Number.isFinite(l5Hit)) {
    score += clamp((l5Hit - 0.45) * 20, 0, 6);
    parts.push(`L5 hit rate ${Math.round(l5Hit * 100)}%`);
  }

  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    const formEdge = (last5 - line) / line;
    score += clamp(formEdge * 18, -4, 7);
    parts.push(`L5 avg ${round(last5)} vs line ${round(line)}`);
  } else if (Number.isFinite(last10) && Number.isFinite(line) && line > 0) {
    score += clamp(((last10 - line) / line) * 12, -3, 5);
    parts.push(`L10 avg ${round(last10)}`);
  }

  if (sampleSize >= 10) score += 3;
  else if (sampleSize >= 5) score += 1.5;
  else if (sampleSize > 0) parts.push("limited sample");

  const detail = parts.length ? parts.join(" · ") : "No recent form logs available.";
  return componentScore(score, 15, "Recent Form", detail);
}

function scoreMatchupQuality(prop = {}) {
  const line = finiteNumber(prop.line);
  const opponentAllowed = finiteNumber(prop.opponentAllowed);
  const opponentRank = finiteNumber(prop.opponentRank);
  const rating = String(prop.matchupRating || "Neutral");
  const bestPick = prop.bestPick || prop.modelSide || "";
  let score = 5;
  const parts = [];

  if (rating === "Favorable") {
    score += 7;
    parts.push("favorable matchup rating");
  } else if (rating === "Playable") {
    score += 4;
    parts.push("playable matchup");
  } else if (rating === "Tough") {
    score -= 4;
    parts.push("tough matchup");
  }

  if (Number.isFinite(opponentAllowed) && Number.isFinite(line) && line > 0) {
    const diff = opponentAllowed - line;
    const supportsMore = diff > 0;
    const aligned =
      !bestPick ||
      (String(bestPick).toLowerCase() === "more" && supportsMore) ||
      (String(bestPick).toLowerCase() === "less" && !supportsMore);
    score += aligned ? clamp((Math.abs(diff) / line) * 10, 0, 6) : -2;
    parts.push(`opp allows ${round(opponentAllowed)}`);
  }

  if (Number.isFinite(opponentRank)) {
    if (opponentRank >= 22) {
      score += 2;
      parts.push(`weak defense (#${Math.round(opponentRank)})`);
    } else if (opponentRank <= 8) {
      score -= 2;
      parts.push(`strong defense (#${Math.round(opponentRank)})`);
    }
  }

  if (prop.handednessMatchup) parts.push(String(prop.handednessMatchup));
  if (prop.matchupNote) parts.push(String(prop.matchupNote));
  if (prop.strikeoutTrend) parts.push(String(prop.strikeoutTrend));

  return componentScore(score, 15, "Matchup Quality", parts.length ? parts.join(" · ") : "Neutral matchup context.");
}

function scoreLineValue(prop = {}) {
  const lineComparison = prop.lineComparison || null;
  const sportsbook = prop.sportsbookComparison || null;
  const discrepancy = finiteNumber(prop.sportsbookDiscrepancy);
  let score = 0;
  const parts = [];

  if (lineComparison && Number.isFinite(lineComparison.difference)) {
    score += clamp(lineComparison.difference * 3.5, 0, 5);
    parts.push(`PP/UD gap ${round(lineComparison.difference)}`);
  }

  if (sportsbook && Number.isFinite(sportsbook.marketAverageLine) && Number.isFinite(prop.line)) {
    const bookGap = Math.abs(Number(prop.line) - Number(sportsbook.marketAverageLine));
    score += clamp(bookGap * 2.5, 0, 4);
    parts.push(`book avg ${round(sportsbook.marketAverageLine)}`);
  }

  if (Number.isFinite(discrepancy)) {
    score += clamp(discrepancy * 2.2, 0, 4);
    if (discrepancy >= 0.5) parts.push("soft DFS line vs books");
  }

  const movement = prop.lineMovement;
  if (movement?.supportsPick) {
    score += 2;
    parts.push("movement supports pick");
  } else if (movement?.againstPick) {
    score -= 2;
    parts.push("market moved against pick");
  }

  const detail = parts.length ? parts.join(" · ") : "No cross-book line comparison yet.";
  return componentScore(score, 10, "Line Value", detail);
}

function scoreVolatilityControl(prop = {}) {
  const volatility = finiteNumber(prop.volatility);
  let score = 5;
  let detail = "Volatility unknown — neutral score.";

  if (Number.isFinite(volatility)) {
    if (volatility <= 1.5) {
      score = 10;
      detail = `Low volatility (${round(volatility)}).`;
    } else if (volatility <= 2.25) {
      score = 8;
      detail = `Stable volatility (${round(volatility)}).`;
    } else if (volatility <= 3) {
      score = 5;
      detail = `Moderate volatility (${round(volatility)}).`;
    } else if (volatility <= 4) {
      score = 2.5;
      detail = `High volatility (${round(volatility)}).`;
    } else {
      score = 1;
      detail = `Very unstable (${round(volatility)}).`;
    }
  }

  return componentScore(score, 10, "Volatility Control", detail);
}

function scoreMinutesUsage(prop = {}) {
  const injuryRisk = String(prop.injuryRisk || prop.injury?.risk || "Low");
  const minutesTrend = prop.minutesTrend;
  const usageTrend = prop.usageTrend;
  const projectedMinutes = prop.projectedMinutes || prop.usageAdjustment;
  let score = 4;
  const parts = [];

  if (projectedMinutes) {
    score += 2.5;
    parts.push(String(projectedMinutes));
  }
  if (minutesTrend?.stable || usageTrend?.stable) {
    score += 2.5;
    parts.push("stable role");
  } else if (minutesTrend && !minutesTrend.stable) {
    score -= 1;
    parts.push("unstable minutes");
  }
  if (prop.pitchCountTrend || prop.roleContext) {
    score += 1.5;
    parts.push(String(prop.pitchCountTrend || prop.roleContext));
  }

  if (injuryRisk === "Low" || prop.injuryClean) score += 1.5;
  else if (injuryRisk === "Medium") score -= 2;
  else if (injuryRisk === "High") score -= 5;

  return componentScore(score, 10, "Minutes / Usage", parts.length ? parts.join(" · ") : "Limited role context.");
}

function scoreMarketSharpness(prop = {}) {
  const indicator = String(prop.sharpMoneyIndicator || "");
  const books = finiteNumber(prop.sportsbookComparison?.books) || 0;
  const discrepancy = finiteNumber(prop.sportsbookDiscrepancy);
  const movement = prop.lineMovement;
  let score = 2;
  const parts = [];

  if (indicator === "Strong alignment") {
    score = 10;
    parts.push("strong book alignment");
  } else if (indicator === "Sportsbook market supports value") {
    score = 8;
    parts.push("books support value");
  } else if (indicator === "Line moved toward model") {
    score = 6.5;
    parts.push("line moved toward model");
  } else if (indicator === "Market moved against model") {
    score = 1;
    parts.push("market moved against model");
  }

  if (books >= 3) score += 1;
  else if (books >= 2) score += 0.5;
  if (Number.isFinite(discrepancy) && discrepancy >= 0.5) parts.push(`+${round(discrepancy)} book edge`);
  if (movement?.supportsPick && score < 8) score += 1;

  return componentScore(score, 10, "Market Sharpness", parts.length ? parts.join(" · ") : "No sharp market signal yet.");
}

function scoreDataQualityComponent(prop = {}) {
  const dq = finiteNumber(prop.dataQualityScore);
  const completeness = finiteNumber(prop.dataCompleteness);
  const sampleSize = finiteNumber(prop.sampleSize) || 0;
  const verified = Boolean(prop.hasVerifiedStats || prop.verifiedHistory || prop.strongData);
  let score = 0;
  const parts = [];

  if (Number.isFinite(dq)) {
    score += clamp((dq / 100) * 3, 0, 3);
    parts.push(`DQ ${Math.round(dq)}`);
  }
  if (Number.isFinite(completeness)) {
    score += clamp((completeness / 100) * 1.5, 0, 1.5);
  }
  if (sampleSize >= 10) score += 1;
  else if (sampleSize >= 5) score += 0.5;
  else if (sampleSize > 0) parts.push(`sample ${Math.round(sampleSize)}`);
  if (verified) score += 0.5;

  return componentScore(score, 5, "Data Quality", parts.length ? parts.join(" · ") : "Sparse supporting data.");
}

function scoreHitConsistency(prop = {}) {
  const l5Hit = finiteNumber(prop.last5HitRate);
  const l10Hit = finiteNumber(prop.last10HitRate ?? prop.recentHitRate);
  const seasonHit = finiteNumber(prop.seasonHitRate);
  const sampleSize = finiteNumber(prop.sampleSize) || 0;
  let score = 0;
  const parts = [];

  const primary = l10Hit ?? l5Hit ?? seasonHit;
  if (Number.isFinite(primary)) {
    score += clamp((primary - 0.4) * 30, 0, 12);
    parts.push(`hit rate ${Math.round(primary * 100)}%`);
  }
  if (Number.isFinite(l5Hit) && Number.isFinite(l10Hit)) {
    const drift = l5Hit - l10Hit;
    if (Math.abs(drift) <= 0.08) score += 2;
    else if (drift < -0.12) score -= 2;
  }
  if (sampleSize >= 10) score += 2;
  else if (sampleSize >= 5) score += 1;
  else if (sampleSize > 0) parts.push("low sample");

  return componentScore(score, 12, "Hit Consistency", parts.length ? parts.join(" · ") : "No hit-rate history.");
}

function scoreLineMovementComponent(prop = {}) {
  const movement = prop.lineMovement || {};
  const trust = prop.lineMovementTrustScore;
  const tag = prop.lineMovementTag || movement.tag;
  let score = 5;
  const parts = [];

  if (Number.isFinite(trust)) {
    score = clamp((trust - 40) * 0.25, 0, 12);
    parts.push(`trust ${Math.round(trust)}`);
  } else if (movement.supportsPick) {
    score = 9;
    parts.push("supports pick");
  } else if (movement.againstPick) {
    score = 2;
    parts.push("against pick");
  }

  if (tag === "stable") score += 2;
  else if (tag === "falling" || tag === "dropping") score += movement.supportsPick ? 3 : -2;
  else if (tag === "rising") score += movement.supportsPick ? 2 : -3;
  else if (tag === "steamed") score -= 5;
  else if (tag === "volatile") score -= 3;

  return componentScore(score, 12, "Line Movement", parts.length ? parts.join(" · ") : "No movement signal.");
}

function scoreVerifiedStatsComponent(prop = {}) {
  const verified = Boolean(prop.hasVerifiedStats || prop.verifiedHistory || prop.strongData || prop.manualEnriched);
  const dq = finiteNumber(prop.dataQualityScore);
  let score = verified ? 6 : 0;
  const parts = verified ? ["verified stats"] : ["missing verified stats"];
  if (Number.isFinite(dq)) {
    score += clamp((dq / 100) * 4, 0, 4);
    parts.push(`DQ ${Math.round(dq)}`);
  }
  return componentScore(score, 10, "Verified Stats", parts.join(" · "));
}

function scoreHistoricalAccuracy(prop = {}) {
  const hitRate = finiteNumber(prop.historicalHitRate ?? prop.marketHistoricalHitRate);
  const sample = finiteNumber(prop.historicalSampleSize ?? prop.marketHistoricalSample) || 0;
  let score = 5;
  const parts = [];
  if (Number.isFinite(hitRate) && sample >= 5) {
    score = clamp((hitRate - 0.42) * 35 + 5, 0, 10);
    parts.push(`market ${Math.round(hitRate * 100)}% (${Math.round(sample)})`);
  } else {
    parts.push("insufficient history");
  }
  return componentScore(score, 10, "Historical Accuracy", parts.join(" · "));
}

function scoreVolatilityFactor(prop = {}) {
  const vol = finiteNumber(prop.volatility);
  const tier = getMlbQualityTier(prop) || "UNKNOWN";
  let score = tier === "S" ? 8 : tier === "A" ? 7 : tier === "B" ? 5 : 3;
  const parts = [`quality ${tier}`];
  if (Number.isFinite(vol)) {
    if (vol <= 2) score += 2;
    else if (vol >= 4) score -= 4;
    parts.push(`vol ${round(vol)}`);
  }
  const tag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (tag === "volatile" || tag === "steamed") {
    score -= 3;
    parts.push(tag);
  }
  return componentScore(score, 8, "Volatility Score", parts.join(" · "));
}

function applyMlbConfidencePenalties(score, prop = {}) {
  let next = score;
  const penalties = [];

  if (prop.lineSourceBadge === "STALE" || prop.lineSourceBadge === "CACHED") {
    next -= 8;
    penalties.push("stale data");
  }
  if (prop.projectionSource === "missing" || !Number.isFinite(prop.projection ?? prop.projectedValue)) {
    next -= 12;
    penalties.push("missing projection");
  }
  if (prop.marketResearchOnly || prop.noveltyMarket || Number(prop.marketSupportTier) >= 2) {
    next -= 10;
    penalties.push("unsupported prop");
  }
  const sampleSize = finiteNumber(prop.sampleSize) || 0;
  if (sampleSize > 0 && sampleSize < 5) {
    next -= 6;
    penalties.push("low sample size");
  }
  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (movementTag === "volatile" || (movementTag === "steamed" && prop.lineMovement?.againstPick)) {
    next -= 8;
    penalties.push("volatile line movement");
  }
  const tier = getMlbQualityTier(prop);
  if (tier) {
    const minEdge = getMlbMinEdgeForTier(prop);
    if (Number(prop.edge || 0) > 0 && Number(prop.edge || 0) < minEdge) {
      next -= tier === "C" ? 10 : tier === "B" ? 6 : 3;
      penalties.push(`${tier}-tier needs stronger edge`);
    }
  }
  const status = String(prop.status || "").toLowerCase();
  if (["live", "in progress", "inprogress"].includes(status)) {
    next -= 15;
    penalties.push("live game");
  }
  const start = new Date(prop.startTime).getTime();
  if (Number.isFinite(start) && start <= Date.now()) {
    next -= 10;
    penalties.push("started game");
  }

  return { score: next, penalties };
}

function applyConfidenceCaps(score, prop = {}, options = {}) {
  const isMlb = String(prop.sport || "").toUpperCase() === "MLB";
  const penalized = isMlb ? applyMlbConfidencePenalties(score, prop) : { score, penalties: [] };
  let capped = penalized.score;
  let capReason = penalized.penalties.length ? penalized.penalties.join("; ") : "";

  if (prop.marketResearchOnly || prop.marketSupportTier === 2 || prop.noveltyMarket) {
    capped = Math.min(capped, 55);
    capReason = capReason || "Research-only market tier.";
  }
  if (options.lineOnly) {
    capped = Math.min(capped, 68);
    capReason = capReason || "Line-only context limits confidence ceiling.";
  }
  if (prop.fallbackProfile || prop.projectionSource === "missing") {
    capped = Math.min(capped, 62);
    capReason = capReason || "Sparse stat profile.";
  }
  if (!prop.hasVerifiedStats && !prop.manualEnriched) {
    capped = Math.min(capped, 58);
    capReason = capReason || "Unverified stats reduce confidence.";
  }
  if (!Number.isFinite(prop.edge) || Number(prop.edge) <= 0) {
    capped = Math.min(capped, 54);
    capReason = capReason || "No positive edge vs line.";
  }
  if (options.statCap != null) {
    capped = Math.min(capped, options.statCap);
    if (options.statCapReason) capReason = capReason || options.statCapReason;
  }
  if (options.sportCap != null) {
    capped = Math.min(capped, options.sportCap);
    if (options.sportCapReason) capReason = capReason || options.sportCapReason;
  }

  return { score: Math.round(clamp(capped, 0, 100)), capReason };
}

function calculateMlbWeightedScore(prop = {}) {
  const components = {
    recentHitRate: scoreRecentForm(prop),
    matchupQuality: scoreMatchupQuality(prop),
    projectionEdge: scoreProjectionEdge(prop),
    lineMovement: scoreLineMovementComponent(prop),
    consistencyScore: scoreHitConsistency(prop),
    historicalAccuracy: scoreHistoricalAccuracy(prop),
    verifiedStatsQuality: scoreVerifiedStatsComponent(prop),
    volatilityScore: scoreVolatilityFactor(prop),
  };
  const maxByKey = {
    recentHitRate: 15,
    matchupQuality: 15,
    projectionEdge: 25,
    lineMovement: 12,
    consistencyScore: 12,
    historicalAccuracy: 10,
    verifiedStatsQuality: 10,
    volatilityScore: 8,
  };
  let weighted = 0;
  Object.entries(MLB_CONFIDENCE_WEIGHTS).forEach(([key, weight]) => {
    const comp = components[key];
    if (!comp) return;
    weighted += (comp.score / maxByKey[key]) * weight * 100;
  });
  const qualityWeight = getMlbQualityTierWeight(prop);
  weighted *= qualityWeight;
  const explanation = Object.entries(components).map(([key, comp]) => ({
    key,
    label: comp.label,
    score: comp.score,
    max: comp.max,
    detail: comp.detail,
  }));
  explanation.push({
    key: "qualityTier",
    label: "Prop Quality Tier",
    score: round(qualityWeight * 10, 1),
    max: 10,
    detail: `Tier ${getMlbQualityTier(prop) || "—"} weight ${round(qualityWeight * 100)}%`,
  });
  return { score: clamp(Math.round(weighted), 22, 100), breakdown: components, explanation };
}

/**
 * Calculate normalized confidence (0-100) from a scored or partially scored prop.
 * Always returns a non-zero score when a valid line exists.
 */
export function calculateConfidenceScore(prop = {}, options = {}) {
  const line = finiteNumber(prop.line);
  const hasLine = Number.isFinite(line) && line > 0;
  const marketResult = scoreMarketConfidence(prop, options);

  if (marketResult) {
    const uncapped = marketResult.adjustedScore;
    const capped = applyConfidenceCaps(uncapped, prop, options);
    let total = capped.score;
    if (!marketResult.meetsVolatilityRequirements) {
      const tierRules = marketResult.volatilityTier;
      total = Math.min(total, 54);
    }

    const explanation = buildMarketConfidenceExplanation(marketResult);
    const verifiedHistory =
      (finiteNumber(prop.sampleSize) || 0) >= 10 &&
      (Number.isFinite(prop.last10HitRate) || Number.isFinite(prop.recentHitRate));
    const strongData =
      (finiteNumber(prop.dataQualityScore) || 0) >= 65 &&
      (finiteNumber(prop.sampleSize) || 0) >= 8 &&
      Number.isFinite(prop.edge) &&
      Number(prop.edge) > 0 &&
      marketResult.meetsVolatilityRequirements;

    return {
      score: total,
      breakdown: {
        marketModel: marketResult,
      },
      explanation,
      capReason: capped.capReason || marketResult.volatilityRequirementNote || "",
      verifiedHistory,
      strongData,
      rawTotal: round(marketResult.compositeScore, 1),
      marketModel: marketResult.modelId,
      marketModelLabel: marketResult.modelLabel,
      volatilityTier: marketResult.volatilityTier,
      projectionAgreement: marketResult.agreement,
      meetsVolatilityRequirements: marketResult.meetsVolatilityRequirements,
      meetsReady: total >= CONFIDENCE_THRESHOLDS.READY && marketResult.meetsVolatilityRequirements,
      meetsTopPicks: total >= CONFIDENCE_THRESHOLDS.TOP_PICKS && marketResult.meetsVolatilityRequirements,
      meetsDemon: total >= CONFIDENCE_THRESHOLDS.DEMON && Number(prop.edge || 0) >= 1 && marketResult.meetsVolatilityRequirements,
    };
  }

  const isMlb = String(prop.sport || "").toUpperCase() === "MLB";
  if (isMlb) {
    const mlb = calculateMlbWeightedScore(prop);
    const capped = applyConfidenceCaps(mlb.score, prop, options);
    const total = capped.score;
    const verifiedHistory =
      (finiteNumber(prop.sampleSize) || 0) >= 10 &&
      (Number.isFinite(prop.last10HitRate) || Number.isFinite(prop.recentHitRate));
    const strongData =
      Boolean(prop.hasVerifiedStats || prop.manualEnriched) &&
      (finiteNumber(prop.dataQualityScore) || 0) >= 65 &&
      Number.isFinite(prop.edge) &&
      Number(prop.edge) > 0;
    return {
      score: total,
      breakdown: mlb.breakdown,
      explanation: mlb.explanation,
      capReason: capped.capReason || "",
      verifiedHistory,
      strongData,
      rawTotal: mlb.score,
      volatilityTier: getPropVolatilityTier(prop),
      meetsReady: total >= CONFIDENCE_THRESHOLDS.READY,
      meetsTopPicks: total >= CONFIDENCE_THRESHOLDS.TOP_PICKS,
      meetsDemon: total >= CONFIDENCE_THRESHOLDS.DEMON && Number(prop.edge || 0) >= 1,
    };
  }

  const breakdown = {
    projectionEdge: scoreProjectionEdge(prop),
    recentForm: scoreRecentForm(prop),
    matchupQuality: scoreMatchupQuality(prop),
    lineValue: scoreLineValue(prop),
    volatilityControl: scoreVolatilityControl(prop),
    minutesUsage: scoreMinutesUsage(prop),
    marketSharpness: scoreMarketSharpness(prop),
    dataQuality: scoreDataQualityComponent(prop),
  };

  const rawTotal = CONFIDENCE_COMPONENTS.reduce((sum, item) => sum + breakdown[item.key].score, 0);
  const baseline = hasLine ? 28 : 0;
  const uncapped = clamp(Math.round(baseline + rawTotal * 0.72), hasLine ? 25 : 0, 100);

  const capped = applyConfidenceCaps(uncapped, prop, options);
  const total = capped.score;

  const explanation = CONFIDENCE_COMPONENTS.map((item) => ({
    key: item.key,
    label: breakdown[item.key].label,
    score: breakdown[item.key].score,
    max: breakdown[item.key].max,
    detail: breakdown[item.key].detail,
  }));

  const verifiedHistory =
    (finiteNumber(prop.sampleSize) || 0) >= 10 &&
    (Number.isFinite(prop.last10HitRate) || Number.isFinite(prop.recentHitRate));
  const strongData =
    (finiteNumber(prop.dataQualityScore) || 0) >= 65 &&
    (finiteNumber(prop.sampleSize) || 0) >= 8 &&
    Number.isFinite(prop.edge) &&
    Number(prop.edge) > 0;

  return {
    score: total,
    breakdown,
    explanation,
    capReason: capped.capReason || "",
    verifiedHistory,
    strongData,
    rawTotal: round(rawTotal, 1),
    volatilityTier: getPropVolatilityTier(prop),
    meetsReady: total >= CONFIDENCE_THRESHOLDS.READY,
    meetsTopPicks: total >= CONFIDENCE_THRESHOLDS.TOP_PICKS,
    meetsDemon: total >= CONFIDENCE_THRESHOLDS.DEMON && Number(prop.edge || 0) >= 1,
  };
}

export function formatConfidenceBreakdown(result = {}) {
  return (result.explanation || []).map(
    (row) => `${row.label}: ${row.score}/${row.max} — ${row.detail}`
  );
}

/** Human-readable weighted confidence factors with penalties. */
export function formatConfidenceExplanation(result = {}) {
  const positives = (result.explanation || [])
    .filter((row) => Number(row.score) > 0)
    .map((row) => `${row.label} +${round(Number(row.score), 1)}`);
  const penalties = String(result.capReason || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    positives,
    penalties,
    summary: [...positives, ...penalties.map((p) => `− ${p}`)].join(" · "),
  };
}

export function isTopPickConfidence(prop = {}) {
  return Number(prop.confidenceScore || 0) >= CONFIDENCE_THRESHOLDS.TOP_PICKS;
}

export function isDemonPickConfidence(prop = {}) {
  const edge = Number(prop.edge || prop.modelSignal?.edge || 0);
  return Number(prop.confidenceScore || 0) >= CONFIDENCE_THRESHOLDS.DEMON && edge >= 1;
}
