/**
 * Historical stats loader — merge MLB StatsAPI profile averages onto live props.
 */

import { findPlayerHistoricalProfile, findStatProfile } from "./playerNames.js";
import { resolveHistoricalDataPresent } from "./tierHistoricalValidation.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round4(value) {
  const num = finite(value);
  if (num == null) return null;
  return Math.round(num * 10000) / 10000;
}

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

function resolveGameLogCount(profile = null, prop = null) {
  const safeProfile = asObject(profile);
  const safeProp = asObject(prop);
  const gameLogs = safeProfile?.gameLogs;

  if (Array.isArray(gameLogs)) {
    return gameLogs.length;
  }
  if (gameLogs && typeof gameLogs === "object") {
    const fromLogs = finite(gameLogs.sampleSize);
    if (fromLogs != null) return fromLogs;
  }

  const fromProfile =
    finite(safeProfile?.sampleSize) ??
    (Array.isArray(safeProfile?.gradingRows) ? safeProfile.gradingRows.length : null) ??
    (Array.isArray(safeProfile?.splits) ? safeProfile.splits.length : null);

  return fromProfile ?? finite(safeProp?.sampleSize) ?? finite(safeProp?.games) ?? 0;
}

function resolveHistoricalSource(profile = null, prop = null) {
  const safeProp = asObject(prop) || {};
  if (safeProp.historicalSource) return safeProp.historicalSource;

  const safeProfile = asObject(profile);
  if (!safeProfile) return "—";
  if (safeProfile.statSources?.length) return safeProfile.statSources.join(", ");
  if (safeProfile.source) return safeProfile.source;
  if (safeProfile.hasGameLogs) return "MLB StatsAPI game logs";
  return "—";
}

function profileHasUsableGameLogs(profile = null) {
  const safeProfile = asObject(profile);
  if (!safeProfile || safeProfile.sparse || safeProfile.fallback) return false;
  const gameLogCount = resolveGameLogCount(safeProfile);
  return Boolean(
    safeProfile.hasGameLogs ||
      (gameLogCount != null && gameLogCount >= 3) ||
      finite(safeProfile.last5Average) != null ||
      finite(safeProfile.seasonAverage) != null
  );
}

function emptyHistoricalAuditRow(prop = {}, reason = "Historical data unavailable") {
  return {
    player: String(prop?.playerName || prop?.player || "Unknown").trim(),
    market: String(prop?.statType || prop?.market || prop?.propType || "—").trim(),
    last5: null,
    last10: null,
    seasonAverage: null,
    gameLogCount: 0,
    sampleSize: 0,
    historicalSource: "—",
    profileHasLogs: false,
    historicalPresent: false,
    historicalCoverage: false,
    missingHistorical: reason,
    dropTrace: reason,
  };
}

/** Merge statsMap profile historical fields onto a prop (never overwrites existing prop values). */
export function attachHistoricalStatsFromProfile(prop = {}, context = {}) {
  const statsMap = context.statsMap;
  if (!(statsMap instanceof Map)) return prop;

  const profile = findPlayerHistoricalProfile(statsMap, prop);
  if (!profileHasUsableGameLogs(profile)) return prop;

  const safeProfile = asObject(profile);
  if (!safeProfile) return prop;

  const gameLogCount = resolveGameLogCount(safeProfile, prop);
  const historicalSource = resolveHistoricalSource(safeProfile, prop);

  return {
    ...prop,
    last5Average:
      finite(prop.last5Average) ?? finite(safeProfile.last5Average) ?? finite(safeProfile.recentForm),
    last10Average: finite(prop.last10Average) ?? finite(safeProfile.last10Average),
    seasonAverage: finite(prop.seasonAverage) ?? finite(safeProfile.seasonAverage),
    recentForm:
      finite(prop.recentForm) ?? finite(safeProfile.last5Average) ?? finite(safeProfile.recentForm),
    last5HitRate: finite(prop.last5HitRate) ?? finite(safeProfile.last5HitRate),
    last10HitRate:
      finite(prop.last10HitRate) ?? finite(safeProfile.last10HitRate) ?? finite(safeProfile.recentHitRate),
    seasonHitRate:
      finite(prop.seasonHitRate) ??
      finite(safeProfile.seasonHitRate) ??
      finite(safeProfile.historicalHitRate),
    recentHitRate:
      finite(prop.recentHitRate) ?? finite(safeProfile.recentHitRate) ?? finite(safeProfile.last10HitRate),
    historicalHitRate:
      finite(prop.historicalHitRate) ??
      finite(safeProfile.historicalHitRate) ??
      finite(safeProfile.seasonHitRate),
    sampleSize: finite(prop.sampleSize) ?? finite(safeProfile.sampleSize) ?? gameLogCount ?? 0,
    games: finite(prop.games) ?? finite(safeProfile.sampleSize) ?? gameLogCount ?? 0,
    hasGameLogs:
      prop.hasGameLogs ?? safeProfile.hasGameLogs ?? (gameLogCount != null && gameLogCount >= 3),
    gradingRows: prop.gradingRows ?? safeProfile.gradingRows ?? safeProfile.splits ?? null,
    splits: prop.splits ?? safeProfile.splits ?? null,
    historicalSource,
    historicalStatsAttached: true,
    historicalProfileKey: safeProfile.playerName
      ? `${safeProfile.playerName}|${safeProfile.statType || ""}`
      : null,
    historicalCoverage: resolveHistoricalDataPresent({
      ...prop,
      last5Average: finite(prop.last5Average) ?? finite(safeProfile.last5Average),
      last10Average: finite(prop.last10Average) ?? finite(safeProfile.last10Average),
      seasonAverage: finite(prop.seasonAverage) ?? finite(safeProfile.seasonAverage),
    }).present,
  };
}

export function attachHistoricalStatsToProps(props = [], context = {}) {
  return (props || []).map((prop) => {
    try {
      return attachHistoricalStatsFromProfile(prop, context);
    } catch (error) {
      console.warn("[Historical audit] attach failed", {
        player: prop?.playerName || prop?.player,
        error: error?.message || error,
      });
      return {
        ...prop,
        sampleSize: finite(prop?.sampleSize) ?? 0,
        historicalCoverage: false,
      };
    }
  });
}

function diagnoseHistoricalDrop(prop = {}, profile = null, enriched = {}) {
  const safeProfile = asObject(profile);
  if (!safeProfile) return "No statsMap profile match for player/market";
  if (safeProfile.sparse || safeProfile.fallback) return "Matched profile is sparse/fallback only";
  if (!profileHasUsableGameLogs(safeProfile)) return "Profile has no usable game logs";

  const before = resolveHistoricalDataPresent(prop);
  const after = resolveHistoricalDataPresent(enriched);
  if (before.present) return "";
  if (after.present) return "";

  const missing = after.missingLabels?.length ? after.missingLabels.join(", ") : "unknown";
  if (profileHasUsableGameLogs(safeProfile) && !after.present) {
    return `Profile has logs but prop missing after attach: ${missing}`;
  }
  return `Historical incomplete: ${missing}`;
}

function pickSampleProps(pool = [], limit = 10) {
  const items = [...(pool || [])];
  if (items.length <= limit) return items;
  const stride = Math.max(1, Math.floor(items.length / limit));
  const sample = [];
  for (let i = 0; i < items.length && sample.length < limit; i += stride) {
    sample.push(items[i]);
  }
  while (sample.length < limit && sample.length < items.length) {
    const candidate = items[sample.length];
    if (!sample.includes(candidate)) sample.push(candidate);
    else break;
  }
  return sample.slice(0, limit);
}

export function buildHistoricalPipelineAuditRow(prop = {}, context = {}) {
  try {
    const statsMap = context.statsMap;
    const profile = statsMap instanceof Map ? findPlayerHistoricalProfile(statsMap, prop) : null;
    const enriched = attachHistoricalStatsFromProfile(prop, context);
    const historical = resolveHistoricalDataPresent(enriched);
    const sampleSize = resolveGameLogCount(profile, enriched);

    return {
      player: String(prop?.playerName || prop?.player || "Unknown").trim(),
      market: String(prop?.statType || prop?.market || prop?.propType || "—").trim(),
      last5: round4(enriched?.last5Average),
      last10: round4(enriched?.last10Average),
      seasonAverage: round4(enriched?.seasonAverage),
      gameLogCount: sampleSize,
      sampleSize,
      historicalSource: resolveHistoricalSource(profile, enriched),
      profileHasLogs: profileHasUsableGameLogs(profile),
      historicalPresent: Boolean(historical?.present),
      historicalCoverage: Boolean(historical?.present),
      missingHistorical: historical?.missingLabels?.join(", ") || "",
      dropTrace: diagnoseHistoricalDrop(prop, profile, enriched),
    };
  } catch (error) {
    console.warn("[Historical audit] row build failed", {
      player: prop?.playerName || prop?.player,
      error: error?.message || error,
    });
    return emptyHistoricalAuditRow(prop);
  }
}

export function buildHistoricalCoverageAudit(projectedPool = [], context = {}) {
  const pool = projectedPool || [];
  const statsMap = context.statsMap;
  if (!pool.length) {
    return {
      coveragePercent: 0,
      withHistorical: 0,
      total: 0,
      statsMapSize: statsMap instanceof Map ? statsMap.size : 0,
      sampleRows: [],
    };
  }

  let withHistorical = 0;
  let profileMatchCount = 0;
  let profileWithLogsCount = 0;
  let attachedFromProfileCount = 0;

  for (const prop of pool) {
    try {
      const profile = statsMap instanceof Map ? findPlayerHistoricalProfile(statsMap, prop) : null;
      if (profile) profileMatchCount += 1;
      if (profileHasUsableGameLogs(profile)) profileWithLogsCount += 1;

      const before = resolveHistoricalDataPresent(prop);
      const enriched = attachHistoricalStatsFromProfile(prop, context);
      if (!before.present && resolveHistoricalDataPresent(enriched).present) {
        attachedFromProfileCount += 1;
      }
      if (resolveHistoricalDataPresent(enriched).present) withHistorical += 1;
    } catch (error) {
      console.warn("[Historical audit] coverage pass failed", {
        player: prop?.playerName || prop?.player,
        error: error?.message || error,
      });
    }
  }

  const sampleRows = pickSampleProps(pool, 10).map((prop) => buildHistoricalPipelineAuditRow(prop, context));

  return {
    coveragePercent: Math.round((withHistorical / pool.length) * 1000) / 10,
    withHistorical,
    total: pool.length,
    statsMapSize: statsMap instanceof Map ? statsMap.size : 0,
    profileMatchCount,
    profileWithLogsCount,
    attachedFromProfileCount,
    sampleRows,
  };
}
