import { playerNamesMatch } from "./playerNames.js";
import { normalize, formatNumber } from "./formatters.js";
import { canonicalMarketKey, marketDisplayLabel } from "./marketNormalization.js";
import { buildRealProjection, hasRealStatInputs } from "../services/realProjectionEngine.js";
import {
  hasMlbPitcherStatInputs,
  isMlbPitcherMarket,
  isStrikeoutMarket,
  projectMlbPitcherProp,
  projectMlbHitterProp,
  projectPitcherStrikeouts,
  hasMlbHitterStatInputs,
  isMlbHitterPhase2Market,
  DATA_STATUS,
} from "../modules/mlbProjectionEngine.js";
import { scorePitcherManualProp } from "../modules/scoringEngine.js";
import {
  isFallbackDataStatus,
  isVerifiedProjectionStatus,
  VERIFIED_PROJECTION_LABEL,
} from "../modules/projectionBreakdown.js";
import {
  buildSideEngineDebug,
  computeDirectionalEdgeForSide,
  computeRawEdge,
  confidenceFromEdge,
  hitChanceFromVerifiedEdge,
  AWAITING_PROJECTION_STATUS,
  hasValidProjection,
  INSUFFICIENT_DATA_LABEL,
  isVerifiedRecommendableProp,
  meetsPlayQualityThresholds,
  NO_VERIFIED_PLAY_STATUS,
  PASS_STATUS,
  resolveRecommendedSide,
  shouldPassPlay,
  sideConsistencyCheck,
  validateSideAgainstProjection,
} from "../modules/propSideEngine.js";

export {
  hasValidProjection,
  isVerifiedRecommendableProp,
  NO_VERIFIED_PLAY_STATUS,
  AWAITING_PROJECTION_STATUS,
  PASS_STATUS,
} from "../modules/propSideEngine.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function projectionIsVerified({ projectedValue, isFallbackProjection, dataStatus, projectionSource }) {
  if (!Number.isFinite(projectedValue) || projectedValue <= 0) return false;
  if (isFallbackProjection) return false;
  if (isFallbackDataStatus(dataStatus)) return false;
  if (projectionSource === "manual-fallback" || projectionSource === "missing") return false;
  if (isVerifiedProjectionStatus(dataStatus)) return true;
  if (projectionSource === "player-stats-model") return true;
  return false;
}

export function isManualPropPlayable(prop = {}) {
  if (!isVerifiedRecommendableProp(prop)) return false;
  if (prop.projectionUnavailable || prop.noEdge) return false;
  if (prop.isFallbackProjection) return false;
  return meetsPlayQualityThresholds({
    projection: prop.projectedValue ?? prop.projection,
    line: prop.line,
    side: prop.bestPick || prop.side || prop.pick,
    edge: prop.edge,
    confidence: prop.confidenceScore ?? prop.confidence,
    isVerified: Boolean(prop.isVerifiedProjection),
    projectionUnavailable: prop.projectionUnavailable,
  });
}

/** Sport-specific stat volatility: tier (LOW|MEDIUM|HIGH) and 0–1 score. */
const MANUAL_VOLATILITY = {
  MLB: {
    hrr: { tier: "HIGH", score: 0.82, label: "High variance" },
    hits: { tier: "LOW", score: 0.28, label: "Low variance" },
    strikeouts: { tier: "LOW", score: 0.38, label: "Low variance" },
    batterWalks: { tier: "HIGH", score: 0.78, label: "High variance" },
    walks: { tier: "HIGH", score: 0.74, label: "High variance" },
    singles: { tier: "LOW", score: 0.32, label: "Low variance" },
    doubles: { tier: "MEDIUM", score: 0.48, label: "Medium variance" },
    triples: { tier: "HIGH", score: 0.72, label: "High variance" },
    homeRuns: { tier: "HIGH", score: 0.85, label: "High variance" },
    stolenBases: { tier: "HIGH", score: 0.8, label: "High variance" },
    totalBases: { tier: "MEDIUM", score: 0.55, label: "Medium variance" },
    rbis: { tier: "MEDIUM", score: 0.5, label: "Medium variance" },
    runs: { tier: "MEDIUM", score: 0.46, label: "Medium variance" },
    hitsAllowed: { tier: "MEDIUM", score: 0.65, label: "Medium/high variance" },
    earnedRuns: { tier: "HIGH", score: 0.72, label: "High variance" },
    outs: { tier: "MEDIUM", score: 0.52, label: "Medium variance" },
    fantasyScore: { tier: "MEDIUM", score: 0.56, label: "Medium variance" },
    pitchesThrown: { tier: "MEDIUM", score: 0.5, label: "Medium variance" },
  },
  NBA: {
    pra: { tier: "MEDIUM", score: 0.54, label: "Medium variance" },
    assists: { tier: "HIGH", score: 0.76, label: "High variance" },
    rebounds: { tier: "LOW", score: 0.3, label: "Low variance" },
    points: { tier: "MEDIUM", score: 0.48, label: "Medium variance" },
    pr: { tier: "MEDIUM", score: 0.52, label: "Medium variance" },
    pa: { tier: "MEDIUM", score: 0.55, label: "Medium variance" },
    ra: { tier: "MEDIUM", score: 0.5, label: "Medium variance" },
    threes: { tier: "HIGH", score: 0.8, label: "High variance" },
    steals: { tier: "HIGH", score: 0.74, label: "High variance" },
    blocks: { tier: "HIGH", score: 0.72, label: "High variance" },
    turnovers: { tier: "MEDIUM", score: 0.58, label: "Medium variance" },
    fantasyScore: { tier: "MEDIUM", score: 0.56, label: "Medium variance" },
    doubleDouble: { tier: "HIGH", score: 0.7, label: "High variance" },
  },
  WNBA: {
    pra: { tier: "MEDIUM", score: 0.54, label: "Medium variance" },
    assists: { tier: "HIGH", score: 0.76, label: "High variance" },
    rebounds: { tier: "LOW", score: 0.3, label: "Low variance" },
    points: { tier: "MEDIUM", score: 0.48, label: "Medium variance" },
  },
};

const STAT_BASELINES = {
  MLB: {
    strikeouts: { mean: 5.2, std: 1.6 },
    hits: { mean: 1.05, std: 0.55 },
    hrr: { mean: 2.1, std: 1.0 },
    totalBases: { mean: 1.65, std: 0.9 },
    singles: { mean: 0.75, std: 0.4 },
    doubles: { mean: 0.28, std: 0.22 },
    homeRuns: { mean: 0.32, std: 0.34 },
    stolenBases: { mean: 0.14, std: 0.2 },
    batterWalks: { mean: 0.42, std: 0.34 },
    walks: { mean: 1.75, std: 0.75 },
    rbis: { mean: 0.82, std: 0.52 },
    runs: { mean: 0.62, std: 0.42 },
    hitsAllowed: { mean: 5.0, std: 1.4 },
    earnedRuns: { mean: 2.4, std: 1.1 },
    outs: { mean: 16.5, std: 2.0 },
    fantasyScore: { mean: 6.2, std: 2.8 },
    pitchesThrown: { mean: 92, std: 18 },
  },
  NBA: {
    points: { mean: 18.5, std: 6.2 },
    rebounds: { mean: 6.4, std: 2.2 },
    assists: { mean: 4.6, std: 2.3 },
    pra: { mean: 32.5, std: 8.5 },
    pr: { mean: 24.0, std: 6.5 },
    pa: { mean: 22.5, std: 5.8 },
    ra: { mean: 11.0, std: 3.2 },
    threes: { mean: 2.1, std: 1.4 },
    steals: { mean: 1.0, std: 0.65 },
    blocks: { mean: 0.65, std: 0.55 },
    fantasyScore: { mean: 36, std: 10 },
  },
  WNBA: {
    points: { mean: 14.5, std: 5.0 },
    rebounds: { mean: 5.8, std: 2.0 },
    assists: { mean: 3.8, std: 1.8 },
    pra: { mean: 26, std: 7.0 },
  },
};

const DEFAULT_BASELINE = { mean: 2.0, std: 1.0 };
const DEFAULT_VOLATILITY = { tier: "MEDIUM", score: 0.5, label: "Medium variance" };

function normalizeSportKey(sport = "") {
  const key = String(sport || "MLB").trim().toUpperCase();
  if (key === "WNBA") return "WNBA";
  if (key === "NBA" || key.includes("BASKET")) return "NBA";
  return "MLB";
}

function normalizePayout(payoutType = "standard") {
  const key = normalize(payoutType);
  if (key === "goblin") return "goblin";
  if (key === "demon") return "demon";
  return "standard";
}

export function normalizeManualPick(side = "") {
  const key = normalize(side);
  if (key === "over" || key === "more" || key === "higher") return "over";
  if (key === "under" || key === "less" || key === "lower") return "under";
  return "";
}

export function getManualStatVolatility(sport = "MLB", statType = "") {
  const sportKey = normalizeSportKey(sport);
  const marketKey = canonicalMarketKey(statType) || normalize(statType);
  const table = MANUAL_VOLATILITY[sportKey] || MANUAL_VOLATILITY.MLB;
  return table[marketKey] || DEFAULT_VOLATILITY;
}

export function getManualStatBaseline(sport = "MLB", statType = "") {
  const sportKey = normalizeSportKey(sport);
  const marketKey = canonicalMarketKey(statType) || normalize(statType);
  const table = STAT_BASELINES[sportKey] || STAT_BASELINES.MLB;
  return table[marketKey] || DEFAULT_BASELINE;
}

export function volatilityLabelFromTier(tier = "MEDIUM") {
  const key = String(tier || "MEDIUM").toUpperCase();
  if (key === "LOW") return "Low variance";
  if (key === "HIGH") return "High variance";
  return "Medium variance";
}

/** OVER: projection - line. UNDER: line - projection. */
export function computeDirectionalEdge(projection, line, pick) {
  const proj = Number(projection);
  const numericLine = Number(line);
  const side = normalizeManualPick(pick);
  if (!Number.isFinite(proj) || !Number.isFinite(numericLine)) return 0;
  return side === "over" ? round(proj - numericLine, 2) : round(numericLine - proj, 2);
}

export function computeManualEdgePercent(edge, line, projection) {
  const numericEdge = Number(edge);
  const numericLine = Number(line);
  const numericProjection = Number(projection);
  if (!Number.isFinite(numericEdge)) return null;
  if (Number.isFinite(numericProjection) && numericProjection > 0) {
    return Math.round((numericEdge / numericProjection) * 100);
  }
  if (Number.isFinite(numericLine) && numericLine > 0) {
    return Math.round((numericEdge / numericLine) * 100);
  }
  return null;
}

export function computeImpliedHitChance({
  projection,
  line,
  confidence = 0,
  edge = 0,
  volatility = DEFAULT_VOLATILITY,
  payoutType = "standard",
  isVerified = true,
}) {
  if (!isVerified) return null;
  const rawEdge = computeRawEdge(projection, line);
  if (rawEdge == null) return null;
  return hitChanceFromVerifiedEdge({
    absEdge: Math.abs(rawEdge),
    rawEdge,
    volatility,
    confidence,
    payoutType,
  });
}

export function manualScoringModeLabel(liveScored = null, isFallback = false) {
  if (isFallback) return "Estimated grade";
  if (liveScored?.isVerifiedProjection || liveScored?.projectionLabel === VERIFIED_PROJECTION_LABEL) {
    return "Verified MLB projection";
  }
  const source = String(liveScored?.projectionSource || "").toLowerCase();
  if (source && source !== "missing" && source !== "manual-dynamic" && source !== "manual-fallback" && source !== "manual-offline") {
    return "Live projection";
  }
  return "Estimated grade";
}

export function leanBadgeStyle(lean = "") {
  const key = String(lean || "").toLowerCase();
  if (key === "over") {
    return { border: "1px solid #0d9488", background: "#042f2e", color: "#5eead4" };
  }
  if (key === "under") {
    return { border: "1px solid #ea580c", background: "#431407", color: "#fdba74" };
  }
  return { border: "1px solid #475569", background: "#1e293b", color: "#cbd5e1" };
}

export function manualRiskBadgeStyle(riskLevel = "") {
  const key = String(riskLevel || "").toUpperCase();
  if (key === "LOW") return { border: "1px solid #166534", background: "#052e16", color: "#86efac" };
  if (key === "MEDIUM" || key.includes("MED")) {
    return { border: "1px solid #ca8a04", background: "#facc15", color: "#422006" };
  }
  if (key === "HIGH") return { border: "1px solid #991b1b", background: "#450a0a", color: "#fca5a5" };
  return { border: "1px solid #475569", background: "#1e293b", color: "#cbd5e1" };
}

export function riskShortLabel(riskLevel = "") {
  const key = String(riskLevel || "").toUpperCase();
  if (key.includes("LOW")) return "LOW";
  if (key.includes("HIGH")) return "HIGH";
  if (key.includes("MED") || key.includes("MOD")) return "MED";
  return "MED";
}

export function payoutDisplayLabel(prop = {}) {
  const key = normalizePayout(prop.payoutType || prop.oddsType || prop.payoutRole || "standard");
  if (key === "goblin") return "Goblin";
  if (key === "demon") return "Demon";
  return "Standard";
}

export function payoutBadgeStyle(prop = {}) {
  const key = normalizePayout(prop.payoutType || prop.oddsType || prop.payoutRole || "standard");
  if (key === "goblin") return { border: "1px solid #0d9488", background: "#042f2e", color: "#5eead4" };
  if (key === "demon") return { border: "1px solid #a855f7", background: "#3b0764", color: "#e9d5ff" };
  return { border: "1px solid #475569", background: "#1e293b", color: "#e2e8f0" };
}

export function strongPlayBadgeStyle() {
  return { border: "1px solid #16a34a", background: "#14532d", color: "#bbf7d0" };
}

export function resolveManualPlayTag({ edge, confidence, volatility } = {}) {
  const numericEdge = Number(edge);
  const numericConf = Number(confidence);
  const tier = String(volatility?.tier || "MEDIUM").toUpperCase();
  if (numericEdge > 1.0 && numericConf > 70 && tier !== "HIGH") return "Strong Play";
  return null;
}

export function manualWeakPickStyle(edge) {
  if (Number(edge) >= 0) return {};
  return {
    opacity: 0.76,
    borderColor: "#334155",
    boxShadow: "none",
  };
}

export function manualMetricFadeStyle(edge) {
  if (Number(edge) >= 0) return {};
  return { opacity: 0.62, color: "#94a3b8" };
}

export function projectionVsLineLabel(prop = {}) {
  const line = Number(prop.line);
  if (!Number.isFinite(line)) return null;
  if (!hasValidProjection(prop)) {
    return `-- vs ${formatNumber(line)}`;
  }
  const projection = Number(prop.projectedValue ?? prop.projection);
  if (!Number.isFinite(projection)) {
    return `-- vs ${formatNumber(line)}`;
  }
  return `${formatNumber(projection)} vs ${formatNumber(line)}`;
}

function linePercentile(line, baseline = {}) {
  const mean = Number(baseline.mean) || 1;
  const std = Math.max(Number(baseline.std) || 1, 0.05);
  const z = (Number(line) - mean) / std;
  return clamp(0.5 + z * 0.18, 0.05, 0.95);
}

export function estimateFairLine(sport, statType, line, payoutType = "standard") {
  const baseline = getManualStatBaseline(sport, statType);
  const payout = normalizePayout(payoutType);
  const numericLine = Number(line);
  if (!Number.isFinite(numericLine)) return baseline.mean;

  let fair = baseline.mean * 0.55 + numericLine * 0.45;
  if (payout === "goblin") fair *= 0.96;
  if (payout === "demon") fair *= 1.06;
  return round(fair, 2);
}

function applyMlbMarketConfidenceAdjustments({
  score,
  sport,
  statType,
  edge,
  payoutType,
}) {
  const sportKey = normalizeSportKey(sport);
  const marketKey = canonicalMarketKey(statType);
  let adjusted = score;

  if (sportKey === "MLB" && marketKey === "strikeouts" && edge > 0.7) {
    adjusted += 5;
  }

  if (sportKey === "MLB" && marketKey === "hrr") {
    const payout = normalizePayout(payoutType);
    const cap = payout === "goblin" ? 82 : payout === "demon" ? 58 : 68;
    if (edge < 1.4) adjusted = Math.min(adjusted, cap);
  }

  return adjusted;
}

export function calculateManualConfidence({
  payoutType,
  volatility,
  edge,
  line,
  pick,
  source,
  sport,
  statType,
  fingerprint,
  linePct,
}) {
  const payout = normalizePayout(payoutType);
  const side = normalizeManualPick(pick);
  const favorableEdge = Math.max(Number(edge) || 0, 0);
  let min;
  let max;
  if (payout === "goblin") {
    min = 72;
    max = 85;
  } else if (payout === "demon") {
    min = 45;
    max = 60;
  } else {
    min = 58;
    max = 72;
  }

  const spread = ((fingerprint % 97) + 3) / 100;
  let score = min + spread * (max - min);

  if (favorableEdge >= 1.8) score += 5;
  else if (favorableEdge >= 1.2) score += 3;
  else if (favorableEdge >= 0.7) score += 1;
  else if (favorableEdge <= 0.25) score -= 4;
  if (Number(edge) < 0) score -= 6;

  if (volatility.tier === "LOW") score += 4;
  else if (volatility.tier === "HIGH") score -= 5;

  if (linePct > 0.82 && side === "under") score += 3;
  if (linePct > 0.82 && side === "over") score -= 4;
  if (linePct < 0.18 && side === "over") score += 3;
  if (linePct < 0.18 && side === "under") score -= 4;

  if (source === "Underdog") score += 1;

  score = applyMlbMarketConfidenceAdjustments({ score, sport, statType, edge: favorableEdge, payoutType });

  if (Number(edge) < 0) {
    const negativeCap = payout === "goblin" ? 58 : payout === "demon" ? 52 : 55;
    const negativeFloor = 40;
    score = clamp(Math.min(score, negativeCap), negativeFloor, negativeCap);
  } else {
    const floor = payout === "goblin" ? 72 : payout === "demon" ? 45 : 58;
    const ceiling = payout === "goblin" ? 85 : payout === "demon" ? 60 : 72;
    score = clamp(score, floor, ceiling);
  }

  return Math.round(score);
}

export function classifyManualRisk({ payoutType, volatility, edge, linePct }) {
  let riskScore = 0;
  const payout = normalizePayout(payoutType);
  const favorableEdge = Math.max(Number(edge) || 0, 0);

  if (payout === "goblin") riskScore -= 2;
  if (payout === "demon") riskScore += 3;
  if (volatility.tier === "HIGH") riskScore += 2;
  if (volatility.tier === "LOW") riskScore -= 1;
  if (favorableEdge >= 1.2) riskScore -= 1;
  if (favorableEdge <= 0.35 || Number(edge) < 0) riskScore += 1;
  if (linePct >= 0.8 || linePct <= 0.2) riskScore += 1;

  if (riskScore <= -1) return "Low";
  if (riskScore >= 2) return "High";
  return "Medium";
}

export function generateManualExplanation(ctx = {}) {
  const {
    pick,
    statLabel,
    line,
    riskLevel,
    payoutType,
    volatility,
    edge,
    linePct,
    sport,
    projection,
    projectionUnavailable,
    noEdge,
  } = ctx;
  if (projectionUnavailable) {
    return "Awaiting verified projection data — analysis unavailable without game logs.";
  }
  if (noEdge || !pick) {
    return "No edge — projection sits on the line. Avoid this prop.";
  }
  const direction = normalizeManualPick(pick) === "over" ? "Over" : "Under";
  const stat = statLabel || "prop";
  const payout = normalizePayout(payoutType);
  const parts = [];

  if (Number.isFinite(projection) && Number.isFinite(line)) {
    parts.push(`Model projects ${formatNumber(projection)} vs line ${formatNumber(line)}.`);
  }
  if (volatility.tier === "HIGH" && linePct > 0.72 && normalizeManualPick(pick) === "under") {
    parts.push(`Line looks high for a volatile ${stat} spot.`);
  }
  if (payout === "goblin") {
    parts.push("Goblin line adds extra cushion versus typical output.");
  }
  if (payout === "demon") {
    parts.push(`Demon line on ${stat} pays more but clears less often.`);
  }
  if (normalizeManualPick(pick) === "under" && linePct > 0.78) {
    parts.push("Under benefits from an elevated line on a swingy stat.");
  }
  if (normalizeManualPick(pick) === "over" && linePct < 0.28) {
    parts.push(`Line is soft versus usual ${sport} ${stat} production.`);
  }
  if (volatility.tier === "LOW" && Number(edge) >= 1.0) {
    parts.push(`Stable ${stat} profile backs ${direction} with ${Number(edge).toFixed(1)} units of edge.`);
  }
  if (volatility.tier === "MEDIUM" && Number(edge) >= 0.8 && Number(edge) < 1.4) {
    parts.push(`${direction} fits a workable edge against the ${line} line.`);
  }
  if (riskLevel === "High") {
    parts.push("Higher variance and line difficulty keep this one capped.");
  }
  if (riskLevel === "Low" && payout !== "goblin") {
    parts.push(`${direction} grades as a cleaner, lower-variance look.`);
  }
  if (Number(edge) >= 1.6) {
    parts.push(`Strong ${Number(edge).toFixed(1)}-unit edge on ${direction.toLowerCase()}.`);
  }
  if (Number(edge) > 0 && Number(edge) <= 0.3) {
    parts.push("Edge is thin — size lightly until form confirms.");
  }

  if (!parts.length) {
    parts.push(`${direction} on ${stat} ${line} — graded from line value and stat volatility.`);
  }

  return parts.slice(0, 2).join(" ");
}

export function scoreManualPropInput(input = {}, liveScored = null, profile = null) {
  const sport = input.sport || "MLB";
  const statType = input.statType || "";
  const line = Number(input.line);
  const userPick = normalizeManualPick(input.side || input.pick);
  const payoutType = normalizePayout(input.payoutType || input.oddsType || input.payoutRole);
  const source = input.source === "Underdog" ? "Underdog" : "PrizePicks";

  const volatility = getManualStatVolatility(sport, statType);
  const baseline = getManualStatBaseline(sport, statType);
  const linePct = linePercentile(line, baseline);
  const statLabel = marketDisplayLabel(statType) || statType;
  const volatilityLabel = volatility.label || volatilityLabelFromTier(volatility.tier);

  let projectionBreakdown = liveScored?.projectionBreakdown || [];
  let projectionLabel = liveScored?.projectionLabel || null;
  let projectionSource = liveScored?.projectionSource || null;
  let isFallbackProjection = liveScored?.isFallbackProjection;
  let dataStatus = liveScored?.dataStatus || null;
  let projectionConfidence = liveScored?.projectionConfidence ?? null;

  let fairLine = Number(liveScored?.projectedValue ?? liveScored?.projection);
  const mergedProfile = profile && !profile.sparse ? profile : null;
  const sportKey = normalizeSportKey(sport);
  const marketKey = canonicalMarketKey(statType);
  const isPitcherProp = sportKey === "MLB" && isMlbPitcherMarket(statType);
  const isStrikeoutProp = sportKey === "MLB" && isStrikeoutMarket(statType);
  const isHitterPhase2 = sportKey === "MLB" && isMlbHitterPhase2Market(statType);
  const projectionContext = {
    opponentContext: mergedProfile?.opponentContext,
    impliedGameTotal: mergedProfile?.impliedGameTotal,
    weatherNote: mergedProfile?.weatherNote,
    lineMovementNote: mergedProfile?.lineMovementNote,
  };

  if (isStrikeoutProp && mergedProfile) {
    const strikeoutData = projectPitcherStrikeouts(
      {
        sport,
        statType,
        line,
        playerName: input.playerName,
        opponent: input.opponent,
        team: input.team,
        source,
      },
      mergedProfile,
      projectionContext
    );
    if (strikeoutData) {
      fairLine = strikeoutData.projectedValue;
      projectionBreakdown = strikeoutData.projectionBreakdown || [];
      projectionLabel = strikeoutData.projectionLabel;
      projectionSource = strikeoutData.projectionSource;
      isFallbackProjection = strikeoutData.isFallbackProjection;
      dataStatus = strikeoutData.dataStatus;
      projectionConfidence = strikeoutData.projectionConfidence;
    }
  } else if (isPitcherProp && mergedProfile && hasMlbPitcherStatInputs(mergedProfile)) {
    const pitcher = projectMlbPitcherProp(
      {
        sport,
        statType,
        line,
        playerName: input.playerName,
        opponent: input.opponent,
        team: input.team,
        source,
      },
      mergedProfile,
      projectionContext
    );
    if (pitcher) {
      fairLine = pitcher.projectedValue;
      projectionBreakdown = pitcher.projectionBreakdown || [];
      projectionLabel = pitcher.projectionLabel;
      projectionSource = pitcher.projectionSource;
      isFallbackProjection = pitcher.isFallbackProjection;
      dataStatus = pitcher.dataStatus;
      projectionConfidence = pitcher.projectionConfidence;
    }
  } else if (isHitterPhase2 && mergedProfile && hasMlbHitterStatInputs(mergedProfile)) {
    const hitter = projectMlbHitterProp(
      {
        sport,
        statType,
        line,
        playerName: input.playerName,
        opponent: input.opponent,
        team: input.team,
        source,
      },
      mergedProfile,
      projectionContext
    );
    if (hitter) {
      fairLine = hitter.projectedValue;
      projectionBreakdown = hitter.projectionBreakdown || [];
      projectionLabel = hitter.projectionLabel;
      projectionSource = hitter.projectionSource;
      isFallbackProjection = hitter.isFallbackProjection;
      dataStatus = hitter.dataStatus;
      projectionConfidence = hitter.projectionConfidence;
    }
  } else if (mergedProfile && hasRealStatInputs(mergedProfile) && sportKey !== "MLB") {
    const real = buildRealProjection(
      {
        sport,
        statType,
        line,
        playerName: input.playerName,
        opponent: input.opponent,
        team: input.team,
      },
      mergedProfile,
      { opponentContext: mergedProfile.opponentContext }
    );
    fairLine = real.projectedValue;
    projectionBreakdown = real.projectionBreakdown || [];
    projectionLabel = real.projectionLabel;
    projectionSource = real.projectionSource;
    isFallbackProjection = real.isFallbackProjection;
  }

  const verified = projectionIsVerified({
    projectedValue: fairLine,
    isFallbackProjection,
    dataStatus,
    projectionSource,
  });

  if (!verified) {
    const whyThisPick = generateManualExplanation({
      statLabel,
      line,
      payoutType,
      volatility,
      sport: sportKey,
      projectionUnavailable: true,
    });
    return {
      projectionUnavailable: true,
      bestPick: null,
      side: null,
      pick: null,
      lean: null,
      confidence: null,
      confidenceScore: null,
      calibratedConfidence: null,
      edge: null,
      edgePercent: null,
      impliedHitChance: null,
      hitChanceLabel: INSUFFICIENT_DATA_LABEL,
      riskLevel: null,
      playTag: null,
      isWeakManualPick: true,
      isDisplayPlayable: false,
      noEdge: true,
      displayStatus: NO_VERIFIED_PLAY_STATUS,
      statusMessage: AWAITING_PROJECTION_STATUS,
      userPick,
      whyThisPick,
      qualificationReason: whyThisPick,
      premiumWhySummary: whyThisPick,
      projectedValue: null,
      projection: null,
      projectionBreakdown,
      projectionLabel: "Projection unavailable",
      projectionSource: projectionSource || "missing",
      isFallbackProjection: true,
      isVerifiedProjection: false,
      dataStatus: dataStatus || DATA_STATUS.FALLBACK,
      projectionConfidence: null,
      manualVolatilityTier: null,
      manualVolatilityScore: null,
      volatilityLabel: null,
      volatility: null,
      manualDynamicAnalysis: true,
      scoringModeLabel: "Projection unavailable",
      dataQualityScore: null,
      bettingLabel: NO_VERIFIED_PLAY_STATUS,
      sideEngineDebug: buildSideEngineDebug({
        projectionSource: projectionSource || "missing",
        dataStatus: dataStatus || DATA_STATUS.FALLBACK,
        sportsbookLine: line,
      }),
    };
  }

  const recommendedSide = resolveRecommendedSide(fairLine, line);
  const rawEdge = computeRawEdge(fairLine, line);
  const absEdge = rawEdge != null ? Math.abs(rawEdge) : 0;
  const sideValidation = validateSideAgainstProjection(recommendedSide, fairLine, line);

  if (!recommendedSide) {
    const whyThisPick = generateManualExplanation({
      statLabel,
      line,
      payoutType,
      volatility,
      sport: sportKey,
      projection: fairLine,
      noEdge: true,
    });
    return {
      projectionUnavailable: false,
      noEdge: true,
      bestPick: null,
      side: null,
      pick: null,
      lean: null,
      confidence: null,
      confidenceScore: null,
      calibratedConfidence: null,
      edge: null,
      edgePercent: null,
      impliedHitChance: null,
      hitChanceLabel: INSUFFICIENT_DATA_LABEL,
      riskLevel: null,
      playTag: null,
      isWeakManualPick: true,
      isDisplayPlayable: false,
      displayStatus: NO_VERIFIED_PLAY_STATUS,
      statusMessage: "No edge — projection equals line",
      userPick,
      whyThisPick,
      qualificationReason: whyThisPick,
      premiumWhySummary: whyThisPick,
      projectedValue: fairLine,
      projection: fairLine,
      projectionBreakdown,
      projectionLabel,
      projectionSource: projectionSource || "player-stats-model",
      isFallbackProjection: false,
      isVerifiedProjection: true,
      dataStatus,
      projectionConfidence,
      manualVolatilityTier: volatility.tier,
      manualVolatilityScore: volatility.score,
      volatilityLabel,
      volatility: round(1.5 + volatility.score * 2.5, 2),
      manualDynamicAnalysis: true,
      scoringModeLabel: manualScoringModeLabel(liveScored, false),
      dataQualityScore: Math.round(48 + (1 - volatility.score) * 22),
      bettingLabel: "No edge",
      sideEngineDebug: buildSideEngineDebug({
        projection: fairLine,
        line,
        side: userPick,
        projectionSource,
        dataStatus,
        rawEdge,
        recommendedSide: null,
        aligned: false,
        volatility,
        recentAverage: mergedProfile?.last5Average ?? mergedProfile?.seasonAverage ?? null,
        sportsbookLine: line,
      }),
    };
  }

  const edge = computeDirectionalEdgeForSide(fairLine, line, recommendedSide);
  let confidence;
  let impliedHitChance;

  if (isStrikeoutProp || isPitcherProp) {
    const pitcherScore = scorePitcherManualProp({
      projection: fairLine,
      line,
      pick: recommendedSide,
      statType,
      payoutType,
      volatility,
      projectionConfidence: projectionConfidence ?? 60,
      dataStatus: dataStatus || DATA_STATUS.VERIFIED,
    });
    confidence = pitcherScore.confidence;
    impliedHitChance = pitcherScore.impliedHitChance;
  } else {
    const consistencyScore = mergedProfile?.consistencyScore ?? null;
    const matchupQuality =
      mergedProfile?.handednessMatchup && /favorable|platoon/i.test(String(mergedProfile.handednessMatchup))
        ? "strong"
        : mergedProfile?.handednessMatchup && /tough|mismatch/i.test(String(mergedProfile.handednessMatchup))
          ? "weak"
          : null;
    confidence = confidenceFromEdge(absEdge, {
      volatility,
      payoutType,
      marketKey,
      isVerified: true,
      consistencyScore,
      matchupQuality,
      lineMovementFavorable: mergedProfile?.lineMovementFavorable ?? null,
    });
    impliedHitChance = computeImpliedHitChance({
      projection: fairLine,
      line,
      confidence,
      edge,
      volatility,
      payoutType,
      isVerified: true,
    });
  }

  const passPlay = shouldPassPlay({ edge, confidence, isVerified: true });
  const riskLevel = classifyManualRisk({ payoutType, volatility, edge, linePct });
  const edgePercent = computeManualEdgePercent(edge, line, fairLine);
  const whyThisPick = passPlay
    ? "Edge or confidence below threshold — PASS on this prop."
    : generateManualExplanation({
        pick: recommendedSide,
        statLabel,
        line,
        riskLevel,
        payoutType,
        volatility,
        edge,
        linePct,
        sport: sportKey,
        projection: fairLine,
      });
  const playTag = passPlay ? null : resolveManualPlayTag({ edge, confidence, volatility });
  const isDisplayPlayable =
    !passPlay &&
    meetsPlayQualityThresholds({
      projection: fairLine,
      line,
      side: recommendedSide,
      edge,
      confidence,
      isVerified: true,
      projectionUnavailable: false,
    });
  const recentAverage = mergedProfile?.last5Average ?? mergedProfile?.seasonAverage ?? null;
  const matchupNote = mergedProfile?.opponentContext?.note || mergedProfile?.matchupNote || null;
  const sideEngineDebug = buildSideEngineDebug({
    projection: fairLine,
    line,
    side: recommendedSide,
    projectionSource,
    dataStatus,
    rawEdge,
    recommendedSide,
    aligned: sideValidation.aligned,
    volatility,
    recentAverage,
    matchupNote,
    sportsbookLine: line,
  });

  return {
    bestPick: passPlay ? null : recommendedSide,
    side: passPlay ? null : recommendedSide,
    pick: passPlay ? null : recommendedSide,
    lean: passPlay ? null : recommendedSide === "over" ? "Over" : "Under",
    recommendedSide,
    userPick,
    sideAligned: sideConsistencyCheck({ bestPick: recommendedSide, projectedValue: fairLine, line }),
    confidence: passPlay ? null : confidence,
    confidenceScore: passPlay ? null : confidence,
    calibratedConfidence: passPlay ? null : confidence,
    edge: passPlay ? null : edge,
    edgePercent: passPlay ? null : edgePercent,
    impliedHitChance: passPlay ? null : impliedHitChance,
    hitChanceLabel: passPlay ? null : impliedHitChance == null ? INSUFFICIENT_DATA_LABEL : null,
    riskLevel: passPlay ? null : riskLevel,
    playTag,
    isWeakManualPick: passPlay || !isDisplayPlayable,
    isDisplayPlayable,
    passPlay,
    displayStatus: passPlay ? PASS_STATUS : null,
    statusMessage: passPlay ? "Edge too weak — engine recommends PASS." : null,
    whyThisPick,
    qualificationReason: whyThisPick,
    premiumWhySummary: whyThisPick,
    projectedValue: fairLine,
    projection: fairLine,
    projectionBreakdown,
    projectionLabel,
    projectionSource: projectionSource || "player-stats-model",
    isFallbackProjection: false,
    isVerifiedProjection: true,
    dataStatus,
    projectionConfidence,
    manualVolatilityTier: passPlay ? null : volatility.tier,
    manualVolatilityScore: passPlay ? null : volatility.score,
    volatilityLabel: passPlay ? null : volatilityLabel,
    volatility: passPlay ? null : round(1.5 + volatility.score * 2.5, 2),
    manualDynamicAnalysis: true,
    scoringModeLabel: manualScoringModeLabel(liveScored, false),
    dataQualityScore: Math.round(48 + (1 - volatility.score) * 22 + Math.max(edge, 0) * 6),
    bettingLabel: passPlay ? PASS_STATUS : playTag || (isDisplayPlayable ? "Playable" : PASS_STATUS),
    sideEngineDebug: { ...sideEngineDebug, passPlay, recommendedSide },
  };
}

export function mergeManualPropScoring(builtProp = {}, manualScore = {}, liveScored = null) {
  const recommended = manualScore.bestPick || null;
  const scoringModeLabel = manualScore.scoringModeLabel || manualScoringModeLabel(liveScored, manualScore.isFallbackProjection);
  const playable = Boolean(manualScore.isDisplayPlayable) && isManualPropPlayable({ ...builtProp, ...manualScore });
  return {
    ...builtProp,
    ...(liveScored || {}),
    ...manualScore,
    bestPick: recommended,
    side: recommended,
    pick: recommended,
    line: Number(builtProp.line ?? manualScore.line),
    team: builtProp.team || liveScored?.team || "",
    opponent: builtProp.opponent || liveScored?.opponent || "",
    isDisplayPlayable: playable,
    bettingLabel: manualScore.bettingLabel || manualScore.playTag || (manualScore.projectionUnavailable ? "Awaiting data" : "Graded"),
    displayTier: manualScore.playTag === "Strong Play" ? "playable" : playable ? "playable" : "research",
    lineSourceBadge: "MANUAL",
    scoringModeLabel,
    projectionBreakdown: manualScore.projectionBreakdown || liveScored?.projectionBreakdown || [],
    projectionLabel: manualScore.projectionLabel || liveScored?.projectionLabel || "Projection unavailable",
    isFallbackProjection: manualScore.isFallbackProjection ?? liveScored?.isFallbackProjection,
    isVerifiedProjection: manualScore.isVerifiedProjection ?? liveScored?.isVerifiedProjection,
    dataStatus: manualScore.dataStatus || liveScored?.dataStatus || null,
    projectionConfidence: manualScore.projectionConfidence ?? liveScored?.projectionConfidence ?? null,
    hitChanceLabel: manualScore.hitChanceLabel || (manualScore.impliedHitChance == null ? INSUFFICIENT_DATA_LABEL : null),
    displayStatus: manualScore.displayStatus || (manualScore.projectionUnavailable ? NO_VERIFIED_PLAY_STATUS : null),
    statusMessage: manualScore.statusMessage || (manualScore.projectionUnavailable ? AWAITING_PROJECTION_STATUS : null),
    sideEngineDebug: manualScore.sideEngineDebug || null,
    analyzedAt: new Date().toISOString(),
  };
}

export function rankManualPropScore(prop = {}) {
  if (!isManualPropPlayable(prop)) return -1_000_000;
  const edgePct = Math.max(Number(prop.edgePercent ?? 0), 0);
  const edge = Math.max(Number(prop.edge ?? 0), 0);
  const conf = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const hitChance = Number(prop.impliedHitChance ?? prop.hitChance ?? 0);
  const vol = Number(prop.manualVolatilityScore ?? 0.5);
  return edgePct * 2.4 + edge * 11 + conf * 1.15 + hitChance * 0.85 - vol * 24;
}

function manualPropsCorrelated(a = {}, b = {}) {
  const playerA = String(a.playerName || a.player || "").trim();
  const playerB = String(b.playerName || b.player || "").trim();
  if (playerA && playerB && playerNamesMatch(playerA, playerB)) return true;
  return false;
}

export function sortManualPropsByRank(props = []) {
  return [...(props || [])].sort((a, b) => {
    const rankDiff = rankManualPropScore(b) - rankManualPropScore(a);
    if (Math.abs(rankDiff) > 0.01) return rankDiff;
    const volDiff = Number(a.manualVolatilityScore ?? 0.5) - Number(b.manualVolatilityScore ?? 0.5);
    if (volDiff !== 0) return volDiff;
    return Number(b.confidenceScore ?? b.confidence ?? 0) - Number(a.confidenceScore ?? a.confidence ?? 0);
  });
}

export function selectManualTopPicksByRank(props = [], limit = 2) {
  const ranked = sortManualPropsByRank(props).filter(isManualPropPlayable);
  const selected = [];
  for (const prop of ranked) {
    if (selected.length >= Math.max(0, limit)) break;
    if (selected.some((pick) => manualPropsCorrelated(pick, prop))) continue;
    selected.push(prop);
  }
  return selected;
}
