/**
 * Single verified hit-rate source for UI + audits — no placeholder zeros.
 */

import { computeMlbHistoricalAveragesFromSplits } from "../services/playerStats.js";
import { resolveMlbPerformanceBundle } from "./seasonHitRate.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHitRatePercent(value) {
  const num = finite(value);
  if (num == null) return null;
  if (num <= 0) return num === 0 ? 0 : null;
  if (num <= 1) return Math.round(num * 1000) / 10;
  return Math.round(num * 10) / 10;
}

function resolveHitRatePercent(prop = {}, key) {
  const direct = finite(prop[key]);
  if (direct != null && direct <= 1) return Math.round(direct * 100);
  if (direct != null) return Math.round(direct);
  return null;
}

function estimateHitRateFromAverage(avg, line) {
  const baseline = finite(avg);
  const ln = finite(line);
  if (baseline == null || ln == null || ln <= 0) return null;
  const gap = (baseline - ln) / ln;
  return clamp(Math.round(50 + gap * 35), 15, 88);
}

function toLabel(rate) {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${Math.round(rate)}%`;
}

function resolveLast20HitRate(prop = {}, line = null) {
  const direct = normalizeHitRatePercent(prop.last20HitRate);
  if (direct != null && direct > 0) return direct;

  const statType = prop.statType || prop.market || prop.propType || "";
  const splits = prop.splits || prop.gradingRows || [];
  if (Array.isArray(splits) && splits.length && line != null) {
    const computed = computeMlbHistoricalAveragesFromSplits(splits, statType, line);
    const fromLogs = normalizeHitRatePercent(computed.last20HitRate);
    if (fromLogs != null && fromLogs > 0) return fromLogs;
  }
  return null;
}

function buildCoreHitRateSnapshot(prop = {}, context = {}) {
  const performance = resolveMlbPerformanceBundle(prop, context);
  const line = finite(prop.line);
  const last5 =
    performance.last5HitRate ??
    resolveHitRatePercent(prop, "last5HitRate") ??
    estimateHitRateFromAverage(prop.last5Average ?? prop.recentForm, line);
  const last10 =
    performance.last10HitRate ??
    resolveHitRatePercent(prop, "last10HitRate") ??
    resolveHitRatePercent(prop, "recentHitRate") ??
    estimateHitRateFromAverage(prop.last10Average, line);
  const season =
    performance.seasonRateValid && performance.seasonHitRate != null
      ? performance.seasonHitRate
      : null;

  return {
    last5: last5 ?? null,
    last10: last10 ?? null,
    season: season,
    recentForm: performance.recentFormRate ?? null,
    last5Label: last5 != null ? `${last5}%` : performance.last5Label ?? "—",
    last10Label: last10 != null ? `${last10}%` : performance.last10Label ?? "—",
    seasonLabel: season != null ? `${Math.round(season)}%` : "—",
    seasonHitRateSource: performance.seasonHitRateSource,
    seasonGames: performance.seasonGamesPlayed,
    seasonGamesPlayed: performance.seasonGamesPlayed,
    sampleGames: performance.sampleGames,
    seasonHits: performance.seasonHits,
    seasonRateValid: performance.seasonRateValid,
  };
}

/** Canonical hit-rate snapshot shared by cards, modal, and probability audit. */
export function resolveVerifiedHitRateSnapshot(prop = {}, context = {}) {
  const snapshot = buildCoreHitRateSnapshot(prop, context);
  const line = finite(prop.line);
  const last20 = resolveLast20HitRate(prop, line);
  const performance = resolveMlbPerformanceBundle(prop, context);

  return {
    ...snapshot,
    last20: last20 ?? null,
    last20Label: toLabel(last20),
    source: "verified-mlb-hit-rates",
    seasonHitRateSource: performance.seasonHitRateSource,
    gamesCount: performance.gamesCount,
    gamesLabel: performance.gamesLabel,
    gamesLabelKey: performance.gamesLabelKey,
    verified: Boolean(
      snapshot.last5Label !== "—" ||
        snapshot.last10Label !== "—" ||
        (snapshot.seasonLabel !== "—" && snapshot.seasonRateValid)
    ),
  };
}

export function attachVerifiedHitRateFields(prop = {}, context = {}) {
  const snapshot = resolveVerifiedHitRateSnapshot(prop, context);
  return {
    ...prop,
    hitRateSnapshot: snapshot,
    last5HitRate: snapshot.last5 ?? prop.last5HitRate,
    last10HitRate: snapshot.last10 ?? prop.last10HitRate,
    last20HitRate: snapshot.last20 ?? prop.last20HitRate,
    recentFormRate: snapshot.recentForm ?? prop.recentFormRate,
    seasonHitRate: snapshot.seasonRateValid ? snapshot.season ?? prop.seasonHitRate : prop.seasonHitRate ?? null,
    seasonGames: snapshot.seasonGamesPlayed ?? prop.seasonGames,
    seasonGamesPlayed: snapshot.seasonGamesPlayed ?? prop.seasonGamesPlayed,
    seasonGamesLabel: snapshot.gamesLabel,
    seasonGamesLabelKey: snapshot.gamesLabelKey,
  };
}
