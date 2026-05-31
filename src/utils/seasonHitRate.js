/**
 * MLB performance stats — separate recent windows from true season totals.
 */

import { computeMlbHistoricalAveragesFromSplits } from "../services/playerStats.js";
import { findSeasonStatRow, resolveSeasonGames } from "../../api/lib/sportsDataMlbStatProjection.js";
import { resolvePropPlayerName } from "./playerNames.js";

export const MIN_SEASON_LOGS_FOR_RATE = 20;
export const MIN_SDIO_SEASON_GAMES = 50;

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

function toDisplayLabel(rate) {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${Math.round(rate)}%`;
}

function estimateHitRateFromAverage(avg, line) {
  const baseline = finite(avg);
  const ln = finite(line);
  if (baseline == null || ln == null || ln <= 0) return null;
  const gap = (baseline - ln) / ln;
  return clamp(Math.round(50 + gap * 35), 15, 88);
}

function resolveSeasonStatRow(prop = {}, context = {}) {
  const seasonStats = context.seasonStats || prop.seasonStats || [];
  if (!Array.isArray(seasonStats) || !seasonStats.length) return null;
  return findSeasonStatRow(seasonStats, {
    playerName: resolvePropPlayerName(prop),
    playerId: prop.playerId ?? prop.sportsDataPlayerId,
  });
}

/** True season games played from SportsDataIO season row. */
export function resolveSportsDataSeasonGames(prop = {}, context = {}) {
  const statRow = resolveSeasonStatRow(prop, context);
  if (statRow) {
    const games = resolveSeasonGames(statRow);
    if (games != null && games > 0) return games;
  }
  return finite(prop.seasonGamesPlayed) ?? finite(prop.seasonGames) ?? finite(prop.games) ?? null;
}

function resolveComputedFromSplits(prop = {}) {
  const line = finite(prop.line);
  const statType = prop.statType || prop.market || prop.propType || "";
  const splits = prop.splits || prop.gradingRows || [];
  if (!Array.isArray(splits) || !splits.length || line == null) return null;
  return computeMlbHistoricalAveragesFromSplits(splits, statType, line);
}

function resolveRecentRates(prop = {}, computed = null) {
  const resolved = computed || resolveComputedFromSplits(prop) || {};
  const last5 =
    normalizeHitRatePercent(prop.last5HitRate) ??
    normalizeHitRatePercent(resolved.last5HitRate) ??
    estimateHitRateFromAverage(prop.last5Average ?? prop.recentForm, prop.line);
  const last10 =
    normalizeHitRatePercent(prop.last10HitRate) ??
    normalizeHitRatePercent(prop.recentHitRate) ??
    normalizeHitRatePercent(resolved.last10HitRate) ??
    estimateHitRateFromAverage(prop.last10Average, prop.line);
  const last20 = normalizeHitRatePercent(prop.last20HitRate) ?? normalizeHitRatePercent(resolved.last20HitRate);

  return {
    last5HitRate: last5,
    last10HitRate: last10,
    last20HitRate: last20,
    last5Label: toDisplayLabel(last5),
    last10Label: toDisplayLabel(last10),
    last20Label: toDisplayLabel(last20),
    last5Games: last5 != null ? Math.min(5, resolved.gameLogCount ?? 5) : null,
    last10Games: last10 != null ? Math.min(10, resolved.gameLogCount ?? 10) : null,
    recentFormRate:
      last5 != null && last10 != null
        ? round1(last5 * 0.4 + last10 * 0.6)
        : last10 ?? last5 ?? null,
  };
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function resolveTrueSeasonPerformance(prop = {}, context = {}, computed = null) {
  const resolved = computed || resolveComputedFromSplits(prop) || {};
  const seasonGamesPlayed = resolveSportsDataSeasonGames(prop, context);
  const logCount = finite(resolved.gameLogCount) ?? 0;
  const logSeasonRate = normalizeHitRatePercent(resolved.seasonHitRate);
  const line = finite(prop.line);

  if (
    logSeasonRate != null &&
    logCount >= MIN_SEASON_LOGS_FOR_RATE &&
    (seasonGamesPlayed == null || logCount >= Math.min(seasonGamesPlayed, MIN_SDIO_SEASON_GAMES) * 0.2)
  ) {
    const validForProbability =
      logCount >= MIN_SDIO_SEASON_GAMES ||
      (seasonGamesPlayed != null && seasonGamesPlayed >= MIN_SDIO_SEASON_GAMES && logCount >= 30);
    return {
      seasonHitRate: logSeasonRate,
      seasonGamesPlayed,
      seasonHits: Math.round((logSeasonRate / 100) * (seasonGamesPlayed ?? logCount)),
      seasonRateValid: validForProbability,
      seasonHitRateSource: "season game logs",
      seasonEstimated: false,
    };
  }

  const explicitSeason = normalizeHitRatePercent(prop.seasonHitRate ?? prop.historicalHitRate);
  if (
    explicitSeason != null &&
    seasonGamesPlayed != null &&
    seasonGamesPlayed >= MIN_SDIO_SEASON_GAMES
  ) {
    return {
      seasonHitRate: explicitSeason,
      seasonGamesPlayed,
      seasonHits: Math.round((explicitSeason / 100) * seasonGamesPlayed),
      seasonRateValid: true,
      seasonHitRateSource: "season-hit-rate",
      seasonEstimated: false,
    };
  }

  const seasonAverage =
    finite(prop.seasonAverage) ??
    finite(resolved.seasonAverage) ??
    null;
  if (seasonGamesPlayed != null && seasonGamesPlayed >= MIN_SDIO_SEASON_GAMES && seasonAverage != null && line != null) {
    const estimated = estimateHitRateFromAverage(seasonAverage, line);
    if (estimated != null) {
      return {
        seasonHitRate: estimated,
        seasonGamesPlayed,
        seasonHits: null,
        seasonRateValid: true,
        seasonHitRateSource: "sportsdataio-season-totals",
        seasonEstimated: true,
      };
    }
  }

  return {
    seasonHitRate: logSeasonRate,
    seasonGamesPlayed,
    seasonHits: null,
    seasonRateValid: false,
    seasonHitRateSource: logSeasonRate != null ? "insufficient-season-sample" : "unavailable",
    seasonEstimated: false,
  };
}

const SEASON_HIT_RATE_SOURCE_LABELS = {
  "season game logs": "Season game logs",
  "season-hit-rate": "Season hit rate",
  "sportsdataio-season-totals": "SportsDataIO season totals",
  "insufficient-season-sample": "Insufficient season sample",
  "last30 game logs": "Last 30 games",
  "last20 game logs": "Last 20 games",
  "last10 game logs": "Last 10 games",
  "last10-proxy": "Recent sample (last 10 games)",
  "no mlb games": "No MLB games logged",
  unavailable: "Unavailable",
};

export function formatSeasonHitRateSource(source = "") {
  const key = String(source || "").trim().toLowerCase();
  if (!key) return "";
  if (SEASON_HIT_RATE_SOURCE_LABELS[key]) return SEASON_HIT_RATE_SOURCE_LABELS[key];
  if (/^prop\./i.test(key)) {
    return key
      .replace(/^prop\./i, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** @deprecated use resolveSportsDataSeasonGames */
export function resolveActualSeasonGamesPlayed(prop = {}, computed = {}) {
  return resolveSportsDataSeasonGames(prop, { seasonStats: prop.seasonStats }) ?? finite(computed.gameLogCount);
}

export function resolveMlbPerformanceBundle(prop = {}, context = {}) {
  const computed = resolveComputedFromSplits(prop);
  const recent = resolveRecentRates(prop, computed);
  const season = resolveTrueSeasonPerformance(prop, context, computed);

  const gamesLabel = season.seasonRateValid
    ? "Season Games"
    : recent.last10HitRate != null
      ? "Sample Games"
      : "Games";
  const gamesLabelKey = season.seasonRateValid ? "season" : recent.last10HitRate != null ? "sample" : "unknown";
  const displayGamesCount = season.seasonRateValid
    ? season.seasonGamesPlayed
    : recent.last10Games ?? recent.last5Games ?? season.seasonGamesPlayed;

  return {
    ...recent,
    ...season,
    displayLabel: season.seasonRateValid ? toDisplayLabel(season.seasonHitRate) : "—",
    gamesCount: displayGamesCount,
    gamesLabel,
    gamesLabelKey,
    sampleGames: season.seasonRateValid ? null : recent.last10Games,
    seasonGames: season.seasonGamesPlayed,
  };
}

/** Backward-compatible season hit rate bundle for UI + calibration. */
export function resolveSeasonHitRateBundle(prop = {}, context = {}) {
  return resolveMlbPerformanceBundle(prop, context);
}

export function attachSeasonHitRateFields(prop = {}, context = {}) {
  const bundle = resolveMlbPerformanceBundle(prop, context);
  return {
    ...prop,
    last5HitRate: bundle.last5HitRate ?? prop.last5HitRate,
    last10HitRate: bundle.last10HitRate ?? prop.last10HitRate,
    last20HitRate: bundle.last20HitRate ?? prop.last20HitRate,
    recentFormRate: bundle.recentFormRate ?? prop.recentFormRate,
    seasonHitRate: bundle.seasonRateValid ? bundle.seasonHitRate : prop.seasonHitRate ?? null,
    seasonGames: bundle.seasonGamesPlayed ?? prop.seasonGames,
    seasonGamesPlayed: bundle.seasonGamesPlayed ?? prop.seasonGamesPlayed,
    sampleGames: bundle.sampleGames ?? prop.sampleGames,
    seasonHits: bundle.seasonHits ?? prop.seasonHits,
    seasonHitRateSource: bundle.seasonHitRateSource,
    seasonHitRateDisplay: bundle.displayLabel,
    seasonGamesLabel: bundle.gamesLabel,
    seasonGamesLabelKey: bundle.gamesLabelKey,
    seasonRateValid: bundle.seasonRateValid,
    seasonEstimated: bundle.seasonEstimated,
  };
}
