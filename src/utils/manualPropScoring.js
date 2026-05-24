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
    hrr: { tier: "HIGH", score: 0.82 },
    hits: { tier: "LOW", score: 0.28 },
    strikeouts: { tier: "MEDIUM", score: 0.52 },
    batterWalks: { tier: "HIGH", score: 0.78 },
    walks: { tier: "HIGH", score: 0.74 },
    singles: { tier: "LOW", score: 0.32 },
    doubles: { tier: "MEDIUM", score: 0.48 },
    triples: { tier: "HIGH", score: 0.72 },
    homeRuns: { tier: "HIGH", score: 0.85 },
    stolenBases: { tier: "HIGH", score: 0.8 },
    totalBases: { tier: "MEDIUM", score: 0.55 },
    rbis: { tier: "MEDIUM", score: 0.5 },
    runs: { tier: "MEDIUM", score: 0.46 },
    hitsAllowed: { tier: "MEDIUM", score: 0.58 },
    earnedRuns: { tier: "MEDIUM", score: 0.6 },
    outs: { tier: "LOW", score: 0.35 },
    fantasyScore: { tier: "MEDIUM", score: 0.56 },
    pitchesThrown: { tier: "MEDIUM", score: 0.5 },
  },
  NBA: {
    pra: { tier: "MEDIUM", score: 0.54 },
    assists: { tier: "HIGH", score: 0.76 },
    rebounds: { tier: "LOW", score: 0.3 },
    points: { tier: "MEDIUM", score: 0.48 },
    pr: { tier: "MEDIUM", score: 0.52 },
    pa: { tier: "MEDIUM", score: 0.55 },
    ra: { tier: "MEDIUM", score: 0.5 },
    threes: { tier: "HIGH", score: 0.8 },
    steals: { tier: "HIGH", score: 0.74 },
    blocks: { tier: "HIGH", score: 0.72 },
    turnovers: { tier: "MEDIUM", score: 0.58 },
    fantasyScore: { tier: "MEDIUM", score: 0.56 },
    doubleDouble: { tier: "HIGH", score: 0.7 },
  },
  WNBA: {
    pra: { tier: "MEDIUM", score: 0.54 },
    assists: { tier: "HIGH", score: 0.76 },
    rebounds: { tier: "LOW", score: 0.3 },
    points: { tier: "MEDIUM", score: 0.48 },
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
const DEFAULT_VOLATILITY = { tier: "MEDIUM", score: 0.5 };

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

function normalizePick(side = "") {
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

  // Blend posted line with baseline — manual entries reflect book pricing.
  let fair = baseline.mean * 0.55 + numericLine * 0.45;
  if (payout === "goblin") fair *= 0.96;
  if (payout === "demon") fair *= 1.06;
  return round(fair, 2);
}

export function calculateManualEdge({ line, fairLine, pick, volatility, payoutType, fingerprint }) {
  const numericLine = Number(line);
  const fair = Number(fairLine);
  const payout = normalizePayout(payoutType);
  const side = normalizePick(pick);

  if (!Number.isFinite(numericLine) || !Number.isFinite(fair)) return 0.2;

  let raw =
    side === "over"
      ? fair - numericLine
      : numericLine - fair;

  if (payout === "goblin") raw += 0.28;
  if (payout === "demon") raw -= 0.32;

  const volFactor = 1 - (volatility.score || 0.5) * 0.12;
  const mismatch = Math.abs(numericLine - fair) / Math.max(fair, 0.5);
  let edge = Math.abs(raw) * volFactor + mismatch * 0.35;

  const jitter = ((fingerprint % 17) + 3) / 100;
  edge = clamp(edge + jitter, 0.1, 2.5);
  return round(edge, 2);
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
  const side = normalizePick(pick);
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

  if (edge >= 1.8) score += 5;
  else if (edge >= 1.2) score += 3;
  else if (edge >= 0.7) score += 1;
  else if (edge <= 0.25) score -= 4;

  if (volatility.tier === "LOW") score += 4;
  else if (volatility.tier === "MEDIUM") score += 0;
  else if (volatility.tier === "HIGH") score -= 5;

  if (linePct > 0.82 && side === "under") score += 3;
  if (linePct > 0.82 && side === "over") score -= 4;
  if (linePct < 0.18 && side === "over") score += 3;
  if (linePct < 0.18 && side === "under") score -= 4;

  if (source === "Underdog") score += 1;
  if (source === "PrizePicks") score += 0;

  const floor = payout === "goblin" ? 72 : payout === "demon" ? 45 : 58;
  const ceiling = payout === "goblin" ? 85 : payout === "demon" ? 60 : 72;
  return Math.round(clamp(score, floor, ceiling));
}

export function classifyManualRisk({ payoutType, volatility, edge, linePct }) {
  let riskScore = 0;
  const payout = normalizePayout(payoutType);

  if (payout === "goblin") riskScore -= 2;
  if (payout === "demon") riskScore += 3;
  if (volatility.tier === "HIGH") riskScore += 2;
  if (volatility.tier === "LOW") riskScore -= 1;
  if (edge >= 1.2) riskScore -= 1;
  if (edge <= 0.35) riskScore += 1;
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
  } = ctx;
  const direction = normalizePick(pick) === "over" ? "Over" : "Under";
  const stat = statLabel || "prop";
  const payout = normalizePayout(payoutType);
  const parts = [];

  if (volatility.tier === "HIGH" && linePct > 0.72 && normalizePick(pick) === "under") {
    parts.push(`Line appears inflated for a volatile ${stat} category.`);
  }
  if (payout === "goblin") {
    parts.push("Goblin line provides safer margin versus average production.");
  }
  if (payout === "demon") {
    parts.push(`Demon threshold on ${stat} adds payout upside but shrinks hit rate.`);
  }
  if (normalizePick(pick) === "under" && linePct > 0.78) {
    parts.push("Under selected due to elevated line and high variance stat.");
  }
  if (normalizePick(pick) === "over" && linePct < 0.28) {
    parts.push(`Line sits below typical ${sport} ${stat} output — Over offers cushion.`);
  }
  if (volatility.tier === "LOW" && edge >= 1.0) {
    parts.push(`Stable ${stat} profile supports ${direction} with ${edge.toFixed(1)} unit edge.`);
  }
  if (volatility.tier === "MEDIUM" && edge >= 0.8 && edge < 1.4) {
    parts.push(`${direction} aligns with moderate ${stat} edge versus posted line ${line}.`);
  }
  if (riskLevel === "High") {
    parts.push("High-risk spot: variance and line difficulty compress confidence.");
  }
  if (riskLevel === "Low" && payout !== "goblin") {
    parts.push(`${direction} grades as a lower-variance manual entry.`);
  }
  if (edge >= 1.6) {
    parts.push(`Strong ${edge.toFixed(1)}-unit edge detected on ${direction.toLowerCase()} side.`);
  }
  if (edge <= 0.3) {
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
  const pick = normalizePick(input.side || input.pick);
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

  let edge = calculateManualEdge({
    line,
    fairLine,
    pick,
    volatility,
    payoutType,
    fingerprint,
  });

  if (Number.isFinite(liveProjection) && Number.isFinite(line)) {
    const liveEdge =
      pick === "over"
        ? liveProjection - line
        : line - liveProjection;
    if (liveEdge > 0) {
      edge = round(clamp(Math.max(edge, Math.abs(liveEdge) * 0.85), 0.1, 2.5), 2);
    }
  }

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
    riskLevel,
    whyThisPick,
    qualificationReason: whyThisPick,
    premiumWhySummary: whyThisPick,
    projectedValue: fairLine,
    projection: fairLine,
    manualVolatilityTier: volatility.tier,
    manualVolatilityScore: volatility.score,
    volatility: round(1.5 + volatility.score * 2.5, 2),
    manualDynamicAnalysis: true,
    projectionSource: liveScored?.projectionSource || "manual-dynamic",
    dataQualityScore: Math.round(48 + (1 - volatility.score) * 22 + Math.min(edge, 2) * 6),
  };
}

export function mergeManualPropScoring(builtProp = {}, manualScore = {}, liveScored = null) {
  const lean = manualScore.bestPick || builtProp.bestPick || builtProp.side;
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
    bettingLabel: liveScored?.bettingLabel || "Manual Analyze",
    displayTier: liveScored?.displayTier || "research",
    lineSourceBadge: "MANUAL",
    analyzedAt: new Date().toISOString(),
  };
}

export function rankManualPropScore(prop = {}) {
  const conf = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const edge = Number(prop.edge ?? 0);
  const vol = Number(prop.manualVolatilityScore ?? 0.5);
  return conf * 1.5 + edge * 12 - vol * 18;
}

export function sortManualPropsByRank(props = []) {
  return [...(props || [])].sort((a, b) => {
    const rankDiff = rankManualPropScore(b) - rankManualPropScore(a);
    if (rankDiff !== 0) return rankDiff;
    return Number(b.edge ?? 0) - Number(a.edge ?? 0);
  });
}

export function selectManualTopPicksByRank(props = [], limit = 2) {
  return sortManualPropsByRank(props).slice(0, Math.max(0, limit));
}
