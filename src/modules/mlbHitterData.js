import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { isMlbVerifiedSource } from "./mlbPitcherData.js";

/** Phase 2 verified hitter markets. */
export const MLB_HITTER_PHASE2_MARKETS = ["fantasyScore", "hrr", "totalBases"];

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

function stdDev(values = []) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const mean = average(clean);
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length;
  return Math.sqrt(variance);
}

export function isMlbHitterPhase2Market(statType = "") {
  return MLB_HITTER_PHASE2_MARKETS.includes(canonicalMarketKey(statType));
}

function mlbFantasyScore(stat = {}) {
  const singles = finiteNumber(stat.hits) != null && finiteNumber(stat.doubles) != null
    ? Math.max(0, finiteNumber(stat.hits) - finiteNumber(stat.doubles) - (finiteNumber(stat.triples) || 0) - (finiteNumber(stat.homeRuns) || 0))
    : finiteNumber(stat.hits);
  const doubles = finiteNumber(stat.doubles) || 0;
  const triples = finiteNumber(stat.triples) || 0;
  const homeRuns = finiteNumber(stat.homeRuns) || 0;
  const rbi = finiteNumber(stat.rbi ?? stat.rbis) || 0;
  const runs = finiteNumber(stat.runs) || 0;
  const sb = finiteNumber(stat.stolenBases) || 0;
  const bb = finiteNumber(stat.baseOnBalls ?? stat.walks) || 0;
  const hbp = finiteNumber(stat.hitByPitch) || 0;
  return round(
    (singles || 0) * 3 +
      doubles * 5 +
      triples * 8 +
      homeRuns * 10 +
      rbi * 2 +
      runs * 2 +
      sb * 5 +
      bb * 2 +
      hbp * 2,
    2
  );
}

function statValueFromHitterRow(row = {}, marketKey = "") {
  const stat = row?.stat || row;
  if (marketKey === "fantasyScore") return mlbFantasyScore(stat);
  if (marketKey === "hrr") {
    const hits = finiteNumber(stat.hits);
    const runs = finiteNumber(stat.runs);
    const rbi = finiteNumber(stat.rbi ?? stat.rbis);
    if (hits == null && runs == null && rbi == null) return null;
    return round((hits || 0) + (runs || 0) + (rbi || 0), 2);
  }
  if (marketKey === "totalBases") return finiteNumber(stat.totalBases);
  return null;
}

export function extractHitterGameRows(profile = {}) {
  const rows = profile.gradingRows || profile.splits || [];
  return rows.slice(0, 15);
}

export function valuesFromHitterRows(rows = [], marketKey = "") {
  return rows.map((row) => statValueFromHitterRow(row, marketKey)).filter(Number.isFinite);
}

export function computeConsistencyScore(values = []) {
  const sigma = stdDev(values.slice(0, 10));
  if (sigma == null) return 0.5;
  if (sigma <= 0.35) return 0.92;
  if (sigma <= 0.65) return 0.78;
  if (sigma <= 1.0) return 0.62;
  return 0.45;
}

export function parkFactorAdjustment(note = "") {
  const text = String(note || "");
  if (/hitter-friendly|bandbox|coors|great american|fenway|offense|wind out/i.test(text)) return 0.12;
  if (/pitcher-friendly|marlins|oakland|petco|suppress|wind in/i.test(text)) return -0.1;
  return 0;
}

export function vegasAdjustment(impliedTotal) {
  const total = finiteNumber(impliedTotal);
  if (total == null) return 0;
  return round((total - 8.5) * 0.06, 2);
}

export function weatherAdjustment(note = "") {
  const text = String(note || "");
  if (/wind out|blowing out|hot|humid|carry/i.test(text)) return 0.08;
  if (/wind in|cold|dome|roof/i.test(text)) return -0.06;
  return 0;
}

export function handednessHitterAdjustment(note = "") {
  const text = String(note || "");
  if (/favorable|platoon|left-on-left|right-on-right/i.test(text)) return 0.1;
  if (/tough|mismatch/i.test(text)) return -0.1;
  return 0;
}

export function battingOrderAdjustment(note = "") {
  const text = String(note || "");
  if (/leadoff|top.?3|cleanup|heart/i.test(text)) return 0.1;
  if (/bottom|bench|spot/i.test(text)) return -0.08;
  return 0;
}

export function opponentPitcherAdjustment(whip) {
  const numeric = finiteNumber(whip);
  if (numeric == null) return 0;
  return round((1.35 - numeric) * 0.15, 2);
}

export function isoPowerAdjustment(iso, marketKey = "") {
  if (!["totalBases", "hrr", "fantasyScore"].includes(marketKey)) return 0;
  const numeric = finiteNumber(iso);
  if (numeric == null) return 0;
  return round((numeric - 0.17) * 0.3, 2);
}

export function buildMlbHitterDataPackage(prop = {}, profile = {}, context = {}) {
  const marketKey = canonicalMarketKey(prop.statType);
  const gameRows = extractHitterGameRows(profile);
  const statValues = valuesFromHitterRows(gameRows, marketKey);

  const last5Average = finiteNumber(profile.last5Average) ?? average(statValues.slice(0, 5));
  const last10Average = finiteNumber(profile.last10Average) ?? average(statValues.slice(0, 10));
  const seasonAverage = finiteNumber(profile.seasonAverage) ?? average(statValues);

  const opponent = context.opponentContext || profile.opponentContext || {};
  const whip = finiteNumber(profile.opponentPitcherWhip) ?? finiteNumber(opponent.whip);
  const impliedGameTotal =
    finiteNumber(context.impliedGameTotal) ??
    finiteNumber(profile.impliedGameTotal) ??
    finiteNumber(profile.impliedTeamTotal);

  const verifiedSource = isMlbVerifiedSource(profile);
  const hasGameLogs = Boolean(profile.hasGameLogs || statValues.length >= 5 || (gameRows.length >= 5 && verifiedSource));
  const hasCoreRates = last5Average != null && seasonAverage != null;

  return {
    playerName: prop.playerName || profile.playerName || "",
    team: prop.team || profile.team || "",
    opponent: prop.opponent || profile.opponent || "",
    statType: prop.statType || "",
    marketKey,
    line: finiteNumber(prop.line),
    last5Average,
    last10Average,
    seasonAverage,
    statValues,
    gameCount: statValues.length,
    sampleSize: finiteNumber(profile.sampleSize) ?? statValues.length,
    consistencyScore: computeConsistencyScore(statValues),
    opponentContext: opponent,
    opponentPitcherWhip: whip,
    impliedGameTotal,
    weatherNote: profile.weatherNote || context.weatherNote || "",
    parkFactorNote: profile.parkFactorNote || "",
    handednessMatchup: profile.handednessMatchup || "",
    battingOrderNote: profile.battingOrderNote || "",
    opponentStarterNote: profile.opponentStarterNote || context.opponentStarterNote || opponent.opponentStarterNote || null,
    isolatedPower: finiteNumber(profile.isolatedPower),
    hardHitProxy: finiteNumber(profile.barrelRateEstimate),
    strikeoutRateProxy: finiteNumber(profile.recentStrikeoutRate),
    lineMovementNote: profile.lineMovementNote || context.lineMovementNote || "",
    hasGameLogs,
    hasCoreRates,
    hasOpponent: whip != null || finiteNumber(profile.opponentAllowed) != null,
    verifiedSource,
  };
}

export function hasVerifiedHitterGameLogs(data = {}, profile = {}) {
  const gameCount = Number(data.gameCount || data.statValues?.length || 0);
  return Boolean(
    data.verifiedSource &&
      data.hasGameLogs &&
      data.last5Average != null &&
      data.seasonAverage != null &&
      gameCount >= 3 &&
      !profile.sparse &&
      !profile.fallback
  );
}

export function hasMlbHitterStatInputs(profile = {}) {
  return Boolean(
    finiteNumber(profile.last5Average) ||
      finiteNumber(profile.last10Average) ||
      finiteNumber(profile.seasonAverage) ||
      (profile.gradingRows || profile.splits || []).length >= 5
  );
}
