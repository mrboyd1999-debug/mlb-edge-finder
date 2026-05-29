/**
 * Join raw props to projections using stable player/stat keys discovered from runtime schema.
 */

import { computeProjectionForProp, findSeasonStatRow, resolveSportsDataPropLabel } from "../../../api/lib/sportsDataMlbStatProjection.js";
import { findStatProfile } from "../playerStats.js";
import { normalizePlayerName } from "../../utils/playerNames.js";
import {
  buildPlayerStatKey,
  buildPropLookupKeys,
  extractPlayerId,
  normalizeMergeId,
  normalizeMergeStatType,
  statTypesAlign,
} from "../../utils/propMergeKeys.js";
import { resolvePropSport } from "../../utils/mlbOnlyMode.js";

function propMergeKey(prop = {}) {
  return buildPlayerStatKey(prop.playerName, prop.statType || prop.market, extractPlayerId(prop));
}

function attachProjectionFields(prop = {}, projectionRow = {}) {
  const projection = Number(projectionRow.projection ?? projectionRow.projectedValue);
  if (!Number.isFinite(projection) || projection <= 0) return prop;

  const mergeKey = projectionRow.mergeKey || propMergeKey(prop);
  const projectionForStatType =
    projectionRow.propLabel || prop.statType || prop.market || prop.propType || "";

  if (!statTypesAlign(prop.statType || prop.market, projectionForStatType)) {
    return {
      ...prop,
      projection: null,
      projectedValue: null,
      projectionStatus: "missing",
      projectionSource: "stat-type-mismatch",
      projectionMerged: false,
    };
  }

  return {
    ...prop,
    projection,
    projectedValue: projection,
    team: prop.team || projectionRow.team || "",
    playerId: prop.playerId ?? projectionRow.playerId ?? extractPlayerId(prop) ?? prop.sportsDataPlayerId,
    sportsDataPlayerId: prop.sportsDataPlayerId ?? projectionRow.playerId,
    projectionSource: projectionRow.projectionSource || prop.projectionSource || "merged",
    projectionForStatType,
    edge:
      projectionRow.edge ??
      (Number.isFinite(Number(prop.line)) ? Number((projection - prop.line).toFixed(3)) : prop.edge),
    confidenceScore: projectionRow.confidence ?? prop.confidenceScore,
    mergeKey,
    projectionMerged: true,
    projectionStatus: "matched",
  };
}

function resolveProfileProjectionRow(profile = {}, prop = {}) {
  if (!profile) return null;

  const profileStat = profile.statType || profile.market || "";
  if (!statTypesAlign(prop.statType || prop.market, profileStat)) return null;

  const projection = Number(profile.projection ?? profile.projectedValue);
  if (!Number.isFinite(projection) || projection <= 0) return null;

  const sourceKey = String(profile.projectionSource || "").toLowerCase();
  const projectionSource =
    sourceKey && !/missing|failed|no stat|unavailable/.test(sourceKey)
      ? profile.projectionSource
      : "stats-map";

  return {
    projection,
    projectionSource,
    propLabel: profileStat,
    team: profile.team || prop.team,
    playerId: profile.playerId ?? extractPlayerId(prop),
    confidence: profile.confidence ?? profile.confidenceScore,
    mergeKey: buildPlayerStatKey(profile.playerName || prop.playerName, profileStat, profile.playerId),
  };
}

function indexProjectionRow(map, row, propLike = {}) {
  if (!row?.projection) return;
  buildPropLookupKeys(propLike).forEach((key) => map.set(key, row));
  const mergeKey = row.mergeKey || buildPlayerStatKey(propLike.playerName, propLike.statType, extractPlayerId(propLike));
  if (mergeKey) map.set(mergeKey, row);
}

export function buildStatsMapProjectionLookup(statsMap = null) {
  const byKey = new Map();
  if (!(statsMap instanceof Map)) return { byKey, projectionCount: 0 };

  statsMap.forEach((profile) => {
    if (!profile?.playerName) return;
    const propLike = {
      playerName: profile.playerName,
      statType: profile.statType || profile.market,
      playerId: profile.playerId,
      sport: profile.sport || "MLB",
      line: profile.line,
    };
    const row = resolveProfileProjectionRow(profile, propLike);
    if (!row) return;
    indexProjectionRow(byKey, row, propLike);
  });

  return { byKey, projectionCount: byKey.size };
}

export function buildSeasonProjectionLookup(seasonStats = []) {
  const byKey = new Map();

  (seasonStats || []).forEach((row) => {
    if (!row?.Name) return;
    const playerName = normalizePlayerName(row.Name);

    const statLabels = [
      "Hits",
      "Home Runs",
      "RBIs",
      "Runs",
      "Total Bases",
      "Strikeouts",
      "Walks",
      "Walks Allowed",
      "Fantasy Score",
      "Hits+Runs+RBIs",
      "Pitcher Outs",
      "Earned Runs",
      "Earned Runs Allowed",
      "Stolen Bases",
      "Doubles",
      "Singles",
      "Hits Allowed",
    ];

    statLabels.forEach((label) => {
      const computed = computeProjectionForProp(
        { playerName: row.Name, statType: label, PlayerID: row.PlayerID, team: row.Team },
        [row],
        { logDebug: false }
      );
      if (computed.projection == null || computed.projection <= 0) return;
      const mergeKey = buildPlayerStatKey(row.Name, label, row.PlayerID);
      const projectionRow = {
        projection: computed.projection,
        projectionSource: computed.projectionSource || "sportsdataio-season",
        team: row.Team,
        playerId: row.PlayerID,
        propLabel: label,
        mergeKey,
      };
      byKey.set(mergeKey, projectionRow);
      byKey.set(`${normalizeMergeId(row.PlayerID)}|${normalizeMergeStatType(label)}`, projectionRow);
      byKey.set(`${playerName}|${normalizeMergeStatType(label)}`, projectionRow);
    });
  });

  return { byKey, seasonCount: seasonStats.length, projectionCount: byKey.size };
}

function resolveFromKeyMap(prop = {}, keyMap = null) {
  if (!(keyMap instanceof Map) || !keyMap.size) return null;
  for (const key of buildPropLookupKeys(prop)) {
    const row = keyMap.get(key);
    if (!row?.projection || row.projection <= 0) continue;
    if (row.propLabel && !statTypesAlign(prop.statType || prop.market, row.propLabel)) continue;
    if (row.mergeKey && row.mergeKey !== propMergeKey(prop) && row.propLabel) continue;
    return row;
  }
  return null;
}

function resolveLookupRow(prop = {}, lookup = {}) {
  const fromKey = resolveFromKeyMap(prop, lookup.byKey);
  if (fromKey?.projection > 0) return fromKey;

  const playerName = prop.playerName || prop.player || "";
  const statKey = propMergeKey(prop);
  const propLabel = resolveSportsDataPropLabel(prop);
  if (!propLabel) return null;

  const statRow = findSeasonStatRow(lookup.seasonStats || [], {
    playerName,
    playerId: prop.playerId ?? prop.sportsDataPlayerId,
  });
  if (!statRow) return null;

  const computed = computeProjectionForProp({ ...prop, team: prop.team || statRow.Team }, [statRow], {
    logDebug: false,
  });
  if (computed.projection != null && computed.projection > 0) {
    return {
      projection: computed.projection,
      projectionSource: computed.projectionSource || "sportsdataio-season",
      team: computed.team || statRow.Team,
      playerId: statRow.PlayerID,
      propLabel: computed.propLabel || propLabel,
      mergeKey: statKey,
    };
  }

  return null;
}

function resolveStatsMapProjection(prop = {}, statsMap = null, statsLookup = null) {
  const fromIndex = resolveFromKeyMap(prop, statsLookup?.byKey);
  if (fromIndex) return fromIndex;

  if (!(statsMap instanceof Map)) return null;
  const profile = findStatProfile(statsMap, { ...prop, sport: resolvePropSport(prop) || prop.sport || "" });
  return resolveProfileProjectionRow(profile, prop);
}

export function logProjectionSchemaSamples(_props = [], _context = {}) {}

export function logRuntimeProjectionSample(_context = {}) {}

export function mergeProjectionsOntoProps(props = [], context = {}) {
  const seasonStats = context.seasonStats || [];
  const lookup = buildSeasonProjectionLookup(seasonStats);
  lookup.seasonStats = seasonStats;
  const statsLookup = buildStatsMapProjectionLookup(context.statsMap);

  const unmatchedKeys = [];
  const matchedSamples = [];
  let matchCount = 0;

  const merged = (props || []).map((prop) => {
    const mergeKey = propMergeKey(prop);
    const existing = Number(prop.projection ?? prop.projectedValue);
    const existingOk =
      prop.projectionMerged &&
      Number.isFinite(existing) &&
      existing > 0 &&
      (!prop.mergeKey || prop.mergeKey === mergeKey) &&
      statTypesAlign(prop.statType || prop.market, prop.projectionForStatType || prop.statType);

    if (existingOk) {
      matchCount += 1;
      if (matchedSamples.length < 5) {
        matchedSamples.push({
          playerName: prop.playerName,
          statType: prop.statType,
          projection: existing,
          source: prop.projectionSource || "pre-existing",
          mergeKey,
        });
      }
      return prop;
    }

    const baseProp =
      Number.isFinite(existing) && existing > 0 && !existingOk
        ? {
            ...prop,
            projection: null,
            projectedValue: null,
            projectionMerged: false,
            projectionSource: prop.projectionSource,
          }
        : prop;

    const fromStatsMap = resolveStatsMapProjection(baseProp, context.statsMap, statsLookup);
    const row = fromStatsMap || resolveLookupRow(baseProp, lookup);
    if (!row) {
      unmatchedKeys.push(mergeKey);
      return {
        ...baseProp,
        projection: null,
        projectedValue: null,
        projectionStatus: "missing",
        projectionMerged: false,
      };
    }

    matchCount += 1;
    const next = attachProjectionFields(baseProp, row);
    if (matchedSamples.length < 5) {
      matchedSamples.push({
        playerName: next.playerName,
        statType: next.statType,
        projection: next.projection,
        source: next.projectionSource,
        mergeKey: row.mergeKey || mergeKey,
      });
    }
    return next;
  });

  logProjectionMergeDiagnostics(merged, { limit: 20 });

  const debug = {
    rawCount: props.length,
    projectionLookupCount: lookup.projectionCount + statsLookup.projectionCount,
    seasonLookupCount: lookup.projectionCount,
    statsMapLookupCount: statsLookup.projectionCount,
    seasonStatRows: lookup.seasonCount,
    statsMapSize: context.statsMap instanceof Map ? context.statsMap.size : 0,
    matchCount,
    unmatchedCount: props.length - matchCount,
    unmatchedSample: unmatchedKeys.slice(0, 5),
    matchedSample: matchedSamples.slice(0, 5),
  };

  return { props: merged, debug, lookup, statsLookup };
}

export function indexPropsByMergeKey(props = []) {
  const map = new Map();
  (props || []).forEach((prop) => {
    buildPropLookupKeys(prop).forEach((key) => map.set(key, prop));
  });
  return map;
}

export function joinPropsWithProjectionRows(props = [], projectionRows = []) {
  const rowMap = new Map();
  (projectionRows || []).forEach((row) => {
    indexProjectionRow(rowMap, row, row);
  });

  let matchCount = 0;
  const unmatched = [];
  const matchedSamples = [];

  const merged = (props || []).map((prop) => {
    const row = resolveFromKeyMap(prop, rowMap);
    if (!row) {
      unmatched.push(buildPlayerStatKey(prop.playerName, prop.statType, extractPlayerId(prop)));
      return prop;
    }
    const projection = Number(row.projection ?? row.projectedValue);
    if (!Number.isFinite(projection) || projection <= 0) {
      unmatched.push(buildPlayerStatKey(prop.playerName, prop.statType, extractPlayerId(prop)));
      return prop;
    }
    matchCount += 1;
    const next = attachProjectionFields(prop, { ...row, mergeKey: row.mergeKey });
    if (matchedSamples.length < 5) {
      matchedSamples.push({
        playerName: next.playerName,
        statType: next.statType,
        projection: next.projection,
      });
    }
    return next;
  });

  return { props: merged, matchCount, unmatchedSample: unmatched.slice(0, 5), matchedSample: matchedSamples };
}

export function buildPipelineMergeDiagnostics(props = [], mergeDebug = {}) {
  const withProjection = (props || []).filter((prop) => {
    const value = Number(prop.projection ?? prop.projectedValue ?? prop.last5Average ?? prop.seasonAverage);
    return Number.isFinite(value) && value > 0;
  });
  const missingProjection = (props || []).filter((prop) => {
    const value = Number(prop.projection ?? prop.projectedValue ?? prop.last5Average ?? prop.seasonAverage);
    return !Number.isFinite(value) || value <= 0;
  });
  const missingTeam = (props || []).filter((prop) => !String(prop.team || "").trim());

  return {
    rawCount: props.length,
    normalizedCount: props.length,
    projectionLookupCount: mergeDebug.projectionLookupCount ?? 0,
    matchCount: mergeDebug.matchCount ?? withProjection.length,
    withProjections: withProjection.length,
    missingProjectionCount: missingProjection.length,
    missingTeamCount: missingTeam.length,
    unmatchedSample: mergeDebug.unmatchedSample ?? [],
    matchedSample: mergeDebug.matchedSample ?? withProjection.slice(0, 5).map((prop) => ({
      playerName: prop.playerName,
      statType: prop.statType,
      projection: prop.projection ?? prop.projectedValue,
      team: prop.team,
      projectionSource: prop.projectionSource,
    })),
  };
}

/** Debug: player, statType, projection source, value — first N merged props. */
export function logProjectionMergeDiagnostics(props = [], { limit = 20 } = {}) {
  const samples = (props || []).slice(0, limit).map((prop) => ({
    player: prop.playerName || prop.player,
    statType: prop.statType || prop.market,
    projectionSource: prop.projectionSource || "none",
    projection: prop.projection ?? prop.projectedValue ?? null,
    mergeKey: prop.mergeKey || propMergeKey(prop),
    projectionForStatType: prop.projectionForStatType || null,
  }));
  console.info("[projection-merge] first props", samples);
  return samples;
}

export function logPipelineMergeDiagnostics(label, props = [], mergeDebug = {}) {
  const diagnostics = buildPipelineMergeDiagnostics(props, mergeDebug);
  console.info(label, diagnostics);
  return diagnostics;
}
