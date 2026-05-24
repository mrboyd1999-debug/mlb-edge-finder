import { canonicalMarketKey } from "../utils/marketNormalization.js";

export const MLB_PITCHER_MARKET_KEYS = ["strikeouts", "outs", "hitsAllowed", "earnedRuns"];

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function average(values = []) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function isMlbPitcherMarket(statType = "") {
  const key = canonicalMarketKey(statType);
  return MLB_PITCHER_MARKET_KEYS.includes(key);
}

export function inningsFromStat(stat = {}) {
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

export function pitchesFromStat(stat = {}) {
  return finiteNumber(stat.numberOfPitches ?? stat.pitchesThrown ?? stat.pitchCount ?? stat.pitches);
}

export function isPitcherStartRow(row = {}) {
  const stat = row?.stat || row;
  if (finiteNumber(stat.gamesStarted) === 1) return true;
  const ip = inningsFromStat(stat);
  return ip != null && ip >= 3;
}

export function statValueFromRow(row = {}, marketKey = "") {
  const stat = row?.stat || row;
  if (marketKey === "strikeouts") return finiteNumber(stat.strikeOuts ?? stat.strikeouts);
  if (marketKey === "outs") {
    const ip = inningsFromStat(stat);
    return ip != null ? Math.round(ip * 3) : null;
  }
  if (marketKey === "hitsAllowed") return finiteNumber(stat.hits);
  if (marketKey === "earnedRuns") return finiteNumber(stat.earnedRuns);
  return null;
}

export function extractPitcherStartRows(profile = {}) {
  const rows = profile.gradingRows || profile.splits || [];
  const starts = rows.filter(isPitcherStartRow);
  return starts.length ? starts : rows.slice(0, 10);
}

export function valuesFromStartRows(rows = [], marketKey = "") {
  return rows.map((row) => statValueFromRow(row, marketKey)).filter(Number.isFinite);
}

export function buildMlbPitcherDataPackage(prop = {}, profile = {}, context = {}) {
  const marketKey = canonicalMarketKey(prop.statType);
  const startRows = extractPitcherStartRows(profile);
  const statValues = valuesFromStartRows(startRows, marketKey);
  const ipValues = startRows.map((row) => inningsFromStat(row?.stat || row)).filter(Number.isFinite);
  const pitchValues = startRows.map((row) => pitchesFromStat(row?.stat || row)).filter(Number.isFinite);

  const last5Average = finiteNumber(profile.last5Average) ?? average(statValues.slice(0, 5));
  const seasonAverage = finiteNumber(profile.seasonAverage) ?? average(statValues);
  const last10Average = finiteNumber(profile.last10Average) ?? average(statValues.slice(0, 10));

  const projectedInnings =
    average(ipValues.slice(0, 5)) ??
    (finiteNumber(profile.seasonInningsPitched) && finiteNumber(profile.sampleSize)
      ? profile.seasonInningsPitched / Math.max(1, profile.sampleSize)
      : null);

  const projectedPitchCount = average(pitchValues.slice(0, 5));

  const opponent = context.opponentContext || profile.opponentContext || {};
  const hasGameLogs = Boolean(profile.hasGameLogs || statValues.length >= 3 || startRows.length >= 3);
  const hasCoreRates = last5Average != null || seasonAverage != null;
  const hasOpponent = Boolean(
    finiteNumber(opponent.strikeoutsPerGame) ||
      finiteNumber(opponent.runsScoredPerGame) ||
      finiteNumber(opponent.hitsAllowedPerGame) ||
      finiteNumber(opponent.whip)
  );
  const hasWorkload = projectedInnings != null || projectedPitchCount != null;

  return {
    playerName: prop.playerName || profile.playerName || "",
    team: prop.team || profile.team || "",
    opponent: prop.opponent || profile.opponent || "",
    statType: prop.statType || profile.statType || "",
    marketKey,
    line: finiteNumber(prop.line),
    pickDirection: prop.side || prop.pick || prop.bestPick || "over",
    source: prop.source || prop.platform || "",
    last5Average,
    seasonAverage,
    last10Average,
    projectedInnings,
    projectedPitchCount,
    sampleSize: finiteNumber(profile.sampleSize) ?? statValues.length,
    opponentContext: opponent,
    handednessMatchup: profile.handednessMatchup || "",
    hasGameLogs,
    hasCoreRates,
    hasOpponent,
    hasWorkload,
    startRows,
    statValues,
  };
}

export function hasVerifiedPitcherGameLogs(data = {}) {
  return Boolean(data.hasGameLogs && data.hasCoreRates && (data.statValues?.length >= 3 || data.last5Average != null));
}
