import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { formatNumber } from "../utils/formatters.js";
import {
  isMlbPitcherMarket,
  projectMlbPitcherProp,
  hasMlbPitcherStatInputs,
} from "../modules/mlbProjectionEngine.js";

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

function average(values = []) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function inningsFromStat(stat = {}) {
  const direct = finiteNumber(stat.inningsPitchedDecimal ?? stat.innings);
  if (direct != null) return direct;
  const text = String(stat.inningsPitched || "");
  if (!text) return null;
  const [whole, partial = "0"] = text.split(".");
  const wholeOuts = Number(whole);
  const partialOuts = Number(partial);
  if (!Number.isFinite(wholeOuts)) return null;
  return wholeOuts + (Number.isFinite(partialOuts) ? partialOuts / 3 : 0);
}

function pitchesFromStat(stat = {}) {
  return finiteNumber(stat.numberOfPitches ?? stat.pitchesThrown ?? stat.pitchCount ?? stat.pitches);
}

function valuesFromGradingRows(rows = [], picker) {
  return (rows || []).map(picker).filter(Number.isFinite);
}

export function hasRealStatInputs(profile = {}) {
  return Boolean(
    finiteNumber(profile.last5Average) ||
      finiteNumber(profile.last10Average) ||
      finiteNumber(profile.seasonAverage) ||
      finiteNumber(profile.recentStrikeoutAverage) ||
      finiteNumber(profile.projection)
  );
}

function buildBreakdownRow(label, value, weight, contribution, display) {
  return {
    label,
    value,
    weight,
    contribution: round(contribution, 2),
    display: display ?? (Number.isFinite(Number(value)) ? formatNumber(value) : String(value ?? "")),
  };
}

function computeWeightedCore(parts = []) {
  const clean = parts.filter((part) => finiteNumber(part.value) != null && part.weight > 0);
  if (!clean.length) return { rate: null, contributions: [] };
  const weightSum = clean.reduce((sum, part) => sum + part.weight, 0);
  const rate = clean.reduce((sum, part) => sum + finiteNumber(part.value) * part.weight, 0) / weightSum;
  const contributions = clean.map((part) => ({
    label: part.label,
    value: finiteNumber(part.value),
    weight: part.weight,
    contribution: round((finiteNumber(part.value) * part.weight) / weightSum, 2),
  }));
  return { rate: round(rate, 2), contributions };
}

function finalizeProjection(projection, breakdown, { hasRealData, sport, marketKey }) {
  if (!Number.isFinite(projection) || projection <= 0) {
    return {
      projectedValue: null,
      projectionBreakdown: breakdown,
      projectionSource: "missing",
      projectionLabel: "Estimated fallback projection",
      isFallbackProjection: true,
      reasoning: ["Insufficient verified stat inputs for a model projection."],
    };
  }

  return {
    projectedValue: round(projection, 1),
    projectionBreakdown: breakdown,
    projectionSource: hasRealData ? "player-stats-model" : "player-stats-estimate",
    projectionLabel: hasRealData ? "Stat-based projection" : "Estimated fallback projection",
    isFallbackProjection: !hasRealData,
    reasoning: breakdown.map((row) => `${row.label}: ${row.display}${row.weight ? ` (${Math.round(row.weight * 100)}%)` : ""}`),
  };
}

export function projectMlbPitcherStrikeouts(prop = {}, profile = {}, context = {}) {
  const breakdown = [];
  const last5 = finiteNumber(profile.last5Average) ?? finiteNumber(profile.recentStrikeoutAverage);
  const season = finiteNumber(profile.seasonAverage);
  const rows = profile.gradingRows || profile.splits || [];
  const kValues = valuesFromGradingRows(rows, (row) => finiteNumber(row?.stat?.strikeOuts ?? row?.stat?.strikeouts));
  const ipValues = valuesFromGradingRows(rows, (row) => inningsFromStat(row?.stat || row));
  const pitchValues = valuesFromGradingRows(rows, (row) => pitchesFromStat(row?.stat || row));

  const last5Starts = average(kValues.slice(0, 5)) ?? last5;
  const seasonRate = season ?? average(kValues);
  const projectedIP = average(ipValues.slice(0, 5)) ?? (finiteNumber(profile.seasonInningsPitched) && finiteNumber(profile.sampleSize)
    ? profile.seasonInningsPitched / Math.max(1, profile.sampleSize)
    : null);
  const projectedPitches = average(pitchValues.slice(0, 5));

  const opponent = context.opponentContext || {};
  const oppKPerGame = finiteNumber(opponent.strikeoutsPerGame);
  const leagueKPerGame = 8.4;
  const kPerInning = seasonRate && projectedIP ? seasonRate / Math.max(projectedIP, 3.5) : seasonRate ? seasonRate / 5.5 : null;

  let projection = 0;
  let usedReal = false;

  const core = computeWeightedCore([
    { value: last5Starts, weight: 0.35, label: "Last 5 Avg" },
    { value: seasonRate, weight: 0.3, label: "Season Avg" },
  ]);
  if (core.rate == null) {
    breakdown.push(buildBreakdownRow("Projected Ks", null, null, null, "Unavailable"));
    return finalizeProjection(null, breakdown, { hasRealData: false, sport: "MLB", marketKey: "strikeouts" });
  }

  projection = core.rate;
  core.contributions.forEach((row) => {
    breakdown.push(buildBreakdownRow(row.label, row.value, row.weight, row.contribution));
    usedReal = true;
  });

  let oppBoost = null;
  if (oppKPerGame != null) {
    const baseline = core.rate;
    oppBoost = round(((oppKPerGame - leagueKPerGame) / leagueKPerGame) * baseline * 0.15, 2);
    breakdown.push(buildBreakdownRow("Opponent K Boost", oppBoost, 0.15, oppBoost, `${oppBoost >= 0 ? "+" : ""}${formatNumber(oppBoost)}`));
    projection += oppBoost;
    usedReal = true;
  }

  if (projectedPitches != null) {
    const baselinePitches = 92;
    const pitchAdj = round((projectedPitches / baselinePitches - 1) * core.rate * 0.1, 2);
    breakdown.push(buildBreakdownRow("Pitch Count Factor", projectedPitches, 0.1, pitchAdj, `${formatNumber(projectedPitches)} pitches`));
    projection += pitchAdj;
    usedReal = true;
  }

  if (projectedIP != null) {
    const baselineIP = 5.5;
    const inningsAdj = round((projectedIP / baselineIP - 1) * core.rate * 0.1, 2);
    breakdown.push(buildBreakdownRow("Innings Factor", projectedIP, 0.1, inningsAdj, `${formatNumber(projectedIP)} IP`));
    projection += inningsAdj;
    usedReal = true;
  }

  const vegasTotal = finiteNumber(context.impliedGameTotal ?? profile.impliedGameTotal ?? profile.impliedTeamTotal);
  if (vegasTotal != null && (seasonRate != null || last5Starts != null)) {
    const vegasAdj = round((vegasTotal - 8.5) * 0.08, 2);
    breakdown.push(buildBreakdownRow("Vegas Environment", vegasTotal, null, vegasAdj, `Total ${formatNumber(vegasTotal)}`));
    projection += vegasAdj;
  }

  if (profile.handednessMatchup) {
    const handAdj = /favorable|platoon|left-on-left|right-on-right/i.test(String(profile.handednessMatchup)) ? 0.25
      : /tough|mismatch/i.test(String(profile.handednessMatchup)) ? -0.25
        : 0;
    if (handAdj !== 0) {
      breakdown.push(buildBreakdownRow("Handedness Matchup", profile.handednessMatchup, null, handAdj, profile.handednessMatchup));
      projection += handAdj;
    }
  }

  breakdown.push(buildBreakdownRow("Projected Ks", round(projection, 1), null, projection));

  return finalizeProjection(projection, breakdown, {
    hasRealData: usedReal,
    sport: "MLB",
    marketKey: "strikeouts",
  });
}

export function projectMlbHitterProp(prop = {}, profile = {}, context = {}) {
  const key = canonicalMarketKey(prop.statType);
  const breakdown = [];
  const last5 = finiteNumber(profile.last5Average);
  const season = finiteNumber(profile.seasonAverage);
  const line = finiteNumber(prop.line);

  let projection = 0;
  let usedReal = false;

  const core = computeWeightedCore([
    { value: last5, weight: 0.4, label: "Recent Form (L5)" },
    { value: season, weight: 0.25, label: "Season Avg" },
  ]);
  if (core.rate == null) {
    breakdown.push(buildBreakdownRow("Projected Output", null, null, null, "Unavailable"));
    return finalizeProjection(null, breakdown, { hasRealData: false, sport: "MLB", marketKey: key });
  }

  projection = core.rate;
  core.contributions.forEach((row) => {
    breakdown.push(buildBreakdownRow(row.label, row.value, row.weight, row.contribution));
    usedReal = true;
  });

  if (profile.battingOrderNote) {
    const orderBoost = /top|leadoff|cleanup|heart/i.test(String(profile.battingOrderNote)) ? 0.12 : -0.05;
    breakdown.push(buildBreakdownRow("Batting Order", profile.battingOrderNote, 0.1, orderBoost, profile.battingOrderNote));
    projection += orderBoost;
    usedReal = true;
  }

  if (profile.handednessMatchup) {
    const handBoost = /favorable|platoon/i.test(String(profile.handednessMatchup)) ? 0.1 : /tough|mismatch/i.test(String(profile.handednessMatchup)) ? -0.1 : 0;
    if (handBoost !== 0) {
      breakdown.push(buildBreakdownRow("Handedness Split", profile.handednessMatchup, 0.1, handBoost, profile.handednessMatchup));
      projection += handBoost;
      usedReal = true;
    }
  }

  const opponent = context.opponentContext || {};
  if (finiteNumber(opponent.whip) != null || finiteNumber(profile.opponentPitcherWhip) != null) {
    const whip = finiteNumber(profile.opponentPitcherWhip) ?? finiteNumber(opponent.whip);
    const pitcherAdj = round((1.35 - whip) * 0.18, 2);
    breakdown.push(buildBreakdownRow("Opposing Pitcher", whip, 0.1, pitcherAdj, `WHIP ${formatNumber(whip)}`));
    projection += pitcherAdj;
    usedReal = true;
  } else if (finiteNumber(profile.opponentAllowed) != null && line != null) {
    const oppAdj = round(((profile.opponentAllowed - line) / Math.max(line, 0.5)) * 0.12, 2);
    breakdown.push(buildBreakdownRow("Opponent Allowed", profile.opponentAllowed, 0.1, oppAdj, formatNumber(profile.opponentAllowed)));
    projection += oppAdj;
    usedReal = true;
  }

  if (profile.parkFactorNote) {
    const parkAdj = /hitter-friendly|bandbox|coors|great american|fenway/i.test(String(profile.parkFactorNote)) ? 0.08
      : /pitcher-friendly|marlins|oakland|petco/i.test(String(profile.parkFactorNote)) ? -0.08
        : 0;
    if (parkAdj !== 0) {
      breakdown.push(buildBreakdownRow("Park Factor", profile.parkFactorNote, 0.05, parkAdj, profile.parkFactorNote));
      projection += parkAdj;
    }
  }

  if (finiteNumber(profile.isolatedPower) != null && ["homeRuns", "totalBases", "hrr"].includes(key)) {
    const isoAdj = round((profile.isolatedPower - 0.17) * 0.35, 2);
    breakdown.push(buildBreakdownRow("ISO Power", profile.isolatedPower, null, isoAdj, formatNumber(profile.isolatedPower)));
    projection += isoAdj;
  }

  breakdown.push(buildBreakdownRow("Projected Output", round(projection, 2), null, projection));

  return finalizeProjection(projection, breakdown, {
    hasRealData: usedReal,
    sport: "MLB",
    marketKey: key,
  });
}

export function projectNbaProp(prop = {}, profile = {}, context = {}) {
  const breakdown = [];
  const last5 = finiteNumber(profile.last5Average);
  const season = finiteNumber(profile.seasonAverage);
  const perMinute = last5 != null && finiteNumber(profile.avgMinutes)
    ? last5 / Math.max(profile.avgMinutes, 1)
    : season != null && finiteNumber(profile.avgMinutes)
      ? season / Math.max(profile.avgMinutes, 1)
      : null;

  let projection = 0;
  let usedReal = false;

  const projectedMinutes = finiteNumber(parseMinutes(profile.projectedMinutes)) ?? finiteNumber(profile.avgMinutes);
  const minutesRate = perMinute != null && projectedMinutes != null ? round(perMinute * projectedMinutes, 2) : null;
  const core = computeWeightedCore([
    { value: minutesRate, weight: 0.35, label: "Minutes Projection" },
    { value: last5, weight: 0.35, label: "Last 5 Avg" },
    { value: season, weight: 0.1, label: "Season Avg" },
  ]);

  if (core.rate == null) {
    breakdown.push(buildBreakdownRow("Projected Output", null, null, null, "Unavailable"));
    return finalizeProjection(null, breakdown, { hasRealData: false, sport: prop.sport || "NBA", marketKey: canonicalMarketKey(prop.statType) });
  }

  projection = core.rate;
  core.contributions.forEach((row) => {
    const display = row.label === "Minutes Projection" && projectedMinutes != null
      ? `${formatNumber(projectedMinutes)} min`
      : undefined;
    breakdown.push(buildBreakdownRow(row.label, row.value, row.weight, row.contribution, display));
    usedReal = true;
  });

  if (profile.usageTrend?.delta != null) {
    const usageAdj = round(Number(profile.usageTrend.delta) * 0.04, 2);
    breakdown.push(buildBreakdownRow("Usage Rate", profile.usageTrend.label || profile.usageTrend.delta, 0.2, usageAdj));
    projection += usageAdj;
    usedReal = true;
  }

  const pace = finiteNumber(profile.pace) ?? (finiteNumber(profile.opponentRank) ? 102 - Number(profile.opponentRank) * 0.8 : null);
  if (pace != null) {
    const paceAdj = round((pace - 98) * 0.015, 2);
    breakdown.push(buildBreakdownRow("Pace", pace, null, paceAdj, `${formatNumber(pace)} pace`));
    projection += paceAdj;
  }

  if (finiteNumber(profile.opponentRank) != null) {
    const defAdj = round((30 - Number(profile.opponentRank)) * 0.015, 2);
    breakdown.push(buildBreakdownRow("Matchup Defense", profile.opponentRank, 0.1, defAdj, `#${profile.opponentRank} defense`));
    projection += defAdj;
    usedReal = true;
  }

  const injury = context.injury;
  if (injury?.risk === "High") {
    breakdown.push(buildBreakdownRow("Injury Impact", "High", null, -0.35, "High injury risk"));
    projection -= 0.35;
  } else if (injury?.risk === "Medium") {
    breakdown.push(buildBreakdownRow("Injury Impact", "Medium", null, -0.15, "Medium injury risk"));
    projection -= 0.15;
  }

  breakdown.push(buildBreakdownRow("Projected Output", round(projection, 1), null, projection));

  return finalizeProjection(projection, breakdown, {
    hasRealData: usedReal,
    sport: prop.sport || "NBA",
    marketKey: canonicalMarketKey(prop.statType),
  });
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

export function buildRealProjection(prop = {}, profile = {}, context = {}) {
  const sport = String(prop.sport || profile.sport || "MLB").toUpperCase();
  const key = canonicalMarketKey(prop.statType);

  if (sport === "MLB" && isMlbPitcherMarket(prop.statType) && hasMlbPitcherStatInputs(profile)) {
    const pitcher = projectMlbPitcherProp(prop, profile, context);
    if (pitcher) return pitcher;
  }

  if (sport === "MLB" && (key === "strikeouts" || key === "outs" || key === "pitchesThrown")) {
    return projectMlbPitcherStrikeouts(prop, profile, context);
  }
  if (sport === "MLB") {
    return projectMlbHitterProp(prop, profile, context);
  }
  if (sport === "NBA" || sport === "WNBA") {
    return projectNbaProp(prop, profile, context);
  }

  const last5 = finiteNumber(profile.last5Average);
  const season = finiteNumber(profile.seasonAverage);
  if (last5 == null && season == null) {
    return finalizeProjection(null, [], { hasRealData: false, sport, marketKey: key });
  }

  const breakdown = [];
  const core = computeWeightedCore([
    { value: finiteNumber(profile.last5Average), weight: 0.55, label: "Last 5 Avg" },
    { value: finiteNumber(profile.seasonAverage), weight: 0.45, label: "Season Avg" },
  ]);
  if (core.rate == null) {
    return finalizeProjection(null, [], { hasRealData: false, sport, marketKey: key });
  }

  let projection = core.rate;
  core.contributions.forEach((row) => breakdown.push(buildBreakdownRow(row.label, row.value, row.weight, row.contribution)));
  breakdown.push(buildBreakdownRow("Projected Output", round(projection, 2), null, projection));
  return finalizeProjection(projection, breakdown, { hasRealData: true, sport, marketKey: key });
}

export function formatProjectionBreakdownSummary(breakdown = []) {
  return (breakdown || [])
    .filter((row) => row.label !== "Projected Output" && row.label !== "Projected Ks")
    .slice(0, 6)
    .map((row) => `${row.label}: ${row.display ?? row.value}`)
    .join(" · ");
}
