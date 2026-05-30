/**
 * Historical stats loader — merge MLB StatsAPI profile averages onto live props.
 */

import { findStatProfile } from "./playerNames.js";
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

function resolveGameLogCount(profile = {}, prop = {}) {
  const fromProfile =
    finite(profile.sampleSize) ??
    (Array.isArray(profile.gradingRows) ? profile.gradingRows.length : null) ??
    (Array.isArray(profile.splits) ? profile.splits.length : null);
  return fromProfile ?? finite(prop.sampleSize) ?? finite(prop.games) ?? null;
}

function resolveHistoricalSource(profile = {}, prop = {}) {
  if (prop.historicalSource) return prop.historicalSource;
  if (profile.statSources?.length) return profile.statSources.join(", ");
  if (profile.source) return profile.source;
  if (profile.hasGameLogs) return "MLB StatsAPI game logs";
  return "—";
}

function profileHasUsableGameLogs(profile = {}) {
  if (!profile || profile.sparse || profile.fallback) return false;
  const gameLogCount = resolveGameLogCount(profile);
  return Boolean(
    profile.hasGameLogs ||
      (gameLogCount != null && gameLogCount >= 3) ||
      finite(profile.last5Average) != null ||
      finite(profile.seasonAverage) != null
  );
}

/** Merge statsMap profile historical fields onto a prop (never overwrites existing prop values). */
export function attachHistoricalStatsFromProfile(prop = {}, context = {}) {
  const statsMap = context.statsMap;
  if (!(statsMap instanceof Map)) return prop;

  const profile = findStatProfile(statsMap, prop);
  if (!profileHasUsableGameLogs(profile)) return prop;

  const gameLogCount = resolveGameLogCount(profile, prop);
  const historicalSource = resolveHistoricalSource(profile, prop);

  return {
    ...prop,
    last5Average: finite(prop.last5Average) ?? finite(profile.last5Average) ?? finite(profile.recentForm),
    last10Average: finite(prop.last10Average) ?? finite(profile.last10Average),
    seasonAverage: finite(prop.seasonAverage) ?? finite(profile.seasonAverage),
    recentForm: finite(prop.recentForm) ?? finite(profile.last5Average) ?? finite(profile.recentForm),
    last5HitRate: finite(prop.last5HitRate) ?? finite(profile.last5HitRate),
    last10HitRate:
      finite(prop.last10HitRate) ?? finite(profile.last10HitRate) ?? finite(profile.recentHitRate),
    seasonHitRate:
      finite(prop.seasonHitRate) ?? finite(profile.seasonHitRate) ?? finite(profile.historicalHitRate),
    recentHitRate: finite(prop.recentHitRate) ?? finite(profile.recentHitRate) ?? finite(profile.last10HitRate),
    historicalHitRate:
      finite(prop.historicalHitRate) ?? finite(profile.historicalHitRate) ?? finite(profile.seasonHitRate),
    sampleSize: finite(prop.sampleSize) ?? finite(profile.sampleSize) ?? gameLogCount,
    games: finite(prop.games) ?? finite(profile.sampleSize) ?? gameLogCount,
    hasGameLogs: prop.hasGameLogs ?? profile.hasGameLogs ?? (gameLogCount != null && gameLogCount >= 3),
    gradingRows: prop.gradingRows ?? profile.gradingRows ?? profile.splits ?? null,
    splits: prop.splits ?? profile.splits ?? null,
    historicalSource,
    historicalStatsAttached: true,
    historicalProfileKey: profile.playerName ? `${profile.playerName}|${profile.statType || ""}` : null,
  };
}

export function attachHistoricalStatsToProps(props = [], context = {}) {
  return (props || []).map((prop) => attachHistoricalStatsFromProfile(prop, context));
}

function diagnoseHistoricalDrop(prop = {}, profile = null, enriched = {}) {
  if (!profile) return "No statsMap profile match for player/market";
  if (profile.sparse || profile.fallback) return "Matched profile is sparse/fallback only";
  if (!profileHasUsableGameLogs(profile)) return "Profile has no usable game logs";

  const before = resolveHistoricalDataPresent(prop);
  const after = resolveHistoricalDataPresent(enriched);
  if (before.present) return "";
  if (after.present) return "";

  const missing = after.missingLabels?.length ? after.missingLabels.join(", ") : "unknown";
  if (profileHasUsableGameLogs(profile) && !after.present) {
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
  const statsMap = context.statsMap;
  const profile = statsMap instanceof Map ? findStatProfile(statsMap, prop) : null;
  const enriched = attachHistoricalStatsFromProfile(prop, context);
  const historical = resolveHistoricalDataPresent(enriched);

  return {
    player: String(prop.playerName || prop.player || "Unknown").trim(),
    market: String(prop.statType || prop.market || prop.propType || "—").trim(),
    last5: round4(enriched.last5Average),
    last10: round4(enriched.last10Average),
    seasonAverage: round4(enriched.seasonAverage),
    gameLogCount: resolveGameLogCount(profile, enriched),
    historicalSource: resolveHistoricalSource(profile, enriched),
    profileHasLogs: profileHasUsableGameLogs(profile),
    historicalPresent: historical.present,
    missingHistorical: historical.missingLabels?.join(", ") || "",
    dropTrace: diagnoseHistoricalDrop(prop, profile, enriched),
  };
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
    const profile = statsMap instanceof Map ? findStatProfile(statsMap, prop) : null;
    if (profile) profileMatchCount += 1;
    if (profileHasUsableGameLogs(profile)) profileWithLogsCount += 1;

    const before = resolveHistoricalDataPresent(prop);
    const enriched = attachHistoricalStatsFromProfile(prop, context);
    if (!before.present && resolveHistoricalDataPresent(enriched).present) {
      attachedFromProfileCount += 1;
    }
    if (resolveHistoricalDataPresent(enriched).present) withHistorical += 1;
  }

  const sampleRows = pickSampleProps(pool, 10).map((prop) =>
    buildHistoricalPipelineAuditRow(prop, context)
  );

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
