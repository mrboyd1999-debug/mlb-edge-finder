import { canonicalMarketKey } from "../utils/marketNormalization.js";
import {
  isMlbHitterPhase2Market,
  isMlbPitcherMarket,
  projectMlbHitterProp,
  projectMlbPitcherProp,
} from "./mlbProjectionEngine.js";
import {
  AWAITING_PROJECTION_STATUS,
  computeDirectionalEdgeForSide,
  computeRawEdge,
  confidenceFromEdge,
  NO_VERIFIED_PLAY_STATUS,
  PASS_STATUS,
  resolveRecommendedSide,
  shouldPassPlay,
} from "./propSideEngine.js";

const MLB_VOLATILITY = {
  strikeouts: { tier: "LOW", score: 0.38, label: "Low variance" },
  outs: { tier: "MEDIUM", score: 0.52, label: "Medium variance" },
  hitsAllowed: { tier: "MEDIUM", score: 0.65, label: "Medium/high variance" },
  earnedRuns: { tier: "HIGH", score: 0.72, label: "High variance" },
  fantasyScore: { tier: "MEDIUM", score: 0.56, label: "Medium variance" },
  hrr: { tier: "HIGH", score: 0.82, label: "High variance" },
  totalBases: { tier: "MEDIUM", score: 0.55, label: "Medium variance" },
};

function getVolatility(statType = "") {
  const key = canonicalMarketKey(statType);
  return MLB_VOLATILITY[key] || { tier: "MEDIUM", score: 0.5, label: "Medium variance" };
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function classifyRisk({ edge, volatility, payoutType }) {
  const absEdge = Math.abs(Number(edge) || 0);
  const volScore = Number(volatility?.score ?? 0.5);
  const payout = String(payoutType || "standard").toLowerCase();
  if (payout === "demon" || volScore >= 0.75) return "High";
  if (absEdge >= 0.9 && volScore <= 0.45) return "Low";
  if (absEdge >= 0.55 || volScore <= 0.55) return "Medium";
  return "High";
}

export function isMlbVerifiedEngineMarket(statType = "") {
  return isMlbPitcherMarket(statType) || isMlbHitterPhase2Market(statType);
}

/**
 * Unified verified MLB projection output for manual + live board paths.
 */
export function buildMlbPropProjection(prop = {}, profile = {}, context = {}) {
  const line = Number(prop.line);
  const statType = prop.statType || "";
  const marketKey = canonicalMarketKey(statType);
  const volatility = getVolatility(statType);
  const payoutType = prop.payoutType || prop.oddsType || prop.payoutRole || "standard";

  if (!isMlbVerifiedEngineMarket(statType)) {
    return {
      projection: null,
      line: Number.isFinite(line) ? line : null,
      rawEdge: null,
      recommendedSide: null,
      modelSide: null,
      modelPickLabel: null,
      confidence: null,
      risk: null,
      volatility,
      dataStatus: null,
      projectionSource: "unsupported-market",
      reasons: ["Market not supported by verified MLB projection engine."],
      projectionUnavailable: true,
      passPlay: true,
      displayStatus: NO_VERIFIED_PLAY_STATUS,
      statusMessage: AWAITING_PROJECTION_STATUS,
      isVerifiedProjection: false,
      isFallbackProjection: true,
      engineResult: null,
    };
  }

  const engineResult = isMlbPitcherMarket(statType)
    ? projectMlbPitcherProp(prop, profile, context)
    : projectMlbHitterProp(prop, profile, context);

  const projection = finiteOr(engineResult?.projectedValue);
  const verified = Boolean(engineResult?.isVerifiedProjection && projection != null && projection > 0);

  if (!verified) {
    const reasons = engineResult?.reasoning?.length
      ? engineResult.reasoning.slice(0, 3)
      : ["Verified MLB data unavailable for this prop."];
    return {
      projection: null,
      line: Number.isFinite(line) ? line : null,
      rawEdge: null,
      recommendedSide: null,
      modelSide: null,
      modelPickLabel: NO_VERIFIED_PLAY_STATUS,
      confidence: null,
      risk: null,
      volatility,
      dataStatus: engineResult?.dataStatus || null,
      projectionSource: engineResult?.projectionSource || "missing",
      reasons,
      projectionUnavailable: true,
      passPlay: true,
      displayStatus: NO_VERIFIED_PLAY_STATUS,
      statusMessage: AWAITING_PROJECTION_STATUS,
      isVerifiedProjection: false,
      isFallbackProjection: true,
      projectionBreakdown: engineResult?.projectionBreakdown || [],
      projectionLabel: engineResult?.projectionLabel || null,
      engineResult,
    };
  }

  const rawEdge = computeRawEdge(projection, line);
  const recommendedSide = resolveRecommendedSide(projection, line);
  const edge = recommendedSide ? computeDirectionalEdgeForSide(projection, line, recommendedSide) : 0;
  const confidence = confidenceFromEdge(Math.abs(rawEdge ?? 0), {
    volatility,
    payoutType,
    marketKey,
    isVerified: true,
    consistencyScore: profile.consistencyScore ?? engineResult?.pitcherInputs?.consistencyScore ?? null,
    matchupQuality: profile.handednessMatchup ? "neutral" : null,
  });
  const passPlay = shouldPassPlay({ edge, confidence, isVerified: true });
  const risk = classifyRisk({ edge, volatility, payoutType });
  const modelSide = passPlay ? PASS_STATUS : recommendedSide?.toUpperCase() || null;
  const modelPickLabel = passPlay ? PASS_STATUS : recommendedSide ? recommendedSide.toUpperCase() : null;

  const reasons = buildProjectionReasons({
    engineResult,
    projection,
    line,
    recommendedSide,
    edge,
    passPlay,
    volatility,
    profile,
  });

  return {
    projection: round(projection, 1),
    line: Number.isFinite(line) ? line : null,
    rawEdge,
    edge,
    edgePercent: Number.isFinite(line) && line > 0 ? round((Math.abs(edge) / line) * 100, 1) : null,
    recommendedSide: passPlay ? null : recommendedSide,
    modelSide,
    modelPickLabel,
    confidence,
    risk,
    volatility,
    volatilityLabel: volatility.label,
    dataStatus: engineResult.dataStatus,
    projectionSource: engineResult.projectionSource || "player-stats-model",
    reasons,
    projectionUnavailable: false,
    passPlay,
    displayStatus: passPlay ? PASS_STATUS : modelPickLabel,
    statusMessage: passPlay ? "Edge or confidence below threshold — PASS on this prop." : null,
    isVerifiedProjection: true,
    isFallbackProjection: false,
    projectionBreakdown: engineResult.projectionBreakdown || [],
    projectionLabel: engineResult.projectionLabel,
    projectionConfidence: engineResult.projectionConfidence ?? confidence,
    whyThisPick: reasons.slice(0, 2).join(" "),
    engineResult,
  };
}

function finiteOr(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildProjectionReasons({
  engineResult,
  projection,
  line,
  recommendedSide,
  edge,
  passPlay,
  volatility,
  profile,
}) {
  const reasons = [];
  const breakdown = engineResult?.projectionBreakdown || [];
  breakdown
    .filter((row) => row.label && !/data status|final projection/i.test(row.label))
    .slice(0, 2)
    .forEach((row) => reasons.push(`${row.label}: ${row.display ?? row.value}`));

  if (passPlay) {
    reasons.push("Edge or confidence below play threshold.");
    return reasons.slice(0, 3);
  }

  if (recommendedSide && Number.isFinite(projection) && Number.isFinite(line)) {
    reasons.push(
      `Model ${recommendedSide.toUpperCase()} — projection ${projection} vs line ${line} (${edge >= 0 ? "+" : ""}${round(edge, 2)} edge).`
    );
  }
  if (volatility?.label) reasons.push(`Volatility: ${volatility.label}.`);
  if (profile?.handednessMatchup) reasons.push(profile.handednessMatchup);
  return reasons.slice(0, 3);
}

export function applyMlbProjectionToProp(prop = {}, profile = {}, context = {}) {
  const model = buildMlbPropProjection(prop, profile, context);
  return {
    ...prop,
    projectedValue: model.projection,
    projection: model.projection,
    rawEdge: model.rawEdge,
    edge: model.edge ?? 0,
    edgePercent: model.edgePercent,
    bestPick: model.recommendedSide,
    side: model.recommendedSide,
    pick: model.recommendedSide,
    recommendedSide: model.modelSide,
    modelPick: model.modelPickLabel,
    modelSide: model.modelSide,
    confidence: model.confidence,
    confidenceScore: model.confidence,
    riskLevel: model.risk,
    volatility: model.volatility?.score,
    volatilityLabel: model.volatilityLabel,
    dataStatus: model.dataStatus,
    projectionSource: model.projectionSource,
    projectionBreakdown: model.projectionBreakdown,
    projectionLabel: model.projectionLabel,
    isVerifiedProjection: model.isVerifiedProjection,
    isFallbackProjection: model.isFallbackProjection,
    projectionUnavailable: model.projectionUnavailable,
    passPlay: model.passPlay,
    displayStatus: model.displayStatus,
    statusMessage: model.statusMessage,
    whyThisPick: model.whyThisPick,
    premiumWhySummary: model.whyThisPick,
    qualificationReason: model.whyThisPick,
    analyticsReason: model.reasons?.join(" · ") || prop.analyticsReason,
    modelReasons: model.reasons,
    noEdge: model.passPlay || model.projectionUnavailable,
    isDisplayPlayable: !model.passPlay && !model.projectionUnavailable && Boolean(model.recommendedSide),
    bettingLabel: model.projectionUnavailable
      ? NO_VERIFIED_PLAY_STATUS
      : model.passPlay
        ? PASS_STATUS
        : model.modelPickLabel,
  };
}
