/**
 * Factor-weighted MLB confidence — replaces flat edge→confidence mapping.
 * Primary inputs: MLB Stats API profile fields (SportsDataIO optional enrichment only).
 */

import { canonicalMarketKey } from "./marketNormalization.js";
import { isMlbPitcherMarket } from "../modules/mlbPitcherData.js";

export const MIN_MLB_CONFIDENCE = 45;
export const MAX_MLB_CONFIDENCE = 92;
export const GOBLIN_MIN_CONFIDENCE = 72;
export const DEMON_MIN_CONFIDENCE = 45;
export const DEMON_MAX_CONFIDENCE = 65;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function factorToScore(value, { floor, ceiling, target = null } = {}) {
  const num = finiteOr(value, NaN);
  if (!Number.isFinite(num)) return 52;
  if (Number.isFinite(target)) {
    const delta = Math.abs(num - target);
    return clamp(100 - delta * 18, 35, 95);
  }
  const span = ceiling - floor || 1;
  return clamp(((num - floor) / span) * 100, 35, 95);
}

function trendScore(recent, season) {
  const r = finiteOr(recent, NaN);
  const s = finiteOr(season, NaN);
  if (!Number.isFinite(r) || !Number.isFinite(s) || s <= 0) return 55;
  const ratio = r / s;
  if (ratio >= 1.12) return 88;
  if (ratio >= 1.04) return 78;
  if (ratio >= 0.96) return 65;
  if (ratio >= 0.88) return 52;
  return 42;
}

function lineValueScore(projection, line) {
  const proj = finiteOr(projection, NaN);
  const ln = finiteOr(line, NaN);
  if (!Number.isFinite(proj) || !Number.isFinite(ln) || ln <= 0) return 55;
  const gap = Math.abs(proj - ln);
  const pct = gap / ln;
  if (pct >= 0.22) return 90;
  if (pct >= 0.14) return 80;
  if (pct >= 0.08) return 68;
  if (pct >= 0.04) return 58;
  return 48;
}

function opponentKScore(opponentContext) {
  const ctx = opponentContext && typeof opponentContext === "object" ? opponentContext : {};
  const kpg = finiteOr(ctx.strikeoutsPerGame, NaN);
  if (!Number.isFinite(kpg)) return 55;
  return factorToScore(kpg, { floor: 7.2, ceiling: 10.2 });
}

function inningsScore(profile = {}) {
  const ip = finiteOr(profile.projectedInnings, NaN);
  if (!Number.isFinite(ip)) return 52;
  return factorToScore(ip, { floor: 4.2, ceiling: 6.8 });
}

function pitchTrendScore(profile = {}) {
  const trend = String(profile.pitchCountTrend?.label || profile.pitchCountTrend || "");
  if (/up|higher|increase/i.test(trend)) return 78;
  if (/stable|flat/i.test(trend)) return 66;
  if (/down|lower|decrease/i.test(trend)) return 52;
  return 58;
}

function splitScore(profile = {}) {
  const note = String(profile.homeAwaySplit || "");
  if (/stronger|\+/.test(note)) return 74;
  if (/neutral/i.test(note)) return 62;
  if (/away split|home split/i.test(note) && !/stronger/i.test(note)) return 56;
  return 60;
}

function weatherScore(profile = {}, context = {}) {
  const note = String(context.weatherNote || profile.weatherNote || "");
  if (!note) return 60;
  if (/wind out|hot|carry|offense/i.test(note)) return 68;
  if (/wind in|cold|dome|pitcher-friendly/i.test(note)) return 72;
  if (/rain|delay|uncertain/i.test(note)) return 48;
  return 62;
}

function vegasScore(profile = {}, context = {}) {
  const total = finiteOr(context.impliedGameTotal ?? profile.impliedGameTotal, NaN);
  if (!Number.isFinite(total)) return 58;
  return factorToScore(total, { floor: 7.0, ceiling: 10.5 });
}

function handednessScore(profile = {}) {
  const note = String(profile.handednessMatchup || "");
  if (/favorable|platoon|left-on-left|right-on-right/i.test(note)) return 78;
  if (/tough|mismatch/i.test(note)) return 48;
  return 62;
}

function battingOrderScore(profile = {}) {
  const note = String(profile.battingOrderNote || profile.battingOrder || "");
  if (/1|2|3|cleanup|heart/i.test(note)) return 82;
  if (/4|5|6|middle/i.test(note)) return 74;
  if (/7|8|9|bottom/i.test(note)) return 56;
  return 62;
}

function pitcherEraScore(profile = {}, context = {}) {
  const era = finiteOr(context.opponentStarterEra ?? profile.opponentPitcherEra, NaN);
  if (!Number.isFinite(era)) return 58;
  return clamp(100 - (era - 3.2) * 14, 40, 88);
}

function parkScore(profile = {}) {
  const note = String(profile.parkFactorNote || "");
  if (/hitter-friendly|offense|short/i.test(note)) return 72;
  if (/pitcher-friendly|suppressed/i.test(note)) return 55;
  return 62;
}

function sampleBoost(profile = {}) {
  const sample = Number(profile.sampleSize || 0);
  if (sample >= 10) return 6;
  if (sample >= 8) return 4;
  if (sample >= 5) return 2;
  if (sample >= 3) return 0;
  return -8;
}

function edgeBoost(edge) {
  const e = Math.abs(finiteOr(edge, 0));
  if (e >= 2.0) return 8;
  if (e >= 1.2) return 5;
  if (e >= 0.6) return 2;
  if (e < 0.15) return -10;
  return 0;
}

export function calculatePitcherStrikeoutConfidence(prop = {}, profile = {}, context = {}) {
  const line = finiteOr(prop.line, NaN);
  const projection = finiteOr(prop.projection ?? prop.projectedValue ?? profile.last5Average, NaN);
  const last5 = factorToScore(profile.last5Average, { floor: 2, ceiling: 10, target: line });
  const season = trendScore(profile.last5Average, profile.seasonAverage);
  const last5Weight = last5 * 0.22 + season * 0.08;
  const matchup = opponentKScore(profile.opponentContext || context.opponentContext || {});
  const innings = inningsScore(profile);
  const pitchTrend = pitchTrendScore(profile);
  const splits = splitScore(profile);
  const weather = weatherScore(profile, context);
  const vegas = vegasScore(profile, context);
  const lineValue = lineValueScore(projection, line);
  const recentTrend = trendScore(profile.last5Average, profile.seasonAverage);

  const raw =
    last5Weight * 0.3 +
    matchup * 0.25 +
    innings * 0.15 +
    pitchTrend * 0.1 +
    splits * 0.05 +
    weather * 0.05 +
    vegas * 0.1 +
    lineValue * 0.15 +
    recentTrend * 0.2;

  const score = clamp(
    Math.round(raw + sampleBoost(profile) + edgeBoost(prop.volatilityAdjustedEdge ?? prop.edge)),
    MIN_MLB_CONFIDENCE,
    MAX_MLB_CONFIDENCE
  );

  return {
    score,
    factors: {
      last5: Math.round(last5Weight),
      matchup: Math.round(matchup),
      innings: Math.round(innings),
      pitchTrend: Math.round(pitchTrend),
      lineValue: Math.round(lineValue),
      recentTrend: Math.round(recentTrend),
    },
  };
}

export function calculateHitterConfidence(prop = {}, profile = {}, context = {}) {
  const line = finiteOr(prop.line, NaN);
  const projection = finiteOr(prop.projection ?? prop.projectedValue ?? profile.last10Average ?? profile.last5Average, NaN);
  const last10 = factorToScore(profile.last10Average ?? profile.last5Average, { floor: 0.3, ceiling: 3.5, target: line });
  const last5 = trendScore(profile.last5Average, profile.seasonAverage);
  const order = battingOrderScore(profile);
  const handedness = handednessScore(profile);
  const pitcher = pitcherEraScore(profile, context);
  const park = parkScore(profile);
  const lineValue = lineValueScore(projection, line);
  const recentTrend = last5;

  const raw =
    last10 * 0.3 +
    order * 0.15 +
    handedness * 0.2 +
    pitcher * 0.15 +
    park * 0.1 +
    lineValue * 0.15 +
    recentTrend * 0.2;

  const score = clamp(
    Math.round(raw + sampleBoost(profile) + edgeBoost(prop.volatilityAdjustedEdge ?? prop.edge)),
    MIN_MLB_CONFIDENCE,
    MAX_MLB_CONFIDENCE
  );

  return {
    score,
    factors: {
      last10: Math.round(last10),
      battingOrder: Math.round(order),
      handedness: Math.round(handedness),
      opposingPitcher: Math.round(pitcher),
      lineValue: Math.round(lineValue),
      recentTrend: Math.round(recentTrend),
    },
  };
}

export function calculateWeightedMlbConfidence(prop = {}, profile = {}, context = {}) {
  const statType = prop.statType || profile.statType || "";
  const marketKey = canonicalMarketKey(statType);
  if (marketKey === "strikeouts" || isMlbPitcherMarket(statType)) {
    return calculatePitcherStrikeoutConfidence(prop, profile, context);
  }
  return calculateHitterConfidence(prop, profile, context);
}
