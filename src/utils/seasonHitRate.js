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

function resolveGamesLabel(source = "", games = null) {
  if (/season game logs|prop\.seasonHitRate/i.test(String(source || ""))) {
    return { gamesLabel: "Season Games", gamesLabelKey: "season" };
  }
  if (games != null && games > 0) {
    return { gamesLabel: "Sample Games", gamesLabelKey: "sample" };
  }
  return { gamesLabel: "Games", gamesLabelKey: "unknown" };
}

function bundleFromRate(rate, { seasonGames = null, seasonHits = null, seasonHitRateSource = "" } = {}) {
  const normalized = normalizeHitRatePercent(rate);
  const labels = resolveGamesLabel(seasonHitRateSource, seasonGames);
  return {
    seasonHitRate: normalized,
    seasonGames,
    seasonHits,
    seasonHitRateSource,
    gamesLabel: labels.gamesLabel,
    gamesLabelKey: labels.gamesLabelKey,
    displayLabel: toDisplayLabel(normalized),
    seasonRateValid: normalized != null && normalized > 0,
  };
}

function pickWindowRate(computed = {}, line, prop = {}) {
  const windows = [
    { rate: computed.last30HitRate ?? prop.last30HitRate, games: 30, source: "last30 game logs" },
    { rate: computed.last20HitRate ?? prop.last20HitRate, games: 20, source: "last20 game logs" },
    { rate: computed.last10HitRate ?? prop.last10HitRate ?? prop.recentHitRate, games: 10, source: "last10 game logs" },
    {
      rate: computed.seasonHitRate ?? prop.seasonHitRate ?? prop.historicalHitRate,
      games: computed.gameLogCount ?? prop.gameLogCount ?? prop.seasonGames ?? prop.sampleSize,
      source: "season game logs",
    },
  ];

  for (const window of windows) {
    const rate = normalizeHitRatePercent(window.rate);
    const games = finite(window.games);
    if (rate != null && rate > 0 && games != null && games > 0) {
      const hits = Math.round((rate / 100) * games);
      return bundleFromRate(rate, {
        seasonGames: games,
        seasonHits: hits,
        seasonHitRateSource: window.source,
      });
    }
  }

  const seasonGames = finite(computed.gameLogCount) ?? 0;
  const seasonRate = normalizeHitRatePercent(computed.seasonHitRate);
  if (seasonGames > 0 && seasonRate != null && seasonRate > 0) {
    return bundleFromRate(seasonRate, {
      seasonGames,
      seasonHits: Math.round((seasonRate / 100) * seasonGames),
      seasonHitRateSource: "season game logs",
    });
  }

  return null;
}

export function resolveSeasonHitRateBundle(prop = {}) {
  const line = finite(prop.line);
  const statType = prop.statType || prop.market || prop.propType || "";
  const seasonGames =
    finite(prop.seasonGames) ??
    finite(prop.games) ??
    finite(prop.sampleSize) ??
    finite(prop.gameLogCount);

  const explicitSeason = normalizeHitRatePercent(prop.seasonHitRate ?? prop.historicalHitRate);
  const last10 = normalizeHitRatePercent(prop.last10HitRate ?? prop.recentHitRate);

  if (explicitSeason != null && explicitSeason > 0) {
    return bundleFromRate(explicitSeason, {
      seasonGames,
      seasonHitRateSource: "prop.seasonHitRate",
    });
  }

  const splits = prop.splits || prop.gradingRows || [];
  if (Array.isArray(splits) && splits.length && line != null) {
    const computed = computeMlbHistoricalAveragesFromSplits(splits, statType, line);
    const fromLogs = pickWindowRate(computed, line, prop);
    if (fromLogs) return fromLogs;
  }

  if (last10 != null && last10 > 0) {
    const proxyGames = finite(prop.gameLogCount) ?? 10;
    return bundleFromRate(last10, {
      seasonGames: proxyGames,
      seasonHits: Math.round((last10 / 100) * proxyGames),
      seasonHitRateSource: "last10HitRate proxy",
    });
  }

  if (seasonGames === 0) {
    return {
      seasonHitRate: 0,
      seasonGames: 0,
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
    seasonGames: seasonGames ?? null,
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
    seasonHits: bundle.seasonHits ?? prop.seasonHits,
    seasonHitRateSource: bundle.seasonHitRateSource,
    seasonHitRateDisplay: bundle.displayLabel,
    seasonGamesLabel: bundle.gamesLabel,
    seasonGamesLabelKey: bundle.gamesLabelKey,
    seasonRateValid: bundle.seasonRateValid,
  };
}
