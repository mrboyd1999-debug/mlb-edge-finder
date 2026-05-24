import { canonicalMarketKey } from "./marketNormalization.js";
import { normalize } from "./formatters.js";
import { marketDisplayLabel } from "./marketNormalization.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function propFingerprint(input = {}) {
  const str = [
    input.playerName,
    input.statType,
    input.line,
    input.side || input.pick,
    input.payoutType,
    input.source,
    input.sport,
  ]
    .join("|")
    .toLowerCase();
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
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
    hitsAllowed: { tier: "MEDIUM", score: 0.58, label: "Medium variance" },
    earnedRuns: { tier: "MEDIUM", score: 0.6, label: "Medium variance" },
    outs: { tier: "LOW", score: 0.35, label: "Low variance" },
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
  return "over";
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
  confidence = 0,
  edge = 0,
  volatility = DEFAULT_VOLATILITY,
  payoutType = "standard",
}) {
  const payout = normalizePayout(payoutType);
  const favorableEdge = Math.max(Number(edge) || 0, 0);
  let pct = Number(confidence) * 0.82 + favorableEdge * 5;

  if (payout === "goblin") pct += 5;
  if (payout === "demon") pct -= 7;
  if (volatility.tier === "LOW") pct += 4;
  if (volatility.tier === "HIGH") pct -= 6;
  if (Number(edge) < 0) pct -= 10;

  return Math.round(clamp(pct, 38, 88));
}

export function manualScoringModeLabel(liveScored = null) {
  const source = String(liveScored?.projectionSource || "").toLowerCase();
  if (source && source !== "missing" && source !== "manual-dynamic" && source !== "manual-offline") {
    return "Base projection mode";
  }
  return "Offline scoring mode";
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
    return { border: "1px solid #854d0e", background: "#422006", color: "#fde68a" };
  }
  if (key === "HIGH") return { border: "1px solid #991b1b", background: "#450a0a", color: "#fca5a5" };
  return { border: "1px solid #475569", background: "#1e293b", color: "#cbd5e1" };
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

  const floor = payout === "goblin" ? 72 : payout === "demon" ? 45 : 58;
  const ceiling = payout === "goblin" ? 85 : payout === "demon" ? 60 : 72;
  return Math.round(clamp(score, floor, ceiling));
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
  } = ctx;
  const direction = normalizeManualPick(pick) === "over" ? "Over" : "Under";
  const stat = statLabel || "prop";
  const payout = normalizePayout(payoutType);
  const parts = [];

  if (Number(edge) < 0) {
    parts.push(
      `${direction} faces a negative edge (proj ${projection} vs line ${line}) — downgrade confidence.`
    );
  }
  if (volatility.tier === "HIGH" && linePct > 0.72 && normalizeManualPick(pick) === "under") {
    parts.push(`Line appears inflated for a volatile ${stat} category.`);
  }
  if (payout === "goblin") {
    parts.push("Goblin line provides safer margin versus average production.");
  }
  if (payout === "demon") {
    parts.push(`Demon threshold on ${stat} adds payout upside but shrinks hit rate.`);
  }
  if (normalizeManualPick(pick) === "under" && linePct > 0.78) {
    parts.push("Under selected due to elevated line and high variance stat.");
  }
  if (normalizeManualPick(pick) === "over" && linePct < 0.28) {
    parts.push(`Line sits below typical ${sport} ${stat} output — Over offers cushion.`);
  }
  if (volatility.tier === "LOW" && Number(edge) >= 1.0) {
    parts.push(`Stable ${stat} profile supports ${direction} with ${Number(edge).toFixed(1)} unit edge.`);
  }
  if (volatility.tier === "MEDIUM" && Number(edge) >= 0.8 && Number(edge) < 1.4) {
    parts.push(`${direction} aligns with moderate ${stat} edge versus posted line ${line}.`);
  }
  if (riskLevel === "High") {
    parts.push("High-risk spot: variance and line difficulty compress confidence.");
  }
  if (riskLevel === "Low" && payout !== "goblin") {
    parts.push(`${direction} grades as a lower-variance manual entry.`);
  }
  if (Number(edge) >= 1.6) {
    parts.push(`Strong ${Number(edge).toFixed(1)}-unit edge detected on ${direction.toLowerCase()} side.`);
  }
  if (Number(edge) > 0 && Number(edge) <= 0.3) {
    parts.push("Thin edge — treat as research-grade until live stats confirm.");
  }

  if (!parts.length) {
    parts.push(`${direction} on ${stat} ${line} — manual scoring from volatility and line context.`);
  }

  return parts.slice(0, 2).join(" ");
}

export function scoreManualPropInput(input = {}, liveScored = null) {
  const sport = input.sport || "MLB";
  const statType = input.statType || "";
  const line = Number(input.line);
  const pick = normalizeManualPick(input.side || input.pick);
  const payoutType = normalizePayout(input.payoutType || input.oddsType || input.payoutRole);
  const source = input.source === "Underdog" ? "Underdog" : "PrizePicks";
  const fingerprint = propFingerprint(input);

  const volatility = getManualStatVolatility(sport, statType);
  const baseline = getManualStatBaseline(sport, statType);
  const linePct = linePercentile(line, baseline);

  const liveProjection = Number(liveScored?.projectedValue ?? liveScored?.projection);
  const fairLine = Number.isFinite(liveProjection)
    ? liveProjection
    : estimateFairLine(sport, statType, line, payoutType);

  let edge = computeDirectionalEdge(fairLine, line, pick);
  if (normalizePayout(payoutType) === "goblin" && edge > 0) edge = round(edge + 0.12, 2);
  if (normalizePayout(payoutType) === "demon" && edge > 0) edge = round(Math.max(0, edge - 0.18), 2);
  if (edge > 0) edge = round(clamp(edge, 0.1, 2.5), 2);
  else if (edge < 0) edge = round(clamp(edge, -2.5, -0.05), 2);

  const confidence = calculateManualConfidence({
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
  });

  const riskLevel = classifyManualRisk({ payoutType, volatility, edge, linePct });
  const statLabel = marketDisplayLabel(statType) || statType;
  const edgePercent = computeManualEdgePercent(edge, line, fairLine);
  const impliedHitChance = computeImpliedHitChance({ confidence, edge, volatility, payoutType });
  const volatilityLabel = volatility.label || volatilityLabelFromTier(volatility.tier);
  const whyThisPick = generateManualExplanation({
    pick,
    statLabel,
    line,
    riskLevel,
    payoutType,
    volatility,
    edge,
    linePct,
    sport: normalizeSportKey(sport),
    projection: fairLine,
  });

  return {
    bestPick: pick,
    side: pick,
    pick,
    lean: pick === "over" ? "Over" : "Under",
    confidence,
    confidenceScore: confidence,
    calibratedConfidence: confidence,
    edge,
    edgePercent,
    impliedHitChance,
    riskLevel,
    whyThisPick,
    qualificationReason: whyThisPick,
    premiumWhySummary: whyThisPick,
    projectedValue: fairLine,
    projection: fairLine,
    manualVolatilityTier: volatility.tier,
    manualVolatilityScore: volatility.score,
    volatilityLabel,
    volatility: round(1.5 + volatility.score * 2.5, 2),
    manualDynamicAnalysis: true,
    projectionSource: liveScored?.projectionSource || "manual-dynamic",
    scoringModeLabel: manualScoringModeLabel(liveScored),
    dataQualityScore: Math.round(48 + (1 - volatility.score) * 22 + Math.max(edge, 0) * 6),
  };
}

export function mergeManualPropScoring(builtProp = {}, manualScore = {}, liveScored = null) {
  const lean = manualScore.bestPick || builtProp.bestPick || builtProp.side;
  const scoringModeLabel = manualScore.scoringModeLabel || manualScoringModeLabel(liveScored);
  return {
    ...builtProp,
    ...(liveScored || {}),
    ...manualScore,
    bestPick: lean,
    side: lean,
    pick: lean,
    line: Number(builtProp.line ?? manualScore.line),
    team: builtProp.team || liveScored?.team || "",
    opponent: builtProp.opponent || liveScored?.opponent || "",
    isDisplayPlayable: true,
    bettingLabel: "Manual Analyze",
    displayTier: "research",
    lineSourceBadge: "MANUAL",
    scoringModeLabel,
    dataQualityBadge: { label: scoringModeLabel, tone: "info" },
    analyzedAt: new Date().toISOString(),
  };
}

export function rankManualPropScore(prop = {}) {
  const edgePct = Math.max(Number(prop.edgePercent ?? 0), 0);
  const edge = Math.max(Number(prop.edge ?? 0), 0);
  const conf = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const vol = Number(prop.manualVolatilityScore ?? 0.5);
  return edgePct * 2.4 + edge * 11 + conf * 1.15 - vol * 24;
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
  return sortManualPropsByRank(props).slice(0, Math.max(0, limit));
}
