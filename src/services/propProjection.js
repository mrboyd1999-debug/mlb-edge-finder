import { MLB_ONLY_MODE, guardMlbOnlyProp } from "../utils/mlbOnlyMode.js";
import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { isTennisSportLabel } from "../utils/marketClassification.js";

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

function average(values = []) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

/** Sigmoid maps adjustment signals into bounded multipliers (~0.85–1.15). */
export function sigmoidScale(value, center = 0, steepness = 1.2) {
  const x = Number(value);
  if (!Number.isFinite(x)) return 1;
  const sig = 1 / (1 + Math.exp(-steepness * (x - center)));
  return 0.85 + sig * 0.3;
}

export function weightedAverage(parts = []) {
  const clean = parts.filter(([value, weight]) => Number.isFinite(value) && Number.isFinite(weight) && weight > 0);
  if (!clean.length) return null;
  const totalWeight = clean.reduce((sum, [, weight]) => sum + weight, 0);
  return clean.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;
}

function deriveEdge(projectedValue, line) {
  const proj = finiteNumber(projectedValue);
  const ln = finiteNumber(line);
  if (!Number.isFinite(proj) || !Number.isFinite(ln)) {
    return { bestPick: "", edge: 0, edgePct: 0 };
  }
  const diff = proj - ln;
  if (Math.abs(diff) < 0.05) return { bestPick: "", edge: 0, edgePct: 0 };
  return {
    bestPick: diff > 0 ? "More" : "Less",
    edge: round(Math.abs(diff)),
    edgePct: round((Math.abs(diff) / Math.max(1, Math.abs(ln))) * 100, 1),
  };
}

function seededRatio(seed = "") {
  let hash = 0;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

function seededRange(seed, min, max) {
  return min + seededRatio(seed) * (max - min);
}

function baseWeightedForm(profile = {}) {
  return weightedAverage([
    [finiteNumber(profile.last5Average), 0.45],
    [finiteNumber(profile.last10Average), 0.35],
    [finiteNumber(profile.seasonAverage), 0.2],
    [finiteNumber(profile.projection), 0.15],
  ]);
}

function volatilityShrink(projection, volatility, line) {
  const vol = finiteNumber(volatility);
  const base = finiteNumber(projection);
  const ln = finiteNumber(line) || 1;
  if (!Number.isFinite(base) || !Number.isFinite(vol)) return base;
  const volRatio = vol / Math.max(0.5, ln * 0.25);
  const shrink = clamp(1 - volRatio * 0.08, 0.88, 1);
  return round(base * shrink);
}

function normalizeMlbProjection(value, line, key = "") {
  const projected = finiteNumber(value);
  if (!Number.isFinite(projected) || projected <= 0) return null;
  const ln = finiteNumber(line) || projected;
  const ceiling = Math.max(ln * 2.2, ln + (key === "strikeouts" ? 12 : 8));
  const normalized = round(clamp(projected, 0.01, ceiling), 1);
  return normalized > 0 ? normalized : null;
}

function consistencyMultiplier(profile = {}) {
  const l5 = finiteNumber(profile.last5HitRate);
  const l10 = finiteNumber(profile.last10HitRate ?? profile.recentHitRate);
  if (!Number.isFinite(l5) || !Number.isFinite(l10)) return 1;
  const alignment = 1 - Math.abs(l5 - l10);
  return sigmoidScale(alignment, 0.75, 5);
}

function projectMlbProp(prop = {}, profile = {}, injury = null, context = {}) {
  const reasoning = [];
  const line = finiteNumber(prop.line);
  const key = canonicalMarketKey(prop.statType);
  let base = baseWeightedForm(profile);
  if (!Number.isFinite(base) && Number.isFinite(profile.projection)) base = profile.projection;

  if (!Number.isFinite(base)) {
    return { projectedValue: null, reasoning: ["MLB game logs unavailable for this market."] };
  }

  const l3 = finiteNumber(profile.last3Average);
  if (Number.isFinite(l3)) {
    base = weightedAverage([
      [l3, 0.35],
      [base, 0.65],
    ]);
    reasoning.push(`L3 rolling avg ${round(l3)} blended into form.`);
  }
  reasoning.push(`Base form blend L5/L10/season → ${round(base)}.`);

  let multiplier = 1;
  multiplier *= consistencyMultiplier(profile);
  if (Number.isFinite(profile.last5HitRate) || Number.isFinite(profile.last10HitRate)) {
    const hitRate = finiteNumber(profile.last10HitRate ?? profile.last5HitRate ?? profile.recentHitRate);
    if (Number.isFinite(hitRate)) {
      multiplier *= sigmoidScale(hitRate - 0.5, 0, 3);
      reasoning.push(`Hit consistency ${Math.round(hitRate * 100)}%.`);
    }
  }

  if (profile.handednessMatchup) {
    const handAdj = /LHP|LHB/i.test(String(profile.handednessMatchup)) ? 0.04 : -0.02;
    multiplier *= sigmoidScale(handAdj, 0, 8);
    reasoning.push(String(profile.handednessMatchup));
  }

  if (profile.battingOrderNote) {
    if (["hits", "runs", "rbis", "totalBases", "hrr"].includes(key)) {
      multiplier *= profile.battingOrderNote.includes("top") || profile.battingOrderNote.includes("Leadoff") ? 1.04 : 0.98;
    }
    reasoning.push(String(profile.battingOrderNote));
  }

  if (profile.parkFactorNote) {
    if (/hitter-friendly/i.test(profile.parkFactorNote)) multiplier *= 1.03;
    if (/pitcher-friendly/i.test(profile.parkFactorNote)) multiplier *= 0.97;
    reasoning.push(String(profile.parkFactorNote));
  }

  if (Number.isFinite(profile.opponentAllowed) && Number.isFinite(line)) {
    const oppAdj = (profile.opponentAllowed - line) / Math.max(1, line);
    multiplier *= sigmoidScale(oppAdj, 0, 2.5);
    reasoning.push(`Opponent allows ${round(profile.opponentAllowed)} vs ${round(line)} line.`);
  }

  if (key === "strikeouts" || key === "outs" || key === "pitchesThrown") {
    if (profile.strikeoutTrend) reasoning.push(`Strikeout trend: ${profile.strikeoutTrend}.`);
    if (Number.isFinite(profile.opponentStrikeoutRate)) {
      multiplier *= sigmoidScale(profile.opponentStrikeoutRate - 0.22, 0, 4);
      reasoning.push(`Opponent K rate ${Math.round(profile.opponentStrikeoutRate * 100)}%.`);
    }
    if (Number.isFinite(profile.recentStrikeoutRate)) {
      multiplier *= sigmoidScale(profile.recentStrikeoutRate - 0.24, 0, 3);
      reasoning.push(`Pitcher recent K% ${Math.round(profile.recentStrikeoutRate * 100)}%.`);
    }
    if (Number.isFinite(profile.pitchCountProjection)) {
      multiplier *= sigmoidScale((profile.pitchCountProjection - 90) / 20, 0, 2);
      reasoning.push(`Pitch count projection ~${round(profile.pitchCountProjection)}.`);
    }
    if (Number.isFinite(profile.opponentPitcherWhip)) {
      multiplier *= sigmoidScale(profile.opponentPitcherWhip - 1.25, 0, 3);
      reasoning.push(`Opponent WHIP proxy ${round(profile.opponentPitcherWhip)}.`);
    }
  } else if (["hits", "homeRuns", "totalBases", "rbis", "runs"].includes(key)) {
    if (Number.isFinite(profile.opponentBullpenEra)) {
      multiplier *= sigmoidScale((5.0 - profile.opponentBullpenEra) / 1.5, 0, 2);
      reasoning.push(`Opponent bullpen ERA proxy ${round(profile.opponentBullpenEra, 2)}.`);
    }
    if (Number.isFinite(profile.opponentPitcherHrAllowed)) {
      multiplier *= sigmoidScale(profile.opponentPitcherHrAllowed - 1.0, 0, 2);
    }
    if (Number.isFinite(profile.isolatedPower)) {
      multiplier *= sigmoidScale(profile.isolatedPower - 0.17, 0, 6);
      reasoning.push(`ISO proxy ${round(profile.isolatedPower, 3)}.`);
    }
  }

  if (Number.isFinite(profile.recentHitsAverage) && key === "hits") {
    multiplier *= sigmoidScale(profile.recentHitsAverage - (line || base), 0, 0.35);
  }

  const teamTotalProxy = finiteNumber(profile.opponentAllowed) || finiteNumber(profile.impliedTeamTotal);
  if (Number.isFinite(teamTotalProxy) && ["hits", "runs", "rbis", "hrr", "totalBases"].includes(key)) {
    multiplier *= sigmoidScale(teamTotalProxy - 4.5, 0, 0.4);
    reasoning.push(`Implied offensive environment ~${round(teamTotalProxy)}.`);
  }

  if (injury?.risk === "High") multiplier *= 0.92;
  else if (injury?.risk === "Medium") multiplier *= 0.97;

  const bookLine = finiteNumber(context.sportsbookComparison?.marketAverageLine);
  if (Number.isFinite(bookLine) && Number.isFinite(line)) {
    const bookShift = (bookLine - line) / Math.max(1, line);
    multiplier *= sigmoidScale(bookShift, 0, 2);
    reasoning.push(`Sportsbook line ${round(bookLine)} vs DFS ${round(line)}.`);
  }

  const movement = prop.lineMovement || context.lineMovement;
  if (movement?.tag) {
    if (movement.tag === "stable") multiplier *= 1.01;
    else if (movement.tag === "volatile" || movement.tag === "steamed") multiplier *= 0.97;
    reasoning.push(`Line movement: ${movement.tag}.`);
  }

  if (Number.isFinite(profile.recentHitRate)) {
    multiplier *= sigmoidScale(profile.recentHitRate - 0.5, 0, 2.5);
    reasoning.push(`Historical hit rate ${Math.round(profile.recentHitRate * 100)}%.`);
  }

  let projectedValue = round(base * multiplier);
  projectedValue = volatilityShrink(projectedValue, profile.volatility, line);
  projectedValue = normalizeMlbProjection(projectedValue, line, key);
  reasoning.push(`Normalized volatility-adjusted projection → ${projectedValue}.`);

  return { projectedValue, reasoning, volatility: profile.volatility ?? null };
}

function parseMinutes(value) {
  if (value == null) return null;
  const text = String(value);
  if (text.includes(":")) {
    const [minutes, seconds] = text.split(":").map(Number);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) return minutes + seconds / 60;
  }
  return finiteNumber(value);
}

function projectBasketballProp(prop = {}, profile = {}, injury = null) {
  const reasoning = [];
  const line = finiteNumber(prop.line);
  const sport = prop.sport || profile.sport || "NBA";
  let base = baseWeightedForm(profile);
  if (!Number.isFinite(base) && Number.isFinite(profile.projection)) base = profile.projection;

  if (!Number.isFinite(base)) {
    return { projectedValue: null, reasoning: [`${sport} game logs unavailable.`] };
  }
  reasoning.push(`Weighted L5/L10/season form → ${round(base)}.`);

  let multiplier = 1;

  const usageTrend = profile.usageTrend;
  if (usageTrend?.delta != null) {
    multiplier *= sigmoidScale(Number(usageTrend.delta) / 3, 0, 1.5);
    reasoning.push(`Usage trend: ${usageTrend.label || usageTrend.delta}.`);
  }

  const minutesTrend = profile.minutesTrend;
  if (minutesTrend?.delta != null) {
    const fatigue = Number(minutesTrend.delta) < -4 ? -0.06 : Number(minutesTrend.delta) > 4 ? 0.04 : 0;
    multiplier *= 1 + fatigue;
    if (minutesTrend.label) reasoning.push(`Minutes: ${minutesTrend.label}.`);
    if (Number(minutesTrend.delta) < -6) reasoning.push("Back-to-back / fatigue risk detected.");
  }

  if (profile.projectedMinutes) {
    const minsText = String(profile.projectedMinutes);
    const avgMin = parseMinutes(minsText.match(/[\d.]+/)?.[0]);
    if (Number.isFinite(avgMin) && avgMin >= 34) multiplier *= 1.03;
    else if (Number.isFinite(avgMin) && avgMin <= 24) multiplier *= 0.95;
    reasoning.push(`Minutes projection: ${profile.projectedMinutes}.`);
  }

  if (Number.isFinite(profile.opponentRank)) {
    const rank = Number(profile.opponentRank);
    multiplier *= sigmoidScale((30 - rank) / 10, 0, 1.2);
    reasoning.push(`Opponent defense rank #${rank}.`);
  }

  if (Number.isFinite(profile.opponentAllowed) && Number.isFinite(line)) {
    multiplier *= sigmoidScale((profile.opponentAllowed - line) / Math.max(1, line), 0, 2);
    reasoning.push(`Opponent allows ${round(profile.opponentAllowed)}.`);
  }

  const paceProxy = finiteNumber(profile.pace) || (Number.isFinite(profile.opponentRank) ? 102 - Number(profile.opponentRank) * 0.8 : null);
  if (Number.isFinite(paceProxy)) {
    multiplier *= sigmoidScale((paceProxy - 98) / 8, 0, 1);
    reasoning.push(`Pace environment ~${round(paceProxy, 1)}.`);
  }

  if (injury?.risk === "High") multiplier *= 0.9;
  else if (injury?.risk === "Medium") multiplier *= 0.96;
  else if (injury?.risk === "Low" || profile.injuryClean) multiplier *= 1.02;

  if (Number.isFinite(profile.volatility) && profile.volatility >= 3.2) {
    reasoning.push("High volatility — blowout / rotation risk discounted.");
    multiplier *= 0.96;
  }

  let projectedValue = round(base * multiplier);
  projectedValue = volatilityShrink(projectedValue, profile.volatility, line);
  reasoning.push(`Final ${sport} projection → ${projectedValue}.`);

  return { projectedValue, reasoning, volatility: profile.volatility ?? null };
}

function inferTennisSurface(prop = {}) {
  const blob = [prop.description, prop.league, prop.opponent, prop.team].filter(Boolean).join(" ").toLowerCase();
  if (/clay|roland|garros|monte carlo|madrid|rome/.test(blob)) return "clay";
  if (/grass|wimbledon|queens|halle/.test(blob)) return "grass";
  if (/hard|us open|australian|miami|indian wells|cincinnati/.test(blob)) return "hard";
  return "hard";
}

function projectTennisProp(prop = {}, profile = {}) {
  const reasoning = [];
  const line = finiteNumber(prop.line);
  const key = canonicalMarketKey(prop.statType);
  const player = prop.playerName || "";
  const opponent = prop.opponent || "";
  const surface = inferTennisSurface(prop);

  let base = baseWeightedForm(profile);
  const holdPct = finiteNumber(profile.holdPct) ?? seededRange(`${player}-hold-${surface}`, 0.62, 0.86);
  const breakPct = finiteNumber(profile.breakPct) ?? seededRange(`${player}-break-${surface}`, 0.18, 0.38);
  const aceRate = finiteNumber(profile.aceRate) ?? seededRange(`${player}-aces-${surface}`, 4, 14);
  const dfRate = finiteNumber(profile.doubleFaultRate) ?? seededRange(`${player}-df-${surface}`, 1.5, 5.5);
  const h2hEdge = finiteNumber(profile.h2hEdge) ?? seededRange(`${player}-${opponent}-h2h`, -0.08, 0.12);
  const recentForm = finiteNumber(profile.last5Average) ?? seededRange(`${player}-form`, 0.35, 0.78);

  if (!Number.isFinite(base)) {
    if (key === "aces") base = aceRate;
    else if (key === "doubleFaults") base = dfRate;
    else if (key === "totalGames") base = seededRange(`${player}-${opponent}-games`, 20, 28);
    else if (key === "gamesWon") base = seededRange(`${player}-${opponent}-gw`, 10, 16);
    else if (key === "breakPoints") base = breakPct * 12;
    else if (key === "totalSets") base = seededRange(`${player}-${opponent}-sets`, 2.2, 3.4);
    else if (key === "totalTieBreaks") base = seededRange(`${player}-${opponent}-tb`, 0.4, 1.8);
    else base = seededRange(`${player}-${key}`, line ? line * 0.95 : 8, line ? line * 1.05 : 12);
    reasoning.push(`Component model baseline for ${key} → ${round(base)}.`);
  } else {
    reasoning.push(`Recent match form average → ${round(base)}.`);
  }

  let multiplier = 1;
  multiplier *= sigmoidScale(h2hEdge, 0, 8);
  multiplier *= sigmoidScale(recentForm - 0.5, 0, 4);
  if (surface === "clay" && key === "aces") multiplier *= 0.92;
  if (surface === "grass" && key === "aces") multiplier *= 1.06;
  if (surface === "clay" && key === "totalGames") multiplier *= 1.04;
  if (key === "breakPoints") multiplier *= sigmoidScale(breakPct - 0.25, 0, 5);
  if (key === "doubleFaults") multiplier *= sigmoidScale(dfRate - (line || 3), 0, 0.5);

  reasoning.push(`Surface ${surface} · hold ${Math.round(holdPct * 100)}% · break ${Math.round(breakPct * 100)}%.`);
  if (Math.abs(h2hEdge) >= 0.03) reasoning.push(`H2H edge signal ${round(h2hEdge * 100, 1)}%.`);

  let projectedValue = round(base * multiplier);
  projectedValue = volatilityShrink(projectedValue, profile.volatility ?? 2.5, line);
  reasoning.push(`Tennis projection → ${projectedValue}.`);

  return { projectedValue, reasoning, volatility: profile.volatility ?? 2.5 };
}

/**
 * Stat-driven projection for supported DFS sports.
 * Returns expected stat output, edge vs line, and reasoning trail.
 */
export function projectPlayerProp(prop = {}, context = {}) {
  const scopedProp = guardMlbOnlyProp(prop);
  if (!scopedProp) {
    return {
      projectedValue: null,
      projectionSource: "missing",
      projectionReasoning: ["Non-MLB projection disabled in MLB-only mode."],
      edge: 0,
      bestPick: "",
      volatility: null,
    };
  }
  prop = scopedProp;
  const profile = context.profile || {};
  const injury = context.injury || null;
  const line = finiteNumber(prop.line);
  const sport = String(prop.sport || profile.sport || "");

  let result = { projectedValue: null, reasoning: [], volatility: profile.volatility ?? null };

  if (sport === "MLB") {
    result = projectMlbProp(prop, profile, injury, context);
  } else if (sport === "NBA" || sport === "WNBA") {
    result = projectBasketballProp(prop, profile, injury);
  } else if (isTennisSportLabel(sport) || sport === "Tennis") {
    result = projectTennisProp(prop, profile);
  } else {
    const genericBase = baseWeightedForm(profile);
    if (Number.isFinite(genericBase)) {
      result = {
        projectedValue: volatilityShrink(genericBase, profile.volatility, line),
        reasoning: [`Generic weighted form projection → ${round(genericBase)}.`],
        volatility: profile.volatility ?? null,
      };
    }
  }

  const projectedValue = finiteNumber(result.projectedValue);
  const edgeInfo = deriveEdge(projectedValue, line);
  const hasStats = Boolean(profile.hasGameLogs || profile.hasPlayerAverage || profile.manualEnriched);
  const projectionSource = projectedValue == null ? "missing" : hasStats ? "player-stats-model" : "player-stats-estimate";

  return {
    projectedValue,
    projection: projectedValue,
    projectionSource,
    bestPick: edgeInfo.bestPick,
    edge: edgeInfo.edge,
    edgePct: edgeInfo.edgePct,
    volatility: result.volatility ?? profile.volatility ?? null,
    volatilityAdjustment: 0,
    projectionReasoning: result.reasoning,
    modelInputs: {
      last5Average: profile.last5Average,
      last10Average: profile.last10Average,
      seasonAverage: profile.seasonAverage,
      opponentAllowed: profile.opponentAllowed,
      opponentRank: profile.opponentRank,
      sampleSize: profile.sampleSize,
    },
  };
}

export const PROJECTION_CONFIDENCE_THRESHOLDS = {
  RESEARCH: 58,
  PLAYABLE: 65,
  READY: 65,
  STRONG: 72,
  TOP_PICKS: 72,
  ELITE: 80,
};

function sideFromDiff(diff) {
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.05) return "";
  return diff > 0 ? "More" : "Less";
}

/**
 * Edge vs sportsbook sharp line; pick side vs DFS platform line.
 * edge = projectedValue - sportsbookLine (falls back to DFS line).
 */
export function resolveProjectionEdge(projectedValue, { dfsLine, sportsbookLine } = {}) {
  const proj = finiteNumber(projectedValue);
  const dfs = finiteNumber(dfsLine);
  const book = finiteNumber(sportsbookLine);
  const edgeLine = book ?? dfs;

  if (!Number.isFinite(proj) || !Number.isFinite(edgeLine)) {
    return { edge: 0, bestPick: "", rawEdge: 0, edgeLine: null, sportsbookEdge: null, dfsEdge: null };
  }

  const sportsbookEdge = Number.isFinite(book) ? proj - book : null;
  const dfsEdge = Number.isFinite(dfs) ? proj - dfs : null;
  const rawEdge = Number.isFinite(book) ? sportsbookEdge : dfsEdge;
  const pickDiff = Number.isFinite(dfs) ? dfsEdge : rawEdge;
  const bestPick = sideFromDiff(pickDiff);
  const edge = round(Math.abs(rawEdge));

  return {
    edge: edge > 0 ? edge : 0,
    bestPick,
    rawEdge: round(rawEdge),
    edgeLine: Number.isFinite(book) ? book : dfs,
    sportsbookEdge: sportsbookEdge == null ? null : round(sportsbookEdge),
    dfsEdge: dfsEdge == null ? null : round(dfsEdge),
  };
}

function factorScore(value, max, label, detail) {
  return {
    score: round(clamp(value, 0, max), 1),
    max,
    label,
    detail,
  };
}

function scoreRecentFormWeight(prop = {}) {
  const line = finiteNumber(prop.line);
  const last5 = finiteNumber(prop.last5Average);
  const last10 = finiteNumber(prop.last10Average ?? prop.seasonAverage);
  const l5Hit = finiteNumber(prop.last5HitRate);
  const l10Hit = finiteNumber(prop.last10HitRate ?? prop.recentHitRate);
  const sampleSize = finiteNumber(prop.sampleSize) || 0;
  let score = 0;
  const parts = [];

  if (Number.isFinite(l10Hit)) {
    score += clamp((l10Hit - 0.45) * 22, 0, 8);
    parts.push(`L10 hit ${Math.round(l10Hit * 100)}%`);
  } else if (Number.isFinite(l5Hit)) {
    score += clamp((l5Hit - 0.45) * 18, 0, 6);
    parts.push(`L5 hit ${Math.round(l5Hit * 100)}%`);
  }

  if (Number.isFinite(last5) && Number.isFinite(line) && line > 0) {
    score += clamp(((last5 - line) / line) * 16, -3, 8);
    parts.push(`L5 avg ${round(last5)} vs ${round(line)} line`);
  } else if (Number.isFinite(last10) && Number.isFinite(line) && line > 0) {
    score += clamp(((last10 - line) / line) * 10, -2, 5);
    parts.push(`L10 avg ${round(last10)}`);
  }

  if (sampleSize >= 10) score += 3;
  else if (sampleSize >= 5) score += 1.5;

  return factorScore(score, 12, "Recent Form", parts.length ? parts.join(" · ") : "Limited recent logs.");
}

function scoreMatchupDifficulty(prop = {}) {
  const line = finiteNumber(prop.line);
  const opponentAllowed = finiteNumber(prop.opponentAllowed);
  const opponentRank = finiteNumber(prop.opponentRank);
  const rating = String(prop.matchupRating || "Neutral");
  let score = 4;
  const parts = [];

  if (rating === "Favorable") {
    score += 6;
    parts.push("favorable matchup");
  } else if (rating === "Playable") {
    score += 3;
    parts.push("playable matchup");
  } else if (rating === "Tough") {
    score -= 3;
    parts.push("tough matchup");
  }

  if (Number.isFinite(opponentAllowed) && Number.isFinite(line) && line > 0) {
    score += clamp(((opponentAllowed - line) / line) * 8, -2, 5);
    parts.push(`opp allows ${round(opponentAllowed)}`);
  }
  if (Number.isFinite(opponentRank)) {
    if (opponentRank >= 22) {
      score += 2;
      parts.push(`weak defense #${Math.round(opponentRank)}`);
    } else if (opponentRank <= 8) {
      score -= 2;
      parts.push(`strong defense #${Math.round(opponentRank)}`);
    }
  }

  return factorScore(score, 10, "Matchup", parts.length ? parts.join(" · ") : "Neutral matchup.");
}

function scoreVarianceFactor(prop = {}) {
  const volatility = finiteNumber(prop.volatility);
  const sampleSize = finiteNumber(prop.sampleSize) || 0;
  let score = 4;
  let detail = "Variance unknown.";

  if (Number.isFinite(volatility)) {
    if (volatility <= 1.5) {
      score = 8;
      detail = `Low variance (${round(volatility)}).`;
    } else if (volatility <= 2.5) {
      score = 6;
      detail = `Moderate variance (${round(volatility)}).`;
    } else if (volatility <= 3.5) {
      score = 3;
      detail = `Elevated variance (${round(volatility)}).`;
    } else {
      score = 1;
      detail = `High variance (${round(volatility)}).`;
    }
  }
  if (sampleSize >= 10) score += 1;
  return factorScore(score, 8, "Variance", detail);
}

function scoreVolatilityFactor(prop = {}) {
  const volatility = finiteNumber(prop.volatility);
  let score = 4;
  if (!Number.isFinite(volatility)) return factorScore(score, 8, "Volatility", "Volatility unknown.");
  if (volatility <= 1.75) score = 8;
  else if (volatility <= 2.5) score = 6;
  else if (volatility <= 3.25) score = 4;
  else if (volatility <= 4) score = 2;
  else score = 1;
  return factorScore(score, 8, "Volatility", `Stat volatility ${round(volatility)}.`);
}

function scoreSportsbookSharpness(prop = {}) {
  const indicator = String(prop.sharpMoneyIndicator || "");
  const books = finiteNumber(prop.sportsbookComparison?.books) || 0;
  const discrepancy = finiteNumber(prop.sportsbookDiscrepancy);
  let score = 2;
  const parts = [];

  if (indicator === "Strong alignment") {
    score = 8;
    parts.push("strong alignment");
  } else if (indicator === "Sportsbook market supports value") {
    score = 6.5;
    parts.push("books support value");
  } else if (indicator === "Line moved toward model") {
    score = 5;
    parts.push("line moved toward model");
  } else if (indicator === "Market moved against model") {
    score = 1;
    parts.push("market moved against");
  }

  if (books >= 3) score += 1.5;
  else if (books >= 2) score += 0.75;
  if (Number.isFinite(discrepancy) && discrepancy >= 0.5) parts.push(`+${round(discrepancy)} book edge`);

  return factorScore(score, 10, "Sportsbook Sharpness", parts.length ? parts.join(" · ") : "No sharp signal.");
}

function scoreLineMovementFactor(prop = {}) {
  const movement = prop.lineMovement;
  let score = 3;
  let detail = "No line movement data.";

  if (movement?.supportsPick) {
    score = 7;
    detail = "Movement supports the pick.";
  } else if (movement?.againstPick) {
    score = 1;
    detail = "Market moved against the pick.";
  } else if (movement?.direction) {
    score = 4;
    detail = `Line ${movement.direction}.`;
  }

  return factorScore(score, 7, "Line Movement", detail);
}

function scoreImpliedOddsFactor(prop = {}) {
  const implied = finiteNumber(prop.impliedProbability);
  const modelProb = finiteNumber(prop.modelProbability);
  const probEdge = finiteNumber(prop.probabilityEdge);
  let score = 3;
  const parts = [];

  if (Number.isFinite(probEdge)) {
    score += clamp(probEdge * 40, -2, 5);
    parts.push(`prob edge ${round(probEdge * 100, 1)}%`);
  } else if (Number.isFinite(modelProb) && Number.isFinite(implied)) {
    score += clamp((modelProb - implied) * 35, -2, 4);
    parts.push(`model ${Math.round(modelProb * 100)}% vs implied ${Math.round(implied * 100)}%`);
  }

  return factorScore(score, 7, "Implied Odds", parts.length ? parts.join(" · ") : "No implied odds edge.");
}

function scoreHistoricalHitRateFactor(prop = {}) {
  const historical = finiteNumber(prop.historicalHitRate);
  const recent = finiteNumber(prop.recentHitRate ?? prop.last10HitRate);
  const sample = finiteNumber(prop.historicalSampleSize) || 0;
  let score = 0;
  const parts = [];

  if (Number.isFinite(historical)) {
    score += clamp((historical - 0.5) * 16, -2, 6);
    parts.push(`historical ${Math.round(historical * 100)}%`);
    if (sample >= 8) score += 1.5;
  }
  if (Number.isFinite(recent)) {
    score += clamp((recent - 0.5) * 10, -1, 4);
    parts.push(`recent ${Math.round(recent * 100)}%`);
  }

  return factorScore(score, 8, "Historical Hit Rate", parts.length ? parts.join(" · ") : "No hit-rate history.");
}

function computeMatchupModifier(prop = {}) {
  const rating = String(prop.matchupRating || "");
  if (rating === "Favorable") return 6;
  if (rating === "Playable") return 3;
  if (rating === "Tough") return -4;
  const rank = finiteNumber(prop.opponentRank);
  if (Number.isFinite(rank) && rank >= 22) return 3;
  if (Number.isFinite(rank) && rank <= 8) return -3;
  return 0;
}

function computeRecentTrendModifier(prop = {}) {
  const line = finiteNumber(prop.line);
  const last5 = finiteNumber(prop.last5Average);
  const last10 = finiteNumber(prop.last10Average);
  if (!Number.isFinite(line) || line <= 0) return 0;
  let mod = 0;
  if (Number.isFinite(last5)) mod += clamp(((last5 - line) / line) * 12, -4, 6);
  if (Number.isFinite(last10)) mod += clamp(((last10 - line) / line) * 6, -2, 3);
  const usageTrend = prop.usageTrend;
  if (usageTrend?.delta != null) mod += clamp(Number(usageTrend.delta) * 0.4, -3, 3);
  return round(mod);
}

function computeInjuryModifier(prop = {}) {
  const risk = String(prop.injuryRisk || prop.injury?.risk || "Low");
  if (risk === "High") return -8;
  if (risk === "Medium") return -4;
  if (risk === "Low" || prop.injuryClean) return 2;
  return 0;
}

function computeLineValueModifier(prop = {}) {
  const lineComparison = prop.lineComparison;
  const sportsbook = prop.sportsbookComparison;
  const discrepancy = finiteNumber(prop.sportsbookDiscrepancy);
  let mod = 0;
  if (lineComparison && Number.isFinite(lineComparison.difference)) {
    mod += clamp(lineComparison.difference * 2.5, 0, 5);
  }
  if (sportsbook && Number.isFinite(sportsbook.marketAverageLine) && Number.isFinite(prop.line)) {
    mod += clamp(Math.abs(Number(prop.line) - Number(sportsbook.marketAverageLine)) * 1.8, 0, 4);
  }
  if (Number.isFinite(discrepancy)) mod += clamp(discrepancy * 1.5, 0, 3);
  return round(mod);
}

function applyProjectionConfidenceCaps(score, prop = {}, options = {}) {
  let capped = score;
  let capReason = "";

  if (prop.marketResearchOnly || prop.marketSupportTier === 2 || prop.noveltyMarket) {
    capped = Math.min(capped, 55);
    capReason = "Research-only market tier.";
  }
  if (options.lineOnly) {
    capped = Math.min(capped, 68);
    capReason = capReason || "Line-only context limits ceiling.";
  }
  if (prop.fallbackProfile || prop.projectionSource === "missing") {
    capped = Math.min(capped, 62);
    capReason = capReason || "Sparse stat profile.";
  }
  if (!Number.isFinite(prop.edge) || Number(prop.edge) <= 0) {
    capped = Math.min(capped, 54);
    capReason = capReason || "No positive edge vs sportsbook line.";
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

/**
 * Delegates to decision engine (8-component confidence formula + historical learning).
 */
export { calculateProjectionConfidence } from "./decisionEngine.js";

export function computeProjectionRiskLevel({
  confidenceScore = 0,
  calibratedConfidence = null,
  volatility = null,
  injury = null,
  projectedValue = null,
  edge = 0,
  hasVerifiedStats = false,
  sampleSize = 0,
  lineMovement = null,
  lineMovementTrustScore: movementTrust = null,
  dataQualityScore = 0,
} = {}) {
  const vol = finiteNumber(volatility);
  const conf = Number(calibratedConfidence ?? confidenceScore) || 0;
  const injuryRisk = String(injury?.risk || "Low");
  const movementAgainst = Boolean(lineMovement?.againstPick);
  const trust = Number(movementTrust);

  if (injuryRisk === "High" || !Number.isFinite(projectedValue)) return "HIGH";
  if (movementAgainst && Number.isFinite(trust) && trust < 42) return "HIGH";
  if (sampleSize > 0 && sampleSize < 5 && dataQualityScore < 45) return "HIGH";
  if (conf >= 72 && Number(edge) >= 1 && (!Number.isFinite(vol) || vol <= 2.5) && hasVerifiedStats && !movementAgainst) return "LOW";
  if (conf >= 58 && Number(edge) > 0 && injuryRisk !== "High") {
    if (Number.isFinite(vol) && vol >= 3.5) return "HIGH";
    if (movementAgainst) return "MEDIUM";
    if (conf >= 68 && (!Number.isFinite(vol) || vol <= 3)) return "LOW";
    return "MEDIUM";
  }
  if (Number.isFinite(vol) && vol >= 4) return "HIGH";
  return "MEDIUM";
}

export function buildQualificationReason(prop = {}) {
  const parts = [];
  const projected = finiteNumber(prop.projectedValue ?? prop.projection);
  const edge = Number(prop.edge || 0);
  const conf = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const vol = finiteNumber(prop.volatility);

  if (Number.isFinite(projected)) parts.push(`Projects ${round(projected)}`);
  if (edge > 0 && prop.bestPick) parts.push(`${prop.bestPick} with ${round(edge)} edge vs books`);
  if (conf >= PROJECTION_CONFIDENCE_THRESHOLDS.TOP_PICKS) {
    parts.push(`${conf}% confidence (Top Pick tier)`);
  } else if (conf >= PROJECTION_CONFIDENCE_THRESHOLDS.READY) {
    parts.push(`${conf}% confidence (Ready tier)`);
  } else if (conf > 0) {
    parts.push(`${conf}% confidence`);
  }
  if (Number.isFinite(vol)) parts.push(`volatility ${round(vol)}`);
  if (prop.riskLevel) parts.push(`${prop.riskLevel} risk`);

  return parts.length ? parts.join(" · ") : "Awaiting projection signals.";
}
