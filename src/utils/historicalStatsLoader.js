/**
 * Historical stats loader — merge MLB StatsAPI profile averages onto live props.
 */

import { findSeasonStatRow } from "../../api/lib/sportsDataMlbStatProjection.js";
import { computeMlbHistoricalAveragesFromSplits } from "../services/playerStats.js";
import { findPlayerHistoricalProfile, resolvePropPlayerName } from "./playerNames.js";
import {
  marketsMatchForHistoricalAttach,
  resolveMlbHistoricalMarketKey,
  sumSeasonFieldsPerGame,
} from "./mlbHistoricalStatMapping.js";
import { resolveHistoricalDataPresent } from "./tierHistoricalValidation.js";
import { attachSeasonHitRateFields } from "./seasonHitRate.js";

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

function resolvePropPlayerId(prop = {}) {
  const id = prop?.playerId ?? prop?.sportsDataPlayerId ?? prop?.mlbPlayerId ?? null;
  if (id == null || id === "") return null;
  return String(id);
}

function resolveProfilePlayerId(profile = {}) {
  const id = profile?.playerId ?? profile?.sportsDataPlayerId ?? profile?.mlbPlayerId ?? profile?.mlbId ?? null;
  if (id == null || id === "") return null;
  return String(id);
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

function profileHasPrecomputedAveragesOnly(profile = null) {
  const safeProfile = asObject(profile);
  if (!safeProfile) return false;
  return (
    finite(safeProfile.last5Average) != null ||
    finite(safeProfile.last10Average) != null ||
    finite(safeProfile.seasonAverage) != null
  );
}

function profileHasPrecomputedAverages(profile = null, prop = {}) {
  const safeProfile = asObject(profile);
  if (!safeProfile) return false;
  if (!marketsMatchForHistoricalAttach(safeProfile.statType, prop.statType || prop.market)) return false;
  return profileHasPrecomputedAveragesOnly(safeProfile);
}

function profileHasAttachableData(profile = null) {
  const safeProfile = asObject(profile);
  if (!safeProfile || safeProfile.fallback) return false;
  if (profileHasPrecomputedAveragesOnly(safeProfile)) return true;
  const gameLogCount = resolveGameLogCount(safeProfile);
  return Boolean(
    safeProfile.hasGameLogs ||
      (gameLogCount != null && gameLogCount >= 3) ||
      finite(safeProfile.last5Average) != null ||
      finite(safeProfile.seasonAverage) != null ||
      (Array.isArray(safeProfile.splits) && safeProfile.splits.length >= 3)
  );
}

function resolveHistoricalFieldsFromProfile(profile = {}, prop = {}) {
  const splits = profile.splits || profile.gradingRows || [];
  if (Array.isArray(splits) && splits.length >= 3) {
    const computed = computeMlbHistoricalAveragesFromSplits(splits, prop.statType || prop.market, prop.line);
    if (
      finite(computed.last5Average) != null ||
      finite(computed.last10Average) != null ||
      finite(computed.seasonAverage) != null
    ) {
      return {
        ...computed,
        historicalSource: resolveHistoricalSource(profile, prop),
        historicalRecomputedFromSplits: true,
      };
    }
  }

  if (profileHasPrecomputedAverages(profile, prop)) {
    return {
      last5Average: finite(profile.last5Average) ?? finite(profile.recentForm),
      last10Average: finite(profile.last10Average),
      seasonAverage: finite(profile.seasonAverage),
      last5HitRate: finite(profile.last5HitRate),
      last10HitRate: finite(profile.last10HitRate) ?? finite(profile.recentHitRate),
      gameLogCount: resolveGameLogCount(profile, prop),
      hasGameLogs: Boolean(profile.hasGameLogs || resolveGameLogCount(profile, prop) >= 3),
      historicalSource: resolveHistoricalSource(profile, prop),
      historicalRecomputedFromSplits: false,
    };
  }

  return null;
}

function resolveSeasonHistoricalFallback(prop = {}, seasonStats = []) {
  const statRow = findSeasonStatRow(seasonStats, {
    playerName: resolvePropPlayerName(prop),
    playerId: prop.playerId ?? prop.sportsDataPlayerId,
  });
  if (!statRow) return null;

  const marketKey = resolveMlbHistoricalMarketKey(prop.statType || prop.market || prop.propType || "");
  const seasonAverage = sumSeasonFieldsPerGame(statRow, marketKey);
  if (seasonAverage == null) return null;

  return {
    last5Average: seasonAverage,
    last10Average: seasonAverage,
    seasonAverage,
    gameLogCount: Number(statRow.Games ?? statRow.GamesPlayed) || 0,
    hasGameLogs: false,
    historicalSource: "SportsDataIO season neutral fallback",
    historicalNeutralFallback: true,
    historicalRecomputedFromSplits: false,
  };
}

function applyHistoricalFields(prop = {}, profile = null, fields = {}) {
  const gameLogCount = finite(fields.gameLogCount) ?? resolveGameLogCount(profile, prop);
  const next = attachSeasonHitRateFields({
    ...prop,
    last5Average: finite(prop.last5Average) ?? finite(fields.last5Average),
    last10Average: finite(prop.last10Average) ?? finite(fields.last10Average),
    seasonAverage: finite(prop.seasonAverage) ?? finite(fields.seasonAverage),
    recentForm: finite(prop.recentForm) ?? finite(fields.last5Average) ?? finite(fields.recentForm),
    last5HitRate: finite(prop.last5HitRate) ?? finite(fields.last5HitRate),
    last10HitRate: finite(prop.last10HitRate) ?? finite(fields.last10HitRate),
    seasonHitRate:
      finite(prop.seasonHitRate) ??
      finite(fields.seasonHitRate) ??
      finite(prop.historicalHitRate) ??
      finite(fields.historicalHitRate),
    recentHitRate: finite(prop.recentHitRate) ?? finite(fields.last10HitRate) ?? finite(fields.recentHitRate),
    historicalHitRate:
      finite(prop.historicalHitRate) ??
      finite(fields.historicalHitRate) ??
      finite(prop.seasonHitRate) ??
      finite(fields.seasonHitRate),
    sampleSize: finite(prop.sampleSize) ?? finite(fields.sampleSize) ?? gameLogCount ?? 0,
    games: finite(prop.games) ?? finite(fields.games) ?? gameLogCount ?? 0,
    seasonGamesPlayed:
      finite(prop.seasonGamesPlayed) ??
      finite(fields.seasonGamesPlayed) ??
      gameLogCount ??
      null,
    hasGameLogs: prop.hasGameLogs ?? fields.hasGameLogs ?? (gameLogCount != null && gameLogCount >= 3),
    gradingRows: prop.gradingRows ?? fields.splits ?? profile?.gradingRows ?? profile?.splits ?? null,
    splits: prop.splits ?? fields.splits ?? profile?.splits ?? null,
    historicalSource: fields.historicalSource || resolveHistoricalSource(profile, prop),
    historicalStatsAttached: true,
    historicalProfileKey: profile
      ? `${profile.playerName || ""}|${profile.statType || ""}|${resolveProfilePlayerId(profile) || ""}`
      : null,
    matchedProfileId: resolveProfilePlayerId(profile) || resolvePropPlayerId(prop) || null,
    sportsDataPlayerId: prop.sportsDataPlayerId ?? profile?.sportsDataPlayerId ?? profile?.playerId ?? null,
    historicalNeutralFallback: Boolean(fields.historicalNeutralFallback),
    historicalRecomputedFromSplits: Boolean(fields.historicalRecomputedFromSplits),
  });
  next.historicalCoverage = resolveHistoricalDataPresent(next).present;
  return next;
}

export function auditStatsAttach(prop = {}, enriched = {}, context = {}) {
  const statsMap = context.statsMap;
  const market = String(prop.statType || prop.market || prop.propType || "—").trim();
  const playerName = resolvePropPlayerName(prop) || "Unknown";
  const sportsDataPlayerId = resolvePropPlayerId(prop) || "—";
  const profile =
    statsMap instanceof Map ? findPlayerHistoricalProfile(statsMap, prop) : null;

  return {
    playerName,
    market,
    sportsDataPlayerId,
    matchedProfileId: enriched.matchedProfileId || resolveProfilePlayerId(profile) || "—",
    profileFound: Boolean(profile),
    gameLogsFound: resolveGameLogCount(profile, enriched),
    historicalAttached: Boolean(enriched.historicalStatsAttached),
    last5: finite(enriched.last5Average),
    last10: finite(enriched.last10Average),
    seasonAverage: finite(enriched.seasonAverage),
    historicalNeutralFallback: Boolean(enriched.historicalNeutralFallback),
    historicalCoverage: Boolean(enriched.historicalCoverage),
  };
}

export function logStatsAttachAudit(audit = {}) {
  const profileLabel = audit.profileFound ? "YES" : "NO";
  const attachLabel = audit.historicalAttached ? "YES" : "NO";
  console.log(
    `[StatsAttach] ${audit.playerName}\n${audit.market}\nProfile Found: ${profileLabel}\nGame Logs: ${audit.gameLogsFound ?? 0}\nHistorical Attached: ${attachLabel}`
  );
  return audit;
}

/** Merge statsMap profile historical fields onto a prop (never overwrites existing prop values). */
export function attachHistoricalStatsFromProfile(prop = {}, context = {}) {
  const statsMap = context.statsMap;
  if (!(statsMap instanceof Map)) return prop;

  const profile = findPlayerHistoricalProfile(statsMap, prop);
  if (profile && profileHasAttachableData(profile)) {
    const fields = resolveHistoricalFieldsFromProfile(profile, prop);
    if (fields) {
      return applyHistoricalFields(prop, profile, fields);
    }
  }

  const seasonFallback = resolveSeasonHistoricalFallback(prop, context.seasonStats || []);
  if (seasonFallback) {
    return applyHistoricalFields(prop, profile, seasonFallback);
  }

  return {
    ...prop,
    historicalStatsAttached: false,
    historicalCoverage: resolveHistoricalDataPresent(prop).present,
  };
}

export function attachHistoricalStatsToProps(props = [], context = {}) {
  const logAttach = Boolean(context.logAttach);

  return (props || []).map((prop) => {
    try {
      const next = attachHistoricalStatsFromProfile(prop, context);
      if (logAttach) {
        const hasProjection = Number(next.projection ?? next.projectedValue) > 0;
        if (hasProjection) {
          logStatsAttachAudit(auditStatsAttach(prop, next, context));
        }
      }
      return next;
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

export function buildStatsAttachmentMetrics(props = [], context = {}) {
  const pool = props || [];
  if (!pool.length) {
    return {
      profilesFound: 0,
      profilesMissing: 0,
      gameLogsAttached: 0,
      historicalAttached: 0,
      historicalCoveragePercent: 0,
      total: 0,
    };
  }

  let profilesFound = 0;
  let gameLogsAttached = 0;
  let historicalAttached = 0;
  let withHistorical = 0;
  const statsMap = context.statsMap;

  for (const prop of pool) {
    const profile = statsMap instanceof Map ? findPlayerHistoricalProfile(statsMap, prop) : null;
    if (profile) profilesFound += 1;
    const enriched = attachHistoricalStatsFromProfile(prop, context);
    if (enriched.historicalStatsAttached) historicalAttached += 1;
    if (enriched.hasGameLogs || resolveGameLogCount(profile, enriched) >= 3) gameLogsAttached += 1;
    if (resolveHistoricalDataPresent(enriched).present) withHistorical += 1;
  }

  return {
    profilesFound,
    profilesMissing: pool.length - profilesFound,
    gameLogsAttached,
    historicalAttached,
    historicalCoveragePercent: Math.round((withHistorical / pool.length) * 1000) / 10,
    total: pool.length,
  };
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

function diagnoseHistoricalDrop(prop = {}, profile = null, enriched = {}) {
  const safeProfile = asObject(profile);
  if (!safeProfile) return "No statsMap profile match for player/market";
  if (safeProfile.sparse || safeProfile.fallback) return "Matched profile is sparse/fallback only";
  if (!profileHasAttachableData(safeProfile)) return "Profile has no usable game logs";

  const before = resolveHistoricalDataPresent(prop);
  const after = resolveHistoricalDataPresent(enriched);
  if (before.present) return "";
  if (after.present) return "";

  const missing = after.missingLabels?.length ? after.missingLabels.join(", ") : "unknown";
  if (profileHasAttachableData(safeProfile) && !after.present) {
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
      profileHasLogs: profileHasAttachableData(profile),
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
      attachmentMetrics: buildStatsAttachmentMetrics([], context),
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
      if (profileHasAttachableData(profile)) profileWithLogsCount += 1;

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
  const attachmentMetrics = buildStatsAttachmentMetrics(pool, context);

  return {
    coveragePercent: Math.round((withHistorical / pool.length) * 1000) / 10,
    withHistorical,
    total: pool.length,
    statsMapSize: statsMap instanceof Map ? statsMap.size : 0,
    profileMatchCount,
    profileWithLogsCount,
    attachedFromProfileCount,
    attachmentMetrics,
    sampleRows,
  };
}

/** @deprecated alias */
function profileHasUsableGameLogs(profile = null) {
  return profileHasAttachableData(profile);
}

export { profileHasUsableGameLogs };
