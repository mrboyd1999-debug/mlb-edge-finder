/**
 * Season hit rate resolution — avoid false 0% when rolling windows have data.
 */

import { computeMlbHistoricalAveragesFromSplits } from "../services/playerStats.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

const SEASON_SOURCE_PATTERN = /season game logs|season-hit-rate/i;
const SAMPLE_SOURCE_PATTERN = /last\d+|proxy|sample/i;

function resolveGamesLabel(source = "", sampleGames = null) {
  if (SEASON_SOURCE_PATTERN.test(String(source || ""))) {
    return { gamesLabel: "Season Games", gamesLabelKey: "season" };
  }
  if (sampleGames != null && sampleGames > 0) {
    return { gamesLabel: "Sample Games", gamesLabelKey: "sample" };
  }
  return { gamesLabel: "Games", gamesLabelKey: "unknown" };
}

/** Actual MLB season games played — never use rolling-window sample sizes here. */
export function resolveActualSeasonGamesPlayed(prop = {}, computed = {}) {
  return (
    finite(computed.gameLogCount) ??
    finite(prop.seasonGamesPlayed) ??
    finite(prop.seasonGames) ??
    finite(prop.games) ??
    null
  );
}

const SEASON_HIT_RATE_SOURCE_LABELS = {
  "season game logs": "Season game logs",
  "season-hit-rate": "Season hit rate",
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

function bundleFromRate(
  rate,
  { seasonGames = null, sampleGames = null, seasonHits = null, seasonHitRateSource = "" } = {}
) {
  const normalized = normalizeHitRatePercent(rate);
  const labels = resolveGamesLabel(seasonHitRateSource, sampleGames);
  const displayGamesCount =
    labels.gamesLabelKey === "sample" ? sampleGames ?? null : seasonGames ?? sampleGames ?? null;

  return {
    seasonHitRate: normalized,
    seasonGames,
    sampleGames,
    gamesCount: displayGamesCount,
    seasonHits,
    seasonHitRateSource,
    gamesLabel: labels.gamesLabel,
    gamesLabelKey: labels.gamesLabelKey,
    displayLabel: toDisplayLabel(normalized),
    seasonRateValid: normalized != null && normalized > 0,
  };
}

function pickWindowRate(computed = {}, prop = {}) {
  const actualSeasonGames = resolveActualSeasonGamesPlayed(prop, computed);
  const windows = [
    { rate: computed.seasonHitRate ?? prop.seasonHitRate ?? prop.historicalHitRate, games: actualSeasonGames, source: "season game logs", isSeason: true },
    { rate: computed.last30HitRate ?? prop.last30HitRate, games: 30, source: "last30 game logs", isSeason: false },
    { rate: computed.last20HitRate ?? prop.last20HitRate, games: 20, source: "last20 game logs", isSeason: false },
    {
      rate: computed.last10HitRate ?? prop.last10HitRate ?? prop.recentHitRate,
      games: 10,
      source: "last10 game logs",
      isSeason: false,
    },
  ];

  for (const window of windows) {
    const rate = normalizeHitRatePercent(window.rate);
    const sampleGames = window.isSeason ? null : finite(window.games);
    const games = window.isSeason ? actualSeasonGames : sampleGames;
    if (rate != null && rate > 0 && games != null && games > 0) {
      const hits = Math.round((rate / 100) * games);
      return bundleFromRate(rate, {
        seasonGames: actualSeasonGames,
        sampleGames: window.isSeason ? null : sampleGames,
        seasonHits: hits,
        seasonHitRateSource: window.source,
      });
    }
  }

  const seasonRate = normalizeHitRatePercent(computed.seasonHitRate);
  if (actualSeasonGames != null && actualSeasonGames > 0 && seasonRate != null && seasonRate > 0) {
    return bundleFromRate(seasonRate, {
      seasonGames: actualSeasonGames,
      seasonHits: Math.round((seasonRate / 100) * actualSeasonGames),
      seasonHitRateSource: "season game logs",
    });
  }

  return null;
}

export function resolveSeasonHitRateBundle(prop = {}) {
  const line = finite(prop.line);
  const statType = prop.statType || prop.market || prop.propType || "";
  const actualSeasonGames = resolveActualSeasonGamesPlayed(prop);

  const explicitSeason = normalizeHitRatePercent(prop.seasonHitRate ?? prop.historicalHitRate);
  const last10 = normalizeHitRatePercent(prop.last10HitRate ?? prop.recentHitRate);

  if (explicitSeason != null && explicitSeason > 0) {
    return bundleFromRate(explicitSeason, {
      seasonGames: actualSeasonGames,
      seasonHits:
        actualSeasonGames != null && actualSeasonGames > 0
          ? Math.round((explicitSeason / 100) * actualSeasonGames)
          : null,
      seasonHitRateSource: "season-hit-rate",
    });
  }

  const splits = prop.splits || prop.gradingRows || [];
  if (Array.isArray(splits) && splits.length && line != null) {
    const computed = computeMlbHistoricalAveragesFromSplits(splits, statType, line);
    const fromLogs = pickWindowRate(computed, prop);
    if (fromLogs) return fromLogs;
  }

  if (last10 != null && last10 > 0) {
    return bundleFromRate(last10, {
      seasonGames: actualSeasonGames,
      sampleGames: 10,
      seasonHits: Math.round((last10 / 100) * 10),
      seasonHitRateSource: "last10-proxy",
    });
  }

  if (actualSeasonGames === 0) {
    return {
      seasonHitRate: 0,
      seasonGames: 0,
      sampleGames: null,
      gamesCount: 0,
      seasonHits: 0,
      seasonHitRateSource: "no mlb games",
      gamesLabel: "Season Games",
      gamesLabelKey: "season",
      displayLabel: "0%",
      seasonRateValid: false,
    };
  }

  return {
    seasonHitRate: null,
    seasonGames: actualSeasonGames,
    sampleGames: null,
    gamesCount: actualSeasonGames,
    seasonHits: null,
    seasonHitRateSource: "unavailable",
    gamesLabel: "Games",
    gamesLabelKey: "unknown",
    displayLabel: "—",
    seasonRateValid: false,
  };
}

export function attachSeasonHitRateFields(prop = {}) {
  const bundle = resolveSeasonHitRateBundle(prop);
  return {
    ...prop,
    seasonHitRate: bundle.seasonHitRate ?? prop.seasonHitRate,
    seasonGames: bundle.seasonGames ?? prop.seasonGames,
    seasonGamesPlayed: bundle.seasonGames ?? prop.seasonGamesPlayed,
    sampleGames: bundle.sampleGames ?? prop.sampleGames,
    seasonHits: bundle.seasonHits ?? prop.seasonHits,
    seasonHitRateSource: bundle.seasonHitRateSource,
    seasonHitRateDisplay: bundle.displayLabel,
    seasonGamesLabel: bundle.gamesLabel,
    seasonGamesLabelKey: bundle.gamesLabelKey,
    seasonRateValid: bundle.seasonRateValid,
  };
}
