/**
 * Generated projection engine — used when SportsDataIO / MLB Stats are unavailable.
 */

import { canonicalMarketKey } from "./marketNormalization.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveMarket(prop = {}) {
  return canonicalMarketKey(prop.statType || prop.market || prop.propType || "") || "";
}

function isPitcherMarket(prop = {}) {
  const key = resolveMarket(prop);
  const raw = String(prop.statType || prop.market || prop.propType || "").toLowerCase();
  return /strikeout|earnedrun|hitsallowed|walksallowed|pitcher|outs|pitching/i.test(`${key}|${raw}`);
}

function resolveRecentAverage(prop = {}, profile = {}) {
  return finite(
    prop.last5Average ??
      prop.recentAverage ??
      profile?.last5Average ??
      prop.last10Average ??
      profile?.last10Average
  );
}

function resolveSeasonAverage(prop = {}, profile = {}) {
  return finite(prop.seasonAverage ?? profile?.seasonAverage ?? prop.seasonRate);
}

function resolveMatchupAdjustment(prop = {}, line = 1) {
  const score = finite(prop.matchupScore ?? prop.formConfidenceScore ?? prop.matchupAudit?.matchupScore);
  if (score == null) return 0;
  return ((score - 50) / 50) * line * 0.08;
}

function resolveParkAdjustment(prop = {}, line = 1) {
  const total = finite(prop.impliedGameTotal ?? prop.gameTotal ?? prop.overUnder);
  if (total == null) return 0;
  return ((total - 8.5) / 8.5) * line * 0.05;
}

function resolveOpponentAdjustment(prop = {}, line = 1, pitcher = false) {
  const rank = finite(prop.opponentRank ?? prop.opponentContext?.rank);
  if (rank == null) return 0;
  const factor = (30 - clamp(rank, 1, 30)) / 30;
  return (pitcher ? factor : -factor) * line * 0.06;
}

/** Hitter: recent average + matchup + park + opponent adjustments. */
export function generateHitterProjection(prop = {}, profile = {}) {
  const line = finite(prop.line) ?? 1;
  const recent = resolveRecentAverage(prop, profile);
  const season = resolveSeasonAverage(prop, profile);
  const base = recent ?? season ?? line;
  if (base == null) return null;

  const projection =
    base +
    resolveMatchupAdjustment(prop, line) +
    resolveParkAdjustment(prop, line) +
    resolveOpponentAdjustment(prop, line, false);

  return round2(clamp(projection, 0.01, Math.max(line * 2.5, base * 1.8)));
}

/** Pitcher: season average + opponent strikeout rate + innings expectation. */
export function generatePitcherProjection(prop = {}, profile = {}) {
  const line = finite(prop.line) ?? 1;
  const season = resolveSeasonAverage(prop, profile) ?? resolveRecentAverage(prop, profile) ?? line;
  const oppK = finite(
    prop.opponentStrikeoutRate ??
      prop.opponentContext?.strikeoutsPerGame ??
      prop.opponentKRate
  );
  const oppAdj = oppK != null ? (oppK - 8.4) * 0.18 : 0;

  const expectedInnings =
    finite(prop.expectedInnings ?? profile?.expectedInnings) ??
    finite(profile?.seasonInningsPitched) ??
    finite(prop.last10Average);
  const inningsAdj = expectedInnings != null ? (expectedInnings - 5.5) * 0.35 : 0;

  const market = resolveMarket(prop);
  let projection = season + oppAdj + inningsAdj;
  if (/earnedrun|hitsallowed|walksallowed|walks/.test(market) && projection > line) {
    projection = line - Math.abs(projection - line) * 0.35;
  }

  return round2(clamp(projection, 0.01, Math.max(line * 2.2, season * 1.7)));
}

export function generateProjectionForProp(prop = {}, profile = null) {
  const line = finite(prop.line);
  if (line == null || line <= 0) return null;

  let projection = isPitcherMarket(prop)
    ? generatePitcherProjection(prop, profile || {})
    : generateHitterProjection(prop, profile || {});

  if (projection == null) {
    projection = round2(line * (isPitcherMarket(prop) ? 1.02 : 1.08));
  }

  if (projection == null || projection <= 0) return null;

  return {
    projection,
    projectedValue: projection,
    projectionSource: "generated",
    projectionStatus: "generated",
    isFallbackProjection: false,
    isGeneratedProjection: true,
    projectionMerged: true,
  };
}
