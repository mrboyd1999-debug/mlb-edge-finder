import { canonicalMarketKey } from "../utils/marketNormalization.js";

export const MLB_PITCHER_MARKET_KEYS = ["strikeouts", "outs", "hitsAllowed", "earnedRuns"];

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

export function isMlbPitcherMarket(statType = "") {
  const key = canonicalMarketKey(statType);
  return MLB_PITCHER_MARKET_KEYS.includes(key);
}

export function isStrikeoutMarket(statType = "") {
  return canonicalMarketKey(statType) === "strikeouts";
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

export function pitchCountTrendFromValues(pitchValues = []) {
  if (pitchValues.length < 4) return null;
  const recent = average(pitchValues.slice(0, 3));
  const older = average(pitchValues.slice(3, 5));
  if (recent == null || older == null) return null;
  const delta = round(recent - older, 1);
  if (Math.abs(delta) < 2) return { recent, delta, label: "Stable pitch count" };
  return {
    recent,
    delta,
    label: delta > 0 ? `Pitch count up ${Math.abs(delta)}` : `Pitch count down ${Math.abs(delta)}`,
  };
}

export function handednessBoostFromNote(note = "") {
  const text = String(note || "");
  if (/favorable|platoon|left-on-left|right-on-right/i.test(text)) return 0.2;
  if (/tough|mismatch/i.test(text)) return -0.2;
  if (/LHP|LHB/i.test(text) && /leaned vs L/i.test(text)) return 0.1;
  if (/RHP|RHB/i.test(text) && /leaned vs R/i.test(text)) return 0.1;
  return 0;
}

export function homeAwaySplitFromStartRows(rows = [], marketKey = "") {
  const home = [];
  const away = [];
  rows.slice(0, 10).forEach((row) => {
    const isHome = row.isHome === true || row.home === true || String(row.game?.homeAway || "").toLowerCase() === "home";
    const value = statValueFromRow(row, marketKey);
    if (!Number.isFinite(value)) return;
    if (isHome) home.push(value);
    else away.push(value);
  });
  if (home.length < 2 || away.length < 2) return null;
  const homeAvg = average(home);
  const awayAvg = average(away);
  if (homeAvg == null || awayAvg == null) return null;
  const delta = round(homeAvg - awayAvg, 2);
  if (Math.abs(delta) < 0.15) return "Neutral home/away split";
  return delta > 0 ? `Home split stronger (+${Math.abs(delta)})` : `Away split stronger (+${Math.abs(delta)})`;
}

export function isProbableStarter(startRows = []) {
  const recentStarts = startRows.slice(0, 5).filter(isPitcherStartRow);
  return recentStarts.length >= 3;
}

export function isMlbVerifiedSource(profile = {}) {
  if (profile.sparse || profile.fallback) return false;
  const source = String(profile.source || "");
  const sources = (profile.statSources || []).map((item) => String(item)).join(" ");
  return /mlb|statsapi/i.test(source) || /mlb|statsapi/i.test(sources);
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
  const pitchCountTrend = profile.pitchCountTrend?.label
    ? profile.pitchCountTrend
    : pitchCountTrendFromValues(pitchValues);

  const opponent = context.opponentContext || profile.opponentContext || {};
  const handednessMatchup = profile.handednessMatchup || "";
  const handednessBoost = handednessBoostFromNote(handednessMatchup);
  const homeAwaySplit = profile.homeAwaySplit || homeAwaySplitFromStartRows(startRows, marketKey);
  const probableStarterConfirmed = profile.probableStarterConfirmed ?? isProbableStarter(startRows);
  const parkFactorNote = profile.parkFactorNote || "";
  const weatherNote = profile.weatherNote || context.weatherNote || "";

  const hasGameLogs = Boolean(
    profile.hasGameLogs || statValues.length >= 3 || (startRows.length >= 3 && isMlbVerifiedSource(profile))
  );
  const hasCoreRates = last5Average != null && seasonAverage != null;
  const hasOpponent = finiteNumber(opponent.strikeoutsPerGame) != null;
  const hasWorkload = projectedInnings != null && projectedPitchCount != null;
  const verifiedSource = isMlbVerifiedSource(profile);

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
    last5Starts: statValues.slice(0, 5),
    projectedInnings,
    projectedPitchCount,
    pitchCountTrend,
    sampleSize: finiteNumber(profile.sampleSize) ?? statValues.length,
    opponentContext: opponent,
    opponentStrikeoutRate: finiteNumber(opponent.strikeoutsPerGame),
    handednessMatchup,
    handednessBoost,
    homeAwaySplit,
    probableStarterConfirmed,
    parkFactorNote,
    weatherNote,
    hasGameLogs,
    hasCoreRates,
    hasOpponent,
    hasWorkload,
    verifiedSource,
    startRows,
    statValues,
    startCount: statValues.length,
  };
}

export function hasVerifiedPitcherGameLogs(data = {}) {
  return Boolean(data.hasGameLogs && data.hasCoreRates && (data.statValues?.length >= 3 || data.last5Average != null));
}

/** Strict verified check for Pitcher Strikeouts — requires MLB game logs. */
export function hasVerifiedStrikeoutGameLogs(data = {}, profile = {}) {
  return Boolean(
    data.verifiedSource &&
      data.hasGameLogs &&
      data.last5Average != null &&
      data.seasonAverage != null &&
      data.startCount >= 3 &&
      !profile.sparse &&
      !profile.fallback
  );
}

export function computeOpponentKAdjustment(data = {}) {
  const core = data.last5Average != null && data.seasonAverage != null
    ? data.last5Average * 0.54 + data.seasonAverage * 0.46
    : data.last5Average ?? data.seasonAverage;
  const oppK = finiteNumber(data.opponentContext?.strikeoutsPerGame ?? data.opponentStrikeoutRate);
  if (core == null || oppK == null) return { adjustment: null, oppRate: null };
  const leagueK = 8.4;
  const oppRate = round(core * (1 + ((oppK - leagueK) / leagueK) * 0.35), 2);
  return { adjustment: round(oppRate - core, 2), oppRate, core };
}
