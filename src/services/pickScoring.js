import {
  calculateConfidenceScore,
  CONFIDENCE_THRESHOLDS,
  isDemonPickConfidence,
  isTopPickConfidence,
} from "./confidenceEngine.js";
import {
  isTopPickEligible,
  isEliteTopPickEligible,
  isDemonEligible,
  isReadyToBetEligible,
  DECISION_THRESHOLDS,
} from "./decisionEngine.js";
import { PROJECTION_CONFIDENCE_THRESHOLDS } from "./propProjection.js";
import { dataQualityFromSignals } from "./dataQuality.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";
import { shouldRouteMlbHitterToResearch } from "./mlbHitterConfidence.js";
import { estimateModelProbability } from "./projectionEngine.js";
import { sortDecisionBoard } from "./decisionEngine.js";
import { sortBoardProps } from "./propPriority.js";
import { getMarketReadyThreshold, getStrongEdgeBypassGap } from "./marketThresholds.js";
import { getPropVolatilityTier, meetsVolatilityTierRequirements } from "./marketConfidenceModels.js";

const READY_MIN_CONFIDENCE = CONFIDENCE_THRESHOLDS.READY;
const READY_MIN_DATA_QUALITY = 45;

export { CONFIDENCE_THRESHOLDS, PROJECTION_CONFIDENCE_THRESHOLDS, isDemonPickConfidence, isTopPickConfidence, isTopPickEligible, isEliteTopPickEligible, isDemonEligible, isReadyToBetEligible, DECISION_THRESHOLDS };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export { READY_MIN_CONFIDENCE, READY_MIN_DATA_QUALITY };

export function hasValidPickFields(prop) {
  const player = String(prop.playerName || prop.player || "").trim();
  const line = Number(prop.line);
  const start = new Date(prop.startTime).getTime();
  return (
    Boolean(player && player !== "Unknown Player") &&
    Boolean(prop.statType) &&
    Number.isFinite(line) &&
    line > 0 &&
    Number.isFinite(start)
  );
}

export function isPositiveEdge(prop) {
  const edge = Number(prop.edge);
  return Number.isFinite(edge) && edge > 0 && Boolean(prop.bestPick);
}

function resolveReadyThresholdsForProp(prop, overrides = {}) {
  const market = getMarketReadyThreshold(prop);
  return {
    minConfidence: overrides.minConfidence ?? market.confidence,
    minDataQuality: overrides.minDataQuality ?? market.dataQuality,
    minEdge: overrides.minEdge ?? market.minEdge,
    relaxedStats: Boolean(overrides.relaxedStats),
  };
}

export function qualifiesStrongEdgeBypass(prop, overrides = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (!isPositiveEdge(prop)) return false;
  if (!prop.hasVerifiedStats && !prop.manualEnriched && !overrides.relaxedStats) return false;

  const thresholds = resolveReadyThresholdsForProp(prop, overrides);
  const confidence = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  const edge = Number(prop.edge || 0);
  const vol = Number(prop.volatility);
  const gap = thresholds.minConfidence - confidence;
  if (gap <= 0) return true;

  const maxGap = getStrongEdgeBypassGap(prop);
  if (gap > maxGap) return false;
  if (edge < thresholds.minEdge) return false;
  if (Number.isFinite(vol) && vol > 2.85) return false;

  const matchupStrong =
    Number(prop.matchupRating) >= 58 ||
    Boolean(prop.handednessMatchup) ||
    Boolean(prop.matchupNote);
  if (gap <= 3) return edge >= 1.0 && (matchupStrong || !Number.isFinite(vol) || vol <= 2.35);
  if (gap <= 4) return edge >= 1.15 && matchupStrong && (!Number.isFinite(vol) || vol <= 2.5);
  return edge >= 1.35 && matchupStrong && Number.isFinite(vol) && vol <= 2.0;
}

function passesVolatilityGate(prop, confidence, thresholds) {
  if (prop.meetsVolatilityRequirements !== false) return true;
  const tier = getPropVolatilityTier(prop);
  const edge = Number(prop.edge || 0);
  const vol = Number(prop.volatility);
  if (qualifiesStrongEdgeBypass(prop, thresholds)) return true;
  if (tier === "LOW" && edge >= 0.65 && confidence >= thresholds.minConfidence - 2) return true;
  if (tier === "MEDIUM" && edge >= 0.95 && confidence >= thresholds.minConfidence && (!Number.isFinite(vol) || vol <= 2.75)) {
    return true;
  }
  return meetsVolatilityTierRequirements(prop, confidence);
}

export function isLineOnlyData(prop, { profile, lineComparison, sportsbookComparison, injury, projectionSource }) {
  if (prop.isDemoData || prop.manualEntry) return false;
  const hasStats =
    Number(profile?.sampleSize || 0) >= 3 ||
    Number.isFinite(Number(profile?.last5Average)) ||
    Number.isFinite(Number(profile?.seasonAverage)) ||
    Number.isFinite(Number(prop.last5Average)) ||
    Number.isFinite(Number(prop.seasonAverage));
  const hasMarketProjection =
    projectionSource === "sportsbook-market" ||
    projectionSource === "platform-line-comparison" ||
    projectionSource === "player-stats" ||
    projectionSource === "player-stats-estimate" ||
    projectionSource === "manual-stats";
  const hasExternal =
    Boolean(lineComparison) ||
    Boolean(sportsbookComparison) ||
    Boolean(injury) ||
    hasMarketProjection ||
    Boolean(prop.manualStats?.last5Average) ||
    Boolean(prop.manualStats?.seasonAverage);
  const missingProjection = projectionSource === "missing" || !Number.isFinite(Number(prop.projection));
  return !hasStats && !hasExternal && missingProjection;
}

export function assessResearchGaps({ prop, profile, injury, lineComparison, sportsbookComparison }) {
  const manual = prop.manualStats || {};
  const gaps = [];

  const hasLogs =
    Number(profile?.sampleSize || 0) >= 3 ||
    Number.isFinite(Number(profile?.last5HitRate)) ||
    Number.isFinite(Number(manual.last5Average)) ||
    Number.isFinite(Number(prop.last5Average));
  if (!hasLogs) gaps.push("no recent game logs");

  const hasOpponent =
    Boolean(profile?.opponentAllowed) ||
    Boolean(profile?.opponentRank) ||
    Boolean(manual.opponentAllowed) ||
    Boolean(manual.opponentRank) ||
    Boolean(manual.matchupNote) ||
    /favorable|tough|playable/i.test(String(prop.matchupRating || ""));
  if (!hasOpponent) gaps.push("no opponent stats");

  const hasAverages =
    Number.isFinite(Number(profile?.seasonAverage)) ||
    Number.isFinite(Number(profile?.last5Average)) ||
    Number.isFinite(Number(manual.seasonAverage)) ||
    Number.isFinite(Number(manual.last5Average)) ||
    Number.isFinite(Number(prop.seasonAverage)) ||
    Number.isFinite(Number(prop.last5Average));
  if (!hasAverages) gaps.push("no player averages");

  const hasInjury =
    Boolean(injury) ||
    Boolean(manual.injuryNote) ||
    String(prop.injuryRisk || "").toLowerCase() !== "low" ||
    Boolean(prop.injuryNote);
  if (!hasInjury) gaps.push("no injury/news check");

  const hasLineComp =
    Boolean(lineComparison) ||
    Boolean(sportsbookComparison) ||
    Number.isFinite(Number(prop.sportsbookDiscrepancy)) && Number(prop.sportsbookDiscrepancy) !== 0;
  if (!hasLineComp) gaps.push("no sportsbook/DFS line comparison");

  return {
    gaps,
    missingCount: gaps.length,
    showBadge: gaps.length >= 2,
  };
}

export function buildDataCompletenessScore({ profile, injury, lineComparison, sportsbookComparison, prop, research }) {
  let score = 20;
  if (Number(profile?.sampleSize || 0) >= 8) score += 18;
  else if (Number(profile?.sampleSize || 0) >= 3) score += 10;
  if (Number.isFinite(Number(profile?.last5Average)) || Number.isFinite(Number(prop.manualStats?.last5Average))) score += 12;
  if (Number.isFinite(Number(profile?.seasonAverage)) || Number.isFinite(Number(prop.manualStats?.seasonAverage))) score += 10;
  if (injury || prop.manualStats?.injuryNote) score += 10;
  if (lineComparison) score += 12;
  if (sportsbookComparison) score += 14;
  if (research.missingCount <= 1) score += 8;
  return clamp(score, 0, 100);
}

export function mergeManualStatsIntoProfile(profile = {}, manual = {}) {
  if (!manual || typeof manual !== "object") return profile;
  const last5 = Number(manual.last5Average);
  const season = Number(manual.seasonAverage);
  const line = Number(manual.line ?? profile.line);
  const merged = { ...profile, manualEnriched: true };
  if (Number.isFinite(last5)) {
    merged.last5Average = last5;
    merged.recentHitRate = profile.recentHitRate;
    merged.sampleSize = Math.max(Number(profile.sampleSize || 0), 5);
    if (Number.isFinite(line) && line > 0) {
      merged.projection = last5;
      merged.projectionSource = "manual-stats";
    }
  }
  if (Number.isFinite(season)) {
    merged.seasonAverage = season;
    if (!Number.isFinite(merged.projection)) {
      merged.projection = season;
      merged.projectionSource = "manual-stats";
    }
  }
  if (manual.opponentAllowed != null && manual.opponentAllowed !== "") {
    merged.opponentAllowed = Number(manual.opponentAllowed);
  }
  if (manual.opponentRank != null && manual.opponentRank !== "") {
    merged.opponentRank = Number(manual.opponentRank);
  }
  if (manual.matchupNote) {
    merged.matchupNote = String(manual.matchupNote);
    merged.hasMatchup = true;
  }
  if (manual.injuryNote) {
    merged.injuryNote = String(manual.injuryNote);
    merged.injuryClean = !/out|doubt|injur|gtd|question/i.test(String(manual.injuryNote));
  }
  if (manual.minutesNote) {
    merged.minutesNote = String(manual.minutesNote);
    merged.usageAdjustment = String(manual.minutesNote);
    merged.hasRoleContext = true;
  }
  if (manual.pitchCountNote) {
    merged.pitchCountNote = String(manual.pitchCountNote);
    merged.pitchCountTrend = String(manual.pitchCountNote);
    merged.hasRoleContext = true;
  }
  if (manual.confidenceAdjustment != null && manual.confidenceAdjustment !== "") {
    merged.confidenceAdjustment = Number(manual.confidenceAdjustment);
  }
  if (Number.isFinite(last5) || Number.isFinite(season)) {
    merged.hasPlayerAverage = true;
    merged.manualEnriched = true;
    merged.statSources = [...new Set([...(merged.statSources || []), "manual input"])];
  }
  return merged;
}

export function buildLowConfidenceReasons(prop, research = { gaps: [] }) {
  const reasons = [];
  const confidence = Number(prop.confidenceScore || 0);
  const dq = Number(prop.dataQualityScore || 0);
  const edge = Number(prop.edge);

  if (prop.marketResearchOnly || prop.marketSupportTier === 2) {
    reasons.push("Research-only market tier — novelty props are not eligible for Ready to Bet.");
  }
  if (shouldRouteMlbHitterToResearch(prop, prop, { lineOnly: prop.lineOnlyData })) {
    reasons.push("MLB hitter prop needs more verified logs before Ready to Bet.");
  }
  if (confidence < READY_MIN_CONFIDENCE) {
    reasons.push(`Confidence ${confidence}% is below the ${READY_MIN_CONFIDENCE}% ready threshold.`);
  }
  if (dq < READY_MIN_DATA_QUALITY) {
    reasons.push(`Data quality ${dq}/100 is below the ${READY_MIN_DATA_QUALITY} minimum.`);
  }
  if (!isPositiveEdge(prop)) {
    reasons.push("No positive projection edge vs the posted line.");
  }
  if (prop.statsMissingExplanation) {
    reasons.push(prop.statsMissingExplanation);
  }
  if (prop.lineOnlyData) {
    reasons.push(`Only a ${prop.platform || "DFS"} line is available — confidence is limited without stat or market context.`);
  }
  if (prop.fallbackProfile || prop.projectionSource === "missing") {
    reasons.push("Stat profile or projection is missing.");
  }
  if (research.gaps?.length) {
    reasons.push(`Research gaps: ${research.gaps.join(", ")}.`);
  }
  if (prop.confidenceCapReason) {
    reasons.push(prop.confidenceCapReason);
  }
  return reasons.slice(0, 6);
}

export function isReadyToBet(prop, thresholds = {}) {
  return getReadyToBetRejectReason(prop, thresholds) === "";
}

export function getReadyToBetRejectReason(prop, thresholds = {}) {
  if (!isVerifiedSportsbookProp(prop)) return "not a verified sportsbook prop";
  if (prop.unsupportedSport || prop.marketUnsupported || prop.esports) return "unsupported sport or market";
  if (prop.marketResearchOnly || prop.marketSupportTier === 2 || prop.noveltyMarket) return "research-only market tier";
  if (
    shouldRouteMlbHitterToResearch(prop, {
      sampleSize: prop.sampleSize || prop.modelSignal?.sampleSize,
      sparse: prop.sparseProfile,
      fallback: prop.fallbackProfile,
      manualEnriched: prop.manualEnriched,
    }, { lineOnly: prop.lineOnlyData })
  ) {
    return "MLB hitter research-only — insufficient data";
  }
  if (!hasValidPickFields(prop)) return "missing required pick fields";
  if (!isPositiveEdge(prop)) return "no positive edge";
  if (prop.lineOnlyData && !thresholds.relaxedStats) return "line-only data";
  const status = String(prop.status || "").toLowerCase();
  if (status === "locked" || status === "expired" || status === "live") return `prop status is ${status}`;
  const start = new Date(prop.startTime).getTime();
  if (!Number.isFinite(start) || start <= Date.now()) return "game already started or missing start time";

  const resolved = resolveReadyThresholdsForProp(prop, thresholds);
  const minConfidence = resolved.minConfidence;
  const minDataQuality = resolved.minDataQuality;
  const minEdge = resolved.minEdge;
  const confidence = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  const dataQualityScore = Number(prop.dataQualityScore || prop.modelSignal?.dataQualityScore || 0);
  const edge = Number(prop.edge || 0);
  const verified = Boolean(prop.hasVerifiedStats || prop.manualEnriched);
  if (!verified && !thresholds.relaxedStats) return "missing verified stats";
  if (edge < minEdge && !qualifiesStrongEdgeBypass(prop, thresholds)) return `edge ${round(edge)} below ${minEdge}`;
  if (confidence < minConfidence && !qualifiesStrongEdgeBypass(prop, thresholds)) {
    return `confidence ${confidence} below ${minConfidence}`;
  }
  if (dataQualityScore < minDataQuality && !thresholds.relaxedStats && !qualifiesStrongEdgeBypass(prop, thresholds)) {
    return `data quality ${dataQualityScore} below ${minDataQuality}`;
  }
  if (!passesVolatilityGate(prop, confidence, resolved)) return "volatility tier requirements";
  return "";
}

export function deriveEdgeFromProjection(prop, projection, line) {
  const proj = Number(projection);
  const ln = Number(line);
  if (!Number.isFinite(proj) || !Number.isFinite(ln)) return { edge: Number(prop.edge) || 0, bestPick: prop.bestPick || "" };
  const diff = proj - ln;
  if (Math.abs(diff) < 0.05) return { edge: 0, bestPick: "" };
  return { edge: Math.abs(diff), bestPick: diff > 0 ? "More" : "Less" };
}

/** Resolve side/edge from projection, sportsbook market, or cross-platform line gap. */
export function resolvePickEdge({
  prop = {},
  projection = null,
  line,
  projectionSource = "missing",
  sportsbookComparison = null,
  lineComparison = null,
}) {
  const ln = Number(line);
  let proj = Number.isFinite(Number(projection)) ? Number(projection) : null;
  let bestPick = "";
  let edge = 0;
  let source = projectionSource;

  if (Number.isFinite(proj) && Number.isFinite(ln)) {
    const derived = deriveEdgeFromProjection(prop, proj, ln);
    bestPick = derived.bestPick || "";
    edge = Number(derived.edge) || 0;
  }

  const marketLine = Number(sportsbookComparison?.marketAverageLine);
  if (Number.isFinite(marketLine) && Number.isFinite(ln)) {
    if (!Number.isFinite(proj)) {
      proj = marketLine;
      source = source === "missing" ? "sportsbook-market" : source;
    }
    const moreEdge = marketLine - ln;
    const lessEdge = ln - marketLine;
    if ((!bestPick || edge < 0.05) && moreEdge >= 0.05 && moreEdge >= lessEdge) {
      bestPick = "More";
      edge = moreEdge;
    } else if ((!bestPick || edge < 0.05) && lessEdge >= 0.05) {
      bestPick = "Less";
      edge = lessEdge;
    } else if (edge < 0.05 && Math.abs(moreEdge) >= 0.05) {
      bestPick = moreEdge >= 0 ? "More" : "Less";
      edge = Math.abs(moreEdge);
    }
  }

  const peerLine = Number(lineComparison?.marketAverageLine);
  if ((!bestPick || edge < 0.05) && Number.isFinite(peerLine) && Number.isFinite(ln)) {
    const diff = peerLine - ln;
    if (Math.abs(diff) >= 0.05) {
      bestPick = diff > 0 ? "More" : "Less";
      edge = Math.abs(diff);
      if (!Number.isFinite(proj)) {
        proj = peerLine;
        source = source === "missing" ? "platform-line-comparison" : source;
      }
    }
  }

  return {
    projection: Number.isFinite(proj) ? proj : null,
    projectionSource: source,
    bestPick,
    edge: round(edge),
  };
}

export function scoreConfidenceFromSignals(inputs = {}) {
  const profile = inputs.profile || {};
  const prop = {
    sport: inputs.sport || profile.sport,
    statType: inputs.statType || profile.statType,
    line: inputs.line,
    edge: inputs.edge,
    projection: inputs.profile?.projection ?? inputs.projection,
    projectionSource: inputs.projectionSource,
    bestPick: inputs.bestPick,
    last5Average: inputs.last5Average ?? profile.last5Average,
    last10Average: inputs.profile?.last10Average,
    seasonAverage: inputs.seasonAverage ?? profile.seasonAverage,
    recentHitRate: inputs.recentHitRate ?? profile.recentHitRate,
    last5HitRate: inputs.profile?.last5HitRate,
    last10HitRate: inputs.profile?.last10HitRate,
    volatility: inputs.profile?.volatility,
    sampleSize: inputs.sampleSize ?? profile.sampleSize,
    opponentAllowed: inputs.opponentAllowed ?? profile.opponentAllowed,
    opponentRank: inputs.profile?.opponentRank,
    dataQualityScore: inputs.dataQualityScore,
    dataCompleteness: inputs.dataCompleteness,
    matchupRating: inputs.matchupRating,
    sportsbookComparison: inputs.sportsbookComparison,
    sportsbookDiscrepancy: inputs.sportsbookDiscrepancy,
    lineComparison: inputs.lineComparison,
    lineMovement: inputs.lineMovement,
    sharpMoneyIndicator: inputs.sharpMoneyIndicator,
    injuryRisk: inputs.profile?.injuryRisk ?? inputs.injuryRisk,
    fallbackProfile: inputs.profileIsFallback,
    hasVerifiedStats: inputs.profile?.hasGameLogs,
    minutesTrend: inputs.profile?.minutesTrend,
    usageTrend: inputs.profile?.usageTrend,
    projectedMinutes: inputs.profile?.projectedMinutes,
    usageAdjustment: inputs.profile?.usageAdjustment,
    pitchCountTrend: inputs.profile?.pitchCountTrend,
    handednessMatchup: inputs.profile?.handednessMatchup,
    strikeoutTrend: inputs.profile?.strikeoutTrend,
    matchupNote: inputs.profile?.matchupNote,
    roleContext: inputs.profile?.roleContext,
    parkFactorNote: inputs.profile?.parkFactorNote,
    battingOrderNote: inputs.profile?.battingOrderNote,
    barrelRateEstimate: inputs.profile?.barrelRateEstimate,
    gapPowerRate: inputs.profile?.gapPowerRate,
    extraBaseHitRate: inputs.profile?.extraBaseHitRate,
    recentStolenBaseRate: inputs.profile?.recentStolenBaseRate,
    last5FantasyScores: inputs.profile?.last5FantasyScores,
    holdPct: inputs.profile?.holdPct,
    breakPct: inputs.profile?.breakPct,
    aceRate: inputs.profile?.aceRate,
    h2hEdge: inputs.profile?.h2hEdge,
    surface: inputs.profile?.surface,
    firstServePct: inputs.profile?.firstServePct,
    expectedSets: inputs.profile?.expectedSets,
    opponentReturnPct: inputs.profile?.opponentReturnPct,
    pace: inputs.profile?.pace,
    paceRating: inputs.profile?.paceRating,
    impliedRuns: inputs.profile?.impliedRuns,
    totalImpliedRuns: inputs.profile?.totalImpliedRuns,
    weatherRating: inputs.weatherRating ?? profile.weatherRating,
    umpireRating: inputs.umpireRating ?? profile.umpireRating,
    backToBack: inputs.backToBack ?? profile.backToBack,
    blowoutRisk: inputs.blowoutRisk ?? profile.blowoutRisk,
    restNote: inputs.restNote ?? profile.restNote,
    profile,
  };
  return calculateConfidenceScore(prop, { lineOnly: inputs.lineOnly });
}

export function rescoredPropFields(prop, context = {}) {
  const profile = mergeManualStatsIntoProfile(context.profile || {}, prop.manualStats);
  const line = Number(prop.line);
  const projection = Number.isFinite(Number(prop.projection))
    ? Number(prop.projection)
    : Number.isFinite(Number(profile.projection))
      ? Number(profile.projection)
      : null;
  const hasProjection = Number.isFinite(projection);
  const projectionEdge = hasProjection ? projection - line : 0;
  const bestPick = hasProjection && projectionEdge > 0 ? "More" : hasProjection && projectionEdge < 0 ? "Less" : prop.bestPick || "";
  const edge = bestPick ? Math.abs(projectionEdge) : Number(prop.edge) || 0;
  const research = assessResearchGaps({
    prop,
    profile,
    injury: context.injury,
    lineComparison: context.lineComparison,
    sportsbookComparison: context.sportsbookComparison,
  });
  const dataCompleteness = buildDataCompletenessScore({
    profile,
    injury: context.injury,
    lineComparison: context.lineComparison,
    sportsbookComparison: context.sportsbookComparison,
    prop,
    research,
  });
  const lineOnly = isLineOnlyData(prop, {
    profile,
    lineComparison: context.lineComparison,
    sportsbookComparison: context.sportsbookComparison,
    injury: context.injury,
    projectionSource: prop.projectionSource || profile.projectionSource,
  });
  const dq = dataQualityFromSignals({
    profile,
    injury: context.injury,
    lineComparison: context.lineComparison,
    sportsbookComparison: context.sportsbookComparison,
    projection,
    projectionSource: prop.projectionSource || profile.projectionSource || "missing",
  });

  const confidenceResult = scoreConfidenceFromSignals({
    sport: prop.sport,
    statType: prop.statType,
    edge,
    line,
    projectionScore: hasProjection ? clamp((Math.abs(projectionEdge) / Math.max(1, line)) * 70, 0, 26) : 0,
    consistencyScore: Number.isFinite(profile.recentHitRate) ? clamp((profile.recentHitRate - 0.45) * 38, 0, 13) : 0,
    sampleScore: Number(profile.sampleSize || 0) >= 10 ? 7 : Number(profile.sampleSize || 0) >= 3 ? 4 : 0,
    lineValueBoost: context.lineComparison ? Math.min(10, Math.abs(context.lineComparison.difference || 0) * 4) : 0,
    sportsbookBoost: context.sportsbookComparison ? 6 : 0,
    dataQualityScore: dq,
    volatilityPenalty: Number.isFinite(profile.volatility) ? clamp(profile.volatility * 1.8, 0, 12) : 0,
    injuryPenalty: context.injury?.risk === "High" ? 18 : context.injury?.risk === "Medium" ? 8 : 0,
    projectionSource: prop.projectionSource || profile.projectionSource || "missing",
    profileIsFallback: Boolean(profile.fallback),
    recentHitRate: profile.recentHitRate,
    sampleSize: profile.sampleSize || 0,
    profile,
    matchupRating: prop.matchupRating,
    seasonAverage: profile.seasonAverage ?? prop.seasonAverage,
    last5Average: profile.last5Average ?? prop.last5Average,
    opponentAllowed: profile.opponentAllowed,
    dataCompleteness,
    lineOnly,
  });

  const lowConfidenceReasons = buildLowConfidenceReasons(
    { ...prop, confidenceScore: confidenceResult.score, dataQualityScore: dq, edge, lineOnlyData: lineOnly },
    research
  );

  return {
    projection,
    bestPick,
    edge: round(edge),
    confidenceScore: confidenceResult.score,
    dataQualityScore: Math.round(dq),
    dataCompleteness,
    lineOnlyData: lineOnly,
    researchGaps: research.gaps,
    researchMissingBadge: research.showBadge ? { label: "Research Missing", tone: "weak" } : null,
    lowConfidenceReasons,
    confidenceCapReason: confidenceResult.capReason || (lineOnly ? "Limited stat context — confidence derived mainly from line/market signals." : ""),
    strongData: confidenceResult.strongData,
    verifiedHistory: confidenceResult.verifiedHistory,
    modelProbability: estimateModelProbability({
      edge,
      line,
      confidenceScore: confidenceResult.score,
      dataQualityScore: dq,
      volatility: profile.volatility,
    }),
  };
}

export function resolveReadyThresholds(props = []) {
  const verified = props.filter(isVerifiedSportsbookProp);
  const countAt = (overrides = {}) => verified.filter((prop) => isReadyToBet(prop, overrides)).length;

  const baseCount = countAt({});
  if (baseCount >= 5 && baseCount <= 20) return { relaxedStats: false, dqRelax: 0 };
  if (baseCount > 20) return { relaxedStats: false, dqRelax: 0 };

  const ladders = [
    { relaxedStats: false, dqRelax: 3 },
    { relaxedStats: false, dqRelax: 5 },
    { relaxedStats: true, dqRelax: 5 },
    { relaxedStats: true, dqRelax: 7 },
  ];

  for (const ladder of ladders) {
    const overrides = {
      minDataQuality: READY_MIN_DATA_QUALITY - ladder.dqRelax,
      relaxedStats: ladder.relaxedStats,
    };
    const count = countAt(overrides);
    if (count >= 5) return ladder;
  }

  if (baseCount > 0) return { relaxedStats: false, dqRelax: 0 };
  return { relaxedStats: true, dqRelax: 7 };
}

export function filterReadyToBetProps(props = []) {
  const ladder = resolveReadyThresholds(props);
  const thresholds = {
    minDataQuality: READY_MIN_DATA_QUALITY - (ladder.dqRelax || 0),
    relaxedStats: Boolean(ladder.relaxedStats),
  };
  return sortDecisionBoard(props.filter((prop) => isReadyToBet(prop, thresholds)));
}
