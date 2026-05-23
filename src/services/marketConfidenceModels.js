import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { isTennisSportLabel } from "../utils/marketClassification.js";

export const MARKET_CONFIDENCE_WEIGHTS = {
  matchup: 0.3,
  recentForm: 0.25,
  consistency: 0.2,
  projectionEdge: 0.15,
  lineValue: 0.1,
};

export const PROP_VOLATILITY_TIERS = {
  LOW: {
    minEdge: 0.5,
    readyConfidence: 65,
    topConfidence: 72,
    minAgreement: 0.45,
    confidencePenalty: 0,
  },
  MEDIUM: {
    minEdge: 0.85,
    readyConfidence: 66,
    topConfidence: 74,
    minAgreement: 0.55,
    confidencePenalty: 3,
  },
  HIGH: {
    minEdge: 1.25,
    readyConfidence: 70,
    topConfidence: 78,
    minAgreement: 0.65,
    confidencePenalty: 8,
  },
};

const LOW_VOLATILITY_KEYS = new Set(["strikeouts", "gamesWon", "points", "pra"]);
const MEDIUM_VOLATILITY_KEYS = new Set(["fantasyScore", "totalBases", "hrr", "outs", "rebounds", "assists"]);
const HIGH_VOLATILITY_KEYS = new Set(["homeRuns", "stolenBases", "doubleFaults", "threes"]);

const MARKET_MODELS = {
  mlb_pitcher_strikeouts: { sport: "MLB", keys: new Set(["strikeouts"]) },
  mlb_pitching_outs: { sport: "MLB", keys: new Set(["outs"]) },
  mlb_hrr: { sport: "MLB", keys: new Set(["hrr"]) },
  mlb_total_bases: { sport: "MLB", keys: new Set(["totalBases"]) },
  mlb_fantasy_score: { sport: "MLB", keys: new Set(["fantasyScore"]) },
  basketball_pra: { sport: "BASKETBALL", keys: new Set(["pra"]) },
  basketball_fantasy: { sport: "BASKETBALL", keys: new Set(["fantasyScore"]) },
  tennis_games_won: { sport: "TENNIS", keys: new Set(["gamesWon"]) },
  tennis_aces: { sport: "TENNIS", keys: new Set(["aces"]) },
};

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

function sideAligned(edge, side = "") {
  const pick = String(side || "").toLowerCase();
  if (!Number.isFinite(edge) || !pick) return null;
  if (pick === "more" || pick === "higher" || pick === "over") return edge > 0;
  if (pick === "less" || pick === "lower" || pick === "under") return edge < 0;
  return Math.abs(edge) > 0;
}

function mergeMarketContext(prop = {}) {
  const profile = prop.profile || {};
  const manual = prop.manualStats || {};
  return { ...profile, ...manual, ...prop };
}

function inferTennisSurface(prop = {}) {
  if (prop.surface) return String(prop.surface).toLowerCase();
  const blob = [prop.description, prop.league, prop.opponent, prop.team, prop.matchupNote]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/clay|roland|garros|monte carlo|madrid|rome/.test(blob)) return "clay";
  if (/grass|wimbledon|queens|halle/.test(blob)) return "grass";
  return "hard";
}

function surfaceSpeedScore(surface = "hard") {
  if (surface === "grass") return 78;
  if (surface === "hard") return 62;
  if (surface === "clay") return 48;
  return 55;
}

function scoreFromRatio(ratio, center = 0, spread = 0.12) {
  if (!Number.isFinite(ratio)) return 50;
  return clamp(50 + ((ratio - center) / spread) * 25, 0, 100);
}

function scoreProjectionEdgePillar(ctx = {}) {
  const line = finiteNumber(ctx.line);
  const projection = finiteNumber(ctx.projection ?? ctx.projectedValue);
  const edge = finiteNumber(ctx.edge);
  const bestPick = ctx.bestPick || ctx.modelSide || "";
  let score = 35;
  const parts = [];

  if (Number.isFinite(projection) && Number.isFinite(line) && line > 0) {
    const rawEdge = projection - line;
    const aligned = sideAligned(rawEdge, bestPick);
    const magnitude = Math.abs(rawEdge);
    score = clamp(42 + (magnitude / line) * 120 + magnitude * 6, 0, 100);
    if (aligned === false) score *= 0.4;
    parts.push(`Proj ${round(projection)} vs ${round(line)}`);
  } else if (Number.isFinite(edge) && Number.isFinite(line) && line > 0) {
    score = clamp(40 + (Math.abs(edge) / line) * 90 + Math.abs(edge) * 5, 0, 92);
    parts.push(`Edge ${round(edge)}`);
  } else if (Number.isFinite(edge) && edge > 0) {
    score = clamp(35 + edge * 8, 0, 75);
  }

  return { score: round(score), detail: parts.join(" · ") || "Projection edge unavailable." };
}

function scoreLineValuePillar(ctx = {}) {
  let score = 40;
  const parts = [];
  const lineComparison = ctx.lineComparison || null;
  const sportsbook = ctx.sportsbookComparison || null;
  const discrepancy = finiteNumber(ctx.sportsbookDiscrepancy);
  const movement = ctx.lineMovement;

  if (lineComparison && Number.isFinite(lineComparison.difference)) {
    score += clamp(lineComparison.difference * 8, 0, 18);
    parts.push(`PP/UD gap ${round(lineComparison.difference)}`);
  }
  if (sportsbook && Number.isFinite(sportsbook.marketAverageLine) && Number.isFinite(ctx.line)) {
    score += clamp(Math.abs(Number(ctx.line) - Number(sportsbook.marketAverageLine)) * 10, 0, 20);
    parts.push(`book ${round(sportsbook.marketAverageLine)}`);
  }
  if (Number.isFinite(discrepancy)) {
    score += clamp(discrepancy * 12, 0, 18);
    if (discrepancy >= 0.5) parts.push("soft DFS line");
  }
  if (movement?.supportsPick) {
    score += 8;
    parts.push("movement supports pick");
  } else if (movement?.againstPick) {
    score -= 10;
    parts.push("movement against pick");
  }
  if (ctx.sharpMoneyIndicator === "Strong alignment") score += 10;

  return { score: round(clamp(score, 0, 100)), detail: parts.join(" · ") || "No cross-book line edge." };
}

function scoreConsistencyPillar(ctx = {}, { lowVolatilityBonus = false } = {}) {
  const volatility = finiteNumber(ctx.volatility);
  const sampleSize = finiteNumber(ctx.sampleSize) || 0;
  const l10Hit = finiteNumber(ctx.last10HitRate ?? ctx.recentHitRate);
  const l5Hit = finiteNumber(ctx.last5HitRate);
  let score = 45;
  const parts = [];

  if (Number.isFinite(volatility)) {
    if (volatility <= 1.5) {
      score += 28;
      parts.push(`low vol ${round(volatility)}`);
    } else if (volatility <= 2.25) {
      score += 18;
      parts.push(`stable vol ${round(volatility)}`);
    } else if (volatility <= 3) {
      score += 6;
    } else if (volatility <= 4) {
      score -= 12;
      parts.push(`high vol ${round(volatility)}`);
    } else {
      score -= 22;
      parts.push(`very high vol ${round(volatility)}`);
    }
  }

  if (Number.isFinite(l10Hit)) {
    score += clamp((l10Hit - 0.45) * 70, -8, 18);
    parts.push(`L10 hit ${Math.round(l10Hit * 100)}%`);
  } else if (Number.isFinite(l5Hit)) {
    score += clamp((l5Hit - 0.45) * 55, -6, 14);
    parts.push(`L5 hit ${Math.round(l5Hit * 100)}%`);
  }

  if (sampleSize >= 10) score += 10;
  else if (sampleSize >= 5) score += 5;
  else if (sampleSize > 0) parts.push("limited sample");

  if (lowVolatilityBonus) score += 4;

  return { score: round(clamp(score, 0, 100)), detail: parts.join(" · ") || "Consistency unknown." };
}

function weightedComposite(pillars = {}) {
  return round(
    pillars.matchupScore * MARKET_CONFIDENCE_WEIGHTS.matchup +
      pillars.recentFormScore * MARKET_CONFIDENCE_WEIGHTS.recentForm +
      pillars.consistencyScore * MARKET_CONFIDENCE_WEIGHTS.consistency +
      pillars.projectionEdgeScore * MARKET_CONFIDENCE_WEIGHTS.projectionEdge +
      pillars.lineValueScore * MARKET_CONFIDENCE_WEIGHTS.lineValue
  );
}

function projectionAgreement(pillars = {}) {
  const scores = [
    pillars.matchupScore,
    pillars.recentFormScore,
    pillars.consistencyScore,
    pillars.projectionEdgeScore,
    pillars.lineValueScore,
  ].filter(Number.isFinite);
  if (!scores.length) return 0;
  return scores.filter((score) => score >= 50).length / scores.length;
}

export function resolveMarketConfidenceModel(prop = {}) {
  const sport = String(prop.sport || "");
  const key = canonicalMarketKey(prop.statType);
  if (sport === "MLB" && key === "strikeouts") return "mlb_pitcher_strikeouts";
  if (sport === "MLB" && key === "outs") return "mlb_pitching_outs";
  if (sport === "MLB" && key === "hrr") return "mlb_hrr";
  if (sport === "MLB" && key === "totalBases") return "mlb_total_bases";
  if (sport === "MLB" && key === "fantasyScore") return "mlb_fantasy_score";
  if ((sport === "NBA" || sport === "WNBA") && key === "pra") return "basketball_pra";
  if ((sport === "NBA" || sport === "WNBA") && key === "fantasyScore") return "basketball_fantasy";
  if (isTennisSportLabel(sport) && key === "gamesWon") return "tennis_games_won";
  if (isTennisSportLabel(sport) && key === "aces") return "tennis_aces";
  return null;
}

export function getPropVolatilityTier(prop = {}) {
  const key = canonicalMarketKey(prop.statType);
  if (HIGH_VOLATILITY_KEYS.has(key)) return "HIGH";
  if (MEDIUM_VOLATILITY_KEYS.has(key)) return "MEDIUM";
  if (LOW_VOLATILITY_KEYS.has(key)) return "LOW";
  if (prop.noveltyMarket || prop.marketSupportTier === 2) return "HIGH";
  return "MEDIUM";
}

export function meetsVolatilityTierRequirements(prop = {}, confidenceScore = 0) {
  const tier = getPropVolatilityTier(prop);
  const rules = PROP_VOLATILITY_TIERS[tier];
  const edge = Number(prop.edge || 0);
  const agreement = Number(prop.projectionAgreement ?? prop.marketConfidenceAgreement ?? 0);
  if (edge < rules.minEdge) return false;
  if (Number(confidenceScore) < rules.readyConfidence) return false;
  if (agreement > 0 && agreement < rules.minAgreement) return false;
  return true;
}

function scoreMlbPitcherStrikeouts(ctx = {}) {
  const line = finiteNumber(ctx.line);
  const last5 = finiteNumber(ctx.last5Average);
  const opponentK = finiteNumber(ctx.opponentAllowed);
  const factors = [];

  let matchup = 48;
  if (Number.isFinite(opponentK) && Number.isFinite(line) && line > 0) {
    matchup += clamp(((opponentK - line) / line) * 55, -15, 22);
    factors.push(`opp K rate ${round(opponentK)}`);
  }
  if (/favorable|left-on-left|right-on-right/i.test(String(ctx.handednessMatchup || ""))) matchup += 12;
  else if (/tough|mismatch/i.test(String(ctx.handednessMatchup || ""))) matchup -= 10;
  if (ctx.handednessMatchup) factors.push(String(ctx.handednessMatchup));
  const umpire = finiteNumber(ctx.umpireRating);
  if (Number.isFinite(umpire)) {
    matchup += clamp(umpire * 14, -6, 14);
    factors.push(`umpire boost ${round(umpire, 2)}`);
  }
  const weather = finiteNumber(ctx.weatherRating);
  if (Number.isFinite(weather) && weather < 0) {
    matchup += 6;
    factors.push("pitcher-friendly weather");
  }

  let recentForm = 45;
  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    recentForm += clamp(((last5 - line) / line) * 80, -18, 28);
    factors.push(`L5 K ${round(last5)}`);
  }
  if (/up|trending up|strong/i.test(String(ctx.strikeoutTrend || ""))) recentForm += 10;
  if (/down|trending down|weak/i.test(String(ctx.strikeoutTrend || ""))) recentForm -= 8;
  if (ctx.pitchCountTrend) {
    if (/stable|workload|regular/i.test(String(ctx.pitchCountTrend))) recentForm += 8;
    else recentForm -= 4;
    factors.push(String(ctx.pitchCountTrend));
  }
  if (/SP|starter|innings/i.test(String(ctx.roleContext || ""))) recentForm += 6;
  const whiffRate = finiteNumber(ctx.whiffRate ?? ctx.swingingStrikeRate);
  if (Number.isFinite(whiffRate)) {
    recentForm += clamp(whiffRate * 120, -6, 14);
    factors.push(`whiff ${round(whiffRate, 3)}`);
  }
  if (/walk|command issue|control problem/i.test(String(ctx.matchupNote || ctx.pitchCountTrend || ""))) {
    recentForm -= 8;
    factors.push("command/walk concern");
  }
  const kCeiling = finiteNumber(ctx.strikeoutCeiling ?? ctx.last10Average);
  if (Number.isFinite(kCeiling) && Number.isFinite(line) && kCeiling >= line + 2) {
    recentForm += 6;
    factors.push(`K ceiling ${round(kCeiling)}`);
  }

  const consistency = scoreConsistencyPillar(ctx, { lowVolatilityBonus: true });
  const projectionEdge = scoreProjectionEdgePillar(ctx);
  const lineValue = scoreLineValuePillar(ctx);

  return {
    modelId: "mlb_pitcher_strikeouts",
    modelLabel: "MLB Pitcher Strikeouts",
    matchupScore: round(clamp(matchup, 0, 100)),
    recentFormScore: round(clamp(recentForm, 0, 100)),
    consistencyScore: consistency.score,
    projectionEdgeScore: projectionEdge.score,
    lineValueScore: lineValue.score,
    factorDetails: [
      { label: "Opponent K / handedness / umpire / weather", detail: factors.join(" · ") || "Limited matchup context." },
      { label: "L5 K / pitch count / role", detail: `${ctx.strikeoutTrend || "—"} · ${ctx.pitchCountTrend || ctx.roleContext || "—"}` },
      { label: "Strikeout consistency", detail: consistency.detail },
      { label: "Projection edge", detail: projectionEdge.detail },
      { label: "Line value", detail: lineValue.detail },
    ],
  };
}

function scoreMlbHrr(ctx = {}) {
  const line = finiteNumber(ctx.line);
  const last5 = finiteNumber(ctx.last5Average);
  let matchup = 46;
  const factors = [];

  if (Number.isFinite(ctx.opponentAllowed) && Number.isFinite(line) && line > 0) {
    matchup += clamp(((ctx.opponentAllowed - line) / line) * 45, -12, 18);
    factors.push(`opp scoring env ${round(ctx.opponentAllowed)}`);
  }
  if (/hitter-friendly|offense|short porch|wind out/i.test(String(ctx.parkFactorNote || ""))) {
    matchup += 12;
    factors.push(String(ctx.parkFactorNote));
  } else if (/pitcher-friendly|suppress/i.test(String(ctx.parkFactorNote || ""))) {
    matchup -= 8;
  }
  if (ctx.handednessMatchup) {
    if (/favorable/i.test(String(ctx.handednessMatchup))) matchup += 8;
    factors.push(String(ctx.handednessMatchup));
  }
  const impliedRuns = finiteNumber(ctx.impliedRuns ?? ctx.totalImpliedRuns);
  if (Number.isFinite(impliedRuns)) {
    matchup += clamp((impliedRuns - 8.5) * 4, -8, 12);
    factors.push(`implied runs ${round(impliedRuns)}`);
  }

  let recentForm = 44;
  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    recentForm += clamp(((last5 - line) / line) * 75, -15, 24);
    factors.push(`L5 HRR ${round(last5)}`);
  }
  const hardHit = finiteNumber(ctx.barrelRateEstimate ?? ctx.gapPowerRate ?? ctx.extraBaseHitRate);
  if (Number.isFinite(hardHit)) {
    recentForm += clamp(hardHit * 120, 0, 16);
    factors.push(`hard contact proxy ${round(hardHit, 3)}`);
  }
  if (ctx.battingOrderNote) {
    if (/top|lead|two|three|cleanup/i.test(String(ctx.battingOrderNote))) recentForm += 8;
    factors.push(String(ctx.battingOrderNote));
  }
  if (Number.isFinite(ctx.recentStolenBaseRate) && ctx.recentStolenBaseRate > 0.08) {
    recentForm += 4;
    factors.push("SB upside");
  }

  const consistency = scoreConsistencyPillar(ctx);
  const projectionEdge = scoreProjectionEdgePillar(ctx);
  const lineValue = scoreLineValuePillar(ctx);

  return {
    modelId: "mlb_hrr",
    modelLabel: "MLB Hits+Runs+RBIs",
    matchupScore: round(clamp(matchup, 0, 100)),
    recentFormScore: round(clamp(recentForm, 0, 100)),
    consistencyScore: consistency.score,
    projectionEdgeScore: projectionEdge.score,
    lineValueScore: lineValue.score,
    factorDetails: [
      { label: "Order / hard hit / ERA / park / runs", detail: factors.join(" · ") || "Limited hitter context." },
      { label: "Recent HRR form", detail: factors.slice(0, 3).join(" · ") || "No recent HRR logs." },
      { label: "Consistency", detail: consistency.detail },
      { label: "Projection edge", detail: projectionEdge.detail },
      { label: "Line value", detail: lineValue.detail },
    ],
  };
}

function scoreMlbPitchingOuts(ctx = {}) {
  const line = finiteNumber(ctx.line);
  const last5 = finiteNumber(ctx.last5Average);
  const factors = [];
  let matchup = 46;

  if (Number.isFinite(ctx.opponentAllowed) && Number.isFinite(line) && line > 0) {
    matchup += clamp(((ctx.opponentAllowed - line) / line) * 35, -10, 14);
    factors.push(`opp patience ${round(ctx.opponentAllowed)}`);
  }
  if (/hook|quick|short leash/i.test(String(ctx.pitchCountTrend || ctx.roleContext || ""))) {
    matchup -= 10;
    factors.push("manager hook risk");
  }
  if (/blowout|runaway|large spread/i.test(String(ctx.matchupNote || ""))) {
    matchup -= 8;
    factors.push("blowout risk");
  }

  let recentForm = 44;
  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    recentForm += clamp(((last5 - line) / line) * 70, -14, 22);
    factors.push(`L5 outs ${round(last5)}`);
  }
  if (/regular|stable|workload/i.test(String(ctx.pitchCountTrend || ""))) recentForm += 8;
  if (/bullpen day|opener|tandem/i.test(String(ctx.roleContext || ""))) recentForm -= 12;

  const consistency = scoreConsistencyPillar(ctx, { lowVolatilityBonus: true });
  const projectionEdge = scoreProjectionEdgePillar(ctx);
  const lineValue = scoreLineValuePillar(ctx);

  return {
    modelId: "mlb_pitching_outs",
    modelLabel: "MLB Pitching Outs",
    matchupScore: round(clamp(matchup, 0, 100)),
    recentFormScore: round(clamp(recentForm, 0, 100)),
    consistencyScore: consistency.score,
    projectionEdgeScore: projectionEdge.score,
    lineValueScore: lineValue.score,
    factorDetails: [
      { label: "Innings / hook / blowout / opponent", detail: factors.join(" · ") || "Limited outing context." },
      { label: "Recent innings trend", detail: `${ctx.pitchCountTrend || ctx.roleContext || "—"}` },
      { label: "Outs consistency", detail: consistency.detail },
      { label: "Projection edge", detail: projectionEdge.detail },
      { label: "Line value", detail: lineValue.detail },
    ],
  };
}

function scoreMlbTotalBases(ctx = {}) {
  const line = finiteNumber(ctx.line);
  const last5 = finiteNumber(ctx.last5Average);
  const factors = [];
  let matchup = 46;

  if (/hitter-friendly|short porch|wind out/i.test(String(ctx.parkFactorNote || ""))) {
    matchup += 12;
    factors.push(String(ctx.parkFactorNote));
  } else if (/pitcher-friendly|suppress/i.test(String(ctx.parkFactorNote || ""))) {
    matchup -= 8;
  }
  if (ctx.handednessMatchup) {
    if (/favorable/i.test(String(ctx.handednessMatchup))) matchup += 8;
    factors.push(String(ctx.handednessMatchup));
  }
  if (Number.isFinite(ctx.opponentAllowed) && Number.isFinite(line) && line > 0) {
    matchup += clamp(((ctx.opponentAllowed - line) / line) * 40, -10, 14);
    factors.push(`contact quality ${round(ctx.opponentAllowed)}`);
  }

  let recentForm = 44;
  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    recentForm += clamp(((last5 - line) / line) * 75, -14, 24);
    factors.push(`L5 TB ${round(last5)}`);
  }
  const hardHit = finiteNumber(ctx.barrelRateEstimate ?? ctx.gapPowerRate ?? ctx.extraBaseHitRate);
  const iso = finiteNumber(ctx.iso ?? ctx.isolatedPower);
  if (Number.isFinite(hardHit)) {
    recentForm += clamp(hardHit * 130, 0, 16);
    factors.push(`hard hit ${round(hardHit, 3)}`);
  }
  if (Number.isFinite(iso)) {
    recentForm += clamp(iso * 45, 0, 10);
    factors.push(`ISO ${round(iso, 3)}`);
  }

  const consistency = scoreConsistencyPillar(ctx);
  const projectionEdge = scoreProjectionEdgePillar(ctx);
  const lineValue = scoreLineValuePillar(ctx);

  return {
    modelId: "mlb_total_bases",
    modelLabel: "MLB Total Bases",
    matchupScore: round(clamp(matchup, 0, 100)),
    recentFormScore: round(clamp(recentForm, 0, 100)),
    consistencyScore: consistency.score,
    projectionEdgeScore: projectionEdge.score,
    lineValueScore: lineValue.score,
    factorDetails: [
      { label: "Hard hit / ISO / park / pitcher", detail: factors.join(" · ") || "Limited power context." },
      { label: "Recent extra-base form", detail: factors.slice(0, 3).join(" · ") || "No recent TB logs." },
      { label: "Consistency", detail: consistency.detail },
      { label: "Projection edge", detail: projectionEdge.detail },
      { label: "Line value", detail: lineValue.detail },
    ],
  };
}

function scoreMlbFantasyScore(ctx = {}) {
  const line = finiteNumber(ctx.line);
  const last5 = finiteNumber(ctx.last5Average);
  const factors = [];
  let matchup = 46;

  if (Number.isFinite(ctx.opponentRank)) {
    if (ctx.opponentRank >= 22) {
      matchup += 12;
      factors.push(`soft matchup #${Math.round(ctx.opponentRank)}`);
    } else if (ctx.opponentRank <= 8) {
      matchup -= 8;
      factors.push(`tough matchup #${Math.round(ctx.opponentRank)}`);
    }
  }
  if (ctx.battingOrderNote && /top|lead|cleanup|three|four/i.test(String(ctx.battingOrderNote))) {
    matchup += 8;
    factors.push(String(ctx.battingOrderNote));
  }
  if (/stable|regular|everyday/i.test(String(ctx.roleContext || ctx.pitchCountTrend || ""))) {
    matchup += 6;
    factors.push("role stability");
  }

  let recentForm = 44;
  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    recentForm += clamp(((last5 - line) / line) * 70, -14, 22);
    factors.push(`L5 fantasy ${round(last5)}`);
  }
  const fantasyScores = Array.isArray(ctx.last5FantasyScores) ? ctx.last5FantasyScores : [];
  if (fantasyScores.length >= 3) {
    const avg = fantasyScores.reduce((sum, value) => sum + Number(value || 0), 0) / fantasyScores.length;
    if (Number.isFinite(line)) recentForm += clamp(((avg - line) / Math.max(line, 1)) * 55, -10, 16);
    factors.push(`L5 FS avg ${round(avg)}`);
  }

  const consistency = scoreConsistencyPillar(ctx);
  const projectionEdge = scoreProjectionEdgePillar(ctx);
  const lineValue = scoreLineValuePillar(ctx);

  return {
    modelId: "mlb_fantasy_score",
    modelLabel: "MLB Fantasy Score",
    matchupScore: round(clamp(matchup, 0, 100)),
    recentFormScore: round(clamp(recentForm, 0, 100)),
    consistencyScore: consistency.score,
    projectionEdgeScore: projectionEdge.score,
    lineValueScore: lineValue.score,
    factorDetails: [
      { label: "Role / lineup / matchup", detail: factors.join(" · ") || "Limited fantasy context." },
      { label: "Recent production", detail: factors.slice(0, 3).join(" · ") || "No recent fantasy logs." },
      { label: "Volatility / consistency", detail: consistency.detail },
      { label: "Projection edge", detail: projectionEdge.detail },
      { label: "Line value", detail: lineValue.detail },
    ],
  };
}

function scoreBasketballPra(ctx = {}) {
  const line = finiteNumber(ctx.line);
  const last5 = finiteNumber(ctx.last5Average);
  let matchup = 48;
  const factors = [];

  const oppRank = finiteNumber(ctx.opponentRank);
  if (Number.isFinite(oppRank)) {
    if (oppRank >= 22) {
      matchup += 14;
      factors.push(`weak defense #${Math.round(oppRank)}`);
    } else if (oppRank <= 8) {
      matchup -= 10;
      factors.push(`strong defense #${Math.round(oppRank)}`);
    }
  }
  const pace = finiteNumber(ctx.pace ?? ctx.paceRating);
  if (Number.isFinite(pace)) {
    matchup += clamp((pace - 98) * 1.2, -8, 12);
    factors.push(`pace ${round(pace, 1)}`);
  } else if (Number.isFinite(oppRank)) {
    matchup += clamp((oppRank - 15) * 0.6, -6, 8);
  }

  let recentForm = 46;
  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    recentForm += clamp(((last5 - line) / line) * 70, -14, 22);
    factors.push(`L5 PRA ${round(last5)}`);
  }
  const minutes = ctx.projectedMinutes || ctx.usageAdjustment;
  if (minutes) {
    if (/stable|floor|starter|high/i.test(String(minutes))) recentForm += 10;
    else if (/volatile|uncertain|limit/i.test(String(minutes))) recentForm -= 8;
    factors.push(String(minutes));
  }
  if (ctx.usageTrend?.stable || /stable|trending up/i.test(String(ctx.usageTrend?.label || ctx.usageTrend || ""))) {
    recentForm += 8;
    factors.push("usage stable/up");
  }
  const injuryRisk = String(ctx.injuryRisk || "Low");
  if (injuryRisk === "Low" || ctx.injuryClean) recentForm += 6;
  else if (injuryRisk === "Medium") recentForm -= 6;
  else if (injuryRisk === "High") recentForm -= 14;
  if (ctx.backToBack || /back-to-back|b2b/i.test(String(ctx.restNote || ctx.matchupNote || ""))) {
    recentForm -= 10;
    factors.push("back-to-back fatigue");
  }
  if (ctx.blowoutRisk || /blowout|rest starters/i.test(String(ctx.matchupNote || ""))) {
    recentForm -= 8;
    factors.push("blowout risk");
  }

  const consistency = scoreConsistencyPillar(ctx);
  const projectionEdge = scoreProjectionEdgePillar(ctx);
  const lineValue = scoreLineValuePillar(ctx);

  return {
    modelId: "basketball_pra",
    modelLabel: "Basketball PRA",
    matchupScore: round(clamp(matchup, 0, 100)),
    recentFormScore: round(clamp(recentForm, 0, 100)),
    consistencyScore: consistency.score,
    projectionEdgeScore: projectionEdge.score,
    lineValueScore: lineValue.score,
    factorDetails: [
      { label: "Minutes / usage / pace / defense", detail: factors.join(" · ") || "Limited role context." },
      { label: "Injury / fatigue / blowout", detail: `${injuryRisk} · ${ctx.restNote || ctx.matchupNote || "—"}` },
      { label: "PRA consistency", detail: consistency.detail },
      { label: "Projection edge", detail: projectionEdge.detail },
      { label: "Line value", detail: lineValue.detail },
    ],
  };
}

function scoreBasketballFantasy(ctx = {}) {
  const line = finiteNumber(ctx.line);
  const fantasyScores = Array.isArray(ctx.last5FantasyScores) ? ctx.last5FantasyScores.filter(Number.isFinite) : [];
  let matchup = 50;
  let recentForm = 46;
  const factors = [];

  if (Number.isFinite(ctx.opponentRank)) {
    matchup += clamp((ctx.opponentRank - 15) * 0.8, -8, 10);
    factors.push(`defense rank #${Math.round(ctx.opponentRank)}`);
  }
  if (/competitive|close spread|playoff/i.test(String(ctx.matchupNote || ctx.gameCompetitiveness || ""))) {
    matchup += 8;
    factors.push("competitive game");
  }

  if (fantasyScores.length >= 3) {
    const avg = fantasyScores.reduce((sum, value) => sum + value, 0) / fantasyScores.length;
    const spread = Math.max(...fantasyScores) - Math.min(...fantasyScores);
    recentForm += clamp(((avg - (line || avg)) / Math.max(1, line || avg)) * 65, -12, 20);
    recentForm += spread <= 6 ? 10 : spread <= 10 ? 4 : -6;
    factors.push(`L5 fantasy avg ${round(avg)} · spread ${round(spread)}`);
  } else if (Number.isFinite(ctx.last5Average) && Number.isFinite(line)) {
    recentForm += clamp(((ctx.last5Average - line) / line) * 60, -12, 18);
  }

  if (ctx.usageTrend?.stable || /stable/i.test(String(ctx.usageAdjustment || ""))) recentForm += 8;
  if (Number.isFinite(ctx.projectedMinutes) || /minutes floor|stable minutes/i.test(String(ctx.projectedMinutes || ctx.usageAdjustment || ""))) {
    recentForm += 6;
    factors.push("minutes floor");
  }
  if (Number.isFinite(ctx.stocksRate) || /stocks|stl.*blk/i.test(String(ctx.matchupNote || ""))) {
    recentForm += 5;
    factors.push("stocks upside");
  }
  if (Number.isFinite(ctx.turnoverRate) && ctx.turnoverRate > 0.18) recentForm -= 6;

  const consistency = scoreConsistencyPillar(ctx);
  const projectionEdge = scoreProjectionEdgePillar(ctx);
  const lineValue = scoreLineValuePillar(ctx);

  return {
    modelId: "basketball_fantasy",
    modelLabel: "Basketball Fantasy Score",
    matchupScore: round(clamp(matchup, 0, 100)),
    recentFormScore: round(clamp(recentForm, 0, 100)),
    consistencyScore: consistency.score,
    projectionEdgeScore: projectionEdge.score,
    lineValueScore: lineValue.score,
    factorDetails: [
      { label: "All-around consistency / stocks / usage", detail: factors.join(" · ") || "Limited fantasy context." },
      { label: "Minutes / competitiveness", detail: String(ctx.projectedMinutes || ctx.usageAdjustment || "—") },
      { label: "Volatility control", detail: consistency.detail },
      { label: "Projection edge", detail: projectionEdge.detail },
      { label: "Line value", detail: lineValue.detail },
    ],
  };
}

function scoreTennisGamesWon(ctx = {}) {
  const surface = inferTennisSurface(ctx);
  const holdPct = finiteNumber(ctx.holdPct);
  const breakPct = finiteNumber(ctx.breakPct);
  const h2hEdge = finiteNumber(ctx.h2hEdge);
  let matchup = 48;
  const factors = [];

  matchup += surface === "hard" ? 4 : surface === "clay" ? -2 : 6;
  factors.push(`surface ${surface}`);
  if (Number.isFinite(holdPct)) {
    matchup += clamp((holdPct - 0.68) * 120, -10, 16);
    factors.push(`hold ${Math.round(holdPct * 100)}%`);
  }
  if (Number.isFinite(breakPct)) {
    matchup += clamp((breakPct - 0.22) * 80, -8, 12);
    factors.push(`break ${Math.round(breakPct * 100)}%`);
  }
  if (Number.isFinite(h2hEdge)) {
    matchup += clamp(h2hEdge * 90, -10, 12);
    factors.push(`H2H edge ${round(h2hEdge * 100, 1)}%`);
  }
  if (/fatigue|long match|3 sets/i.test(String(ctx.matchupNote || ctx.opponentFatigue || ""))) {
    matchup += 8;
    factors.push("opponent fatigue");
  }
  if (/indoor|outdoor/i.test(String(ctx.venue || ctx.matchupNote || ""))) factors.push(String(ctx.venue || "venue context"));

  let recentForm = 46;
  const last5 = finiteNumber(ctx.last5Average);
  const line = finiteNumber(ctx.line);
  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    recentForm += clamp(((last5 - line) / line) * 70, -14, 20);
    factors.push(`recent form ${round(last5)}`);
  }
  const l10Hit = finiteNumber(ctx.last10HitRate ?? ctx.recentHitRate);
  if (Number.isFinite(l10Hit)) recentForm += clamp((l10Hit - 0.45) * 50, -8, 14);

  const consistency = scoreConsistencyPillar(ctx, { lowVolatilityBonus: true });
  const projectionEdge = scoreProjectionEdgePillar(ctx);
  const lineValue = scoreLineValuePillar(ctx);

  return {
    modelId: "tennis_games_won",
    modelLabel: "Tennis Games Won",
    matchupScore: round(clamp(matchup, 0, 100)),
    recentFormScore: round(clamp(recentForm, 0, 100)),
    consistencyScore: consistency.score,
    projectionEdgeScore: projectionEdge.score,
    lineValueScore: lineValue.score,
    factorDetails: [
      { label: "Surface / hold / break / H2H / fatigue", detail: factors.join(" · ") || "Limited tennis matchup data." },
      { label: "Recent form", detail: `L5 ${round(last5) || "—"} · tiebreak context ${ctx.tiebreakRate || "—"}` },
      { label: "Games consistency", detail: consistency.detail },
      { label: "Projection edge", detail: projectionEdge.detail },
      { label: "Line value", detail: lineValue.detail },
    ],
  };
}

function scoreTennisAces(ctx = {}) {
  const surface = inferTennisSurface(ctx);
  const aceRate = finiteNumber(ctx.aceRate ?? ctx.last5Average);
  const holdPct = finiteNumber(ctx.holdPct);
  const returnPct = finiteNumber(ctx.opponentReturnPct ?? ctx.opponentAllowed);
  let matchup = 46;
  const factors = [];

  matchup += surfaceSpeedScore(surface) * 0.18;
  factors.push(`surface speed ${surface}`);
  if (Number.isFinite(returnPct)) {
    matchup += clamp((0.35 - returnPct) * 80, -8, 14);
    factors.push(`opp return ${Math.round(returnPct * 100)}%`);
  }
  if (Number.isFinite(holdPct)) {
    matchup += clamp((holdPct - 0.7) * 70, -8, 12);
    factors.push(`hold ${Math.round(holdPct * 100)}%`);
  }
  if (Number.isFinite(ctx.firstServePct)) {
    matchup += clamp((ctx.firstServePct - 0.6) * 60, -6, 10);
    factors.push(`1st serve ${Math.round(ctx.firstServePct * 100)}%`);
  }
  if (Number.isFinite(ctx.expectedSets)) {
    matchup += clamp((ctx.expectedSets - 2.3) * 10, -4, 10);
    factors.push(`proj sets ${round(ctx.expectedSets)}`);
  }

  let recentForm = 44;
  const line = finiteNumber(ctx.line);
  if (Number.isFinite(aceRate) && Number.isFinite(line) && line > 0) {
    recentForm += clamp(((aceRate - line) / line) * 75, -14, 22);
    factors.push(`ace rate ${round(aceRate)}`);
  }
  if (/up|strong/i.test(String(ctx.strikeoutTrend || ctx.matchupNote || ""))) recentForm += 6;

  const consistency = scoreConsistencyPillar(ctx);
  const projectionEdge = scoreProjectionEdgePillar(ctx);
  const lineValue = scoreLineValuePillar(ctx);

  return {
    modelId: "tennis_aces",
    modelLabel: "Tennis Aces",
    matchupScore: round(clamp(matchup, 0, 100)),
    recentFormScore: round(clamp(recentForm, 0, 100)),
    consistencyScore: consistency.score,
    projectionEdgeScore: projectionEdge.score,
    lineValueScore: lineValue.score,
    factorDetails: [
      { label: "Ace % / surface / return / sets", detail: factors.join(" · ") || "Limited ace context." },
      { label: "Serve dominance", detail: `hold ${holdPct ? Math.round(holdPct * 100) : "—"}% · 1st serve ${ctx.firstServePct ? Math.round(ctx.firstServePct * 100) : "—"}%` },
      { label: "Ace consistency", detail: consistency.detail },
      { label: "Projection edge", detail: projectionEdge.detail },
      { label: "Line value", detail: lineValue.detail },
    ],
  };
}

const MODEL_SCORERS = {
  mlb_pitcher_strikeouts: scoreMlbPitcherStrikeouts,
  mlb_pitching_outs: scoreMlbPitchingOuts,
  mlb_hrr: scoreMlbHrr,
  mlb_total_bases: scoreMlbTotalBases,
  mlb_fantasy_score: scoreMlbFantasyScore,
  basketball_pra: scoreBasketballPra,
  basketball_fantasy: scoreBasketballFantasy,
  tennis_games_won: scoreTennisGamesWon,
  tennis_aces: scoreTennisAces,
};

export function scoreMarketConfidence(prop = {}, options = {}) {
  const modelId = resolveMarketConfidenceModel(prop);
  if (!modelId) return null;

  const scorer = MODEL_SCORERS[modelId];
  if (!scorer) return null;

  const ctx = mergeMarketContext(prop);
  const pillars = scorer(ctx);
  const compositeScore = weightedComposite(pillars);
  const agreement = projectionAgreement(pillars);
  const volatilityTier = getPropVolatilityTier(prop);
  const tierRules = PROP_VOLATILITY_TIERS[volatilityTier];

  let adjustedScore = compositeScore;
  const edge = Number(ctx.edge || 0);
  if (edge < tierRules.minEdge) adjustedScore -= tierRules.confidencePenalty + 6;
  if (agreement < tierRules.minAgreement) adjustedScore -= tierRules.confidencePenalty;
  adjustedScore = round(clamp(adjustedScore, 0, 100));

  const meetsVolatilityRequirements =
    edge >= tierRules.minEdge &&
    adjustedScore >= tierRules.readyConfidence &&
    agreement >= tierRules.minAgreement;

  return {
    ...pillars,
    compositeScore,
    adjustedScore,
    agreement,
    modelId,
    modelLabel: pillars.modelLabel,
    volatilityTier,
    meetsVolatilityRequirements,
    volatilityRequirementNote: meetsVolatilityRequirements
      ? ""
      : `Needs edge ≥${tierRules.minEdge}, agreement ≥${Math.round(tierRules.minAgreement * 100)}%, conf ≥${tierRules.readyConfidence} (${volatilityTier} vol).`,
    factorDetails: pillars.factorDetails || [],
    weights: MARKET_CONFIDENCE_WEIGHTS,
    options,
  };
}

export function buildMarketConfidenceExplanation(result = {}) {
  if (!result?.modelId) return [];
  return [
    {
      key: "matchupScore",
      label: "Matchup Score",
      score: round((result.matchupScore || 0) * MARKET_CONFIDENCE_WEIGHTS.matchup, 1),
      max: round(100 * MARKET_CONFIDENCE_WEIGHTS.matchup, 1),
      detail: result.factorDetails?.[0]?.detail || "",
    },
    {
      key: "recentFormScore",
      label: "Recent Form Score",
      score: round((result.recentFormScore || 0) * MARKET_CONFIDENCE_WEIGHTS.recentForm, 1),
      max: round(100 * MARKET_CONFIDENCE_WEIGHTS.recentForm, 1),
      detail: result.factorDetails?.[1]?.detail || "",
    },
    {
      key: "consistencyScore",
      label: "Consistency Score",
      score: round((result.consistencyScore || 0) * MARKET_CONFIDENCE_WEIGHTS.consistency, 1),
      max: round(100 * MARKET_CONFIDENCE_WEIGHTS.consistency, 1),
      detail: result.factorDetails?.[2]?.detail || "",
    },
    {
      key: "projectionEdgeScore",
      label: "Projection Edge",
      score: round((result.projectionEdgeScore || 0) * MARKET_CONFIDENCE_WEIGHTS.projectionEdge, 1),
      max: round(100 * MARKET_CONFIDENCE_WEIGHTS.projectionEdge, 1),
      detail: result.factorDetails?.[3]?.detail || "",
    },
    {
      key: "lineValueScore",
      label: "Line Value",
      score: round((result.lineValueScore || 0) * MARKET_CONFIDENCE_WEIGHTS.lineValue, 1),
      max: round(100 * MARKET_CONFIDENCE_WEIGHTS.lineValue, 1),
      detail: result.factorDetails?.[4]?.detail || "",
    },
    {
      key: "marketModel",
      label: "Market Model",
      score: round(result.compositeScore || 0, 1),
      max: 100,
      detail: `${result.modelLabel || result.modelId} · ${result.volatilityTier || "MEDIUM"} volatility · agreement ${Math.round((result.agreement || 0) * 100)}%`,
    },
    ...(result.volatilityRequirementNote
      ? [
          {
            key: "volatilityGate",
            label: "Volatility Gate",
            score: result.meetsVolatilityRequirements ? 0 : -round(PROP_VOLATILITY_TIERS[result.volatilityTier]?.confidencePenalty || 0, 1),
            max: 0,
            detail: result.volatilityRequirementNote,
          },
        ]
      : []),
  ];
}

export function listMarketConfidenceModels() {
  return Object.entries(MARKET_MODELS).map(([id, meta]) => ({ id, ...meta }));
}
