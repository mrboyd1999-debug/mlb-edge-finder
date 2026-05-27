/**
 * Join raw props to projections using stable player/stat keys discovered from runtime schema.
 */

import { computeProjectionForProp, findSeasonStatRow, resolveSportsDataPropLabel } from "../../../api/lib/sportsDataMlbStatProjection.js";
import { buildStatFallbackProjection, computeConservativeStatProjection } from "./statBasedFallbackProjection.js";
import { findStatProfile } from "../playerStats.js";
import { normalizePlayerName } from "../../utils/playerNames.js";
import {
  buildPropMergeKey,
  buildPlayerStatKey,
  buildPropLookupKeys,
  extractPlayerId,
  normalizeMergeId,
  normalizeMergeStatType,
} from "../../utils/propMergeKeys.js";

export const PROJECTION_JOIN_DEBUG = import.meta.env?.DEV === true;

function attachProjectionFields(prop = {}, projectionRow = {}) {
  const projection = Number(projectionRow.projection ?? projectionRow.projectedValue);
  if (!Number.isFinite(projection) || projection <= 0) return prop;
  return {
    ...prop,
    projection,
    projectedValue: projection,
    team: prop.team || projectionRow.team || "",
    playerId: prop.playerId ?? projectionRow.playerId ?? extractPlayerId(prop) ?? prop.sportsDataPlayerId,
    sportsDataPlayerId: prop.sportsDataPlayerId ?? projectionRow.playerId,
    projectionSource: projectionRow.projectionSource || prop.projectionSource || "merged",
    edge:
      projectionRow.edge ??
      (Number.isFinite(Number(prop.line)) ? Number((projection - prop.line).toFixed(3)) : prop.edge),
    confidenceScore: projectionRow.confidence ?? prop.confidenceScore,
    mergeKey: projectionRow.mergeKey || prop.mergeKey,
    projectionMerged: true,
  };
}

function resolveProfileProjectionRow(profile = {}, prop = {}) {
  if (!profile) return null;

  let projection = Number(profile.projection ?? profile.projectedValue);
  if (!Number.isFinite(projection) || projection <= 0) {
    projection = computeConservativeStatProjection({
      last5Avg: profile.last5Average,
      seasonAvg: profile.seasonAverage,
      line: prop.line ?? profile.line,
    });
  }

  if (!Number.isFinite(projection) || projection <= 0) return null;

  return {
    projection,
    projectionSource: profile.projectionSource || profile.source || "stats-map",
    team: profile.team || prop.team,
    playerId: profile.playerId ?? extractPlayerId(prop),
    confidence: profile.confidence ?? profile.confidenceScore,
    mergeKey: buildPlayerStatKey(profile.playerName || prop.playerName, profile.statType || prop.statType, profile.playerId),
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
  const byPlayerId = new Map();
  const byPlayerName = new Map();

  (seasonStats || []).forEach((row) => {
    if (!row?.Name) return;
    const playerId = normalizeMergeId(row.PlayerID);
    const playerName = normalizePlayerName(row.Name);
    byPlayerId.set(playerId, row);
    if (!byPlayerName.has(playerName)) byPlayerName.set(playerName, row);

    const statLabels = [
      "Hits",
      "Home Runs",
      "RBIs",
      "Runs",
      "Total Bases",
      "Strikeouts",
      "Walks",
      "Fantasy Score",
      "Hits+Runs+RBIs",
      "Pitcher Outs",
      "Earned Runs",
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

  return { byKey, byPlayerId, byPlayerName, seasonCount: seasonStats.length, projectionCount: byKey.size };
}

function resolveFromKeyMap(prop = {}, keyMap = null) {
  if (!(keyMap instanceof Map) || !keyMap.size) return null;
  for (const key of buildPropLookupKeys(prop)) {
    const row = keyMap.get(key);
    if (row?.projection > 0) return row;
  }
  return null;
}

function resolveLookupRow(prop = {}, lookup = {}) {
  const playerName = prop.playerName || prop.player || "";
  const playerId = extractPlayerId(prop);
  const statKey = buildPlayerStatKey(playerName, prop.statType || prop.market, playerId);

  if (lookup.byKey?.has(statKey)) return lookup.byKey.get(statKey);

  const statRow =
    (playerId && lookup.byPlayerId?.get(playerId)) ||
    lookup.byPlayerName?.get(normalizePlayerName(playerName)) ||
    findSeasonStatRow(lookup.seasonStats || [], { playerName, playerId: prop.playerId ?? prop.sportsDataPlayerId });

  if (!statRow) return null;

  const propLabel = resolveSportsDataPropLabel(prop);
  const computed = computeProjectionForProp({ ...prop, team: prop.team || statRow.Team }, [statRow], {
    logDebug: false,
  });
  if (computed.projection != null && computed.projection > 0) {
    return {
      projection: computed.projection,
      projectionSource: computed.projectionSource || "sportsdataio-season",
      team: computed.team || statRow.Team,
      playerId: statRow.PlayerID,
      propLabel,
      mergeKey: statKey,
    };
  }

  const fallback = buildStatFallbackProjection({ ...prop, team: prop.team || statRow.Team }, statRow, propLabel);
  if (fallback?.projection > 0) {
    return {
      projection: fallback.projection,
      projectionSource: fallback.projectionSource,
      team: statRow.Team,
      playerId: statRow.PlayerID,
      mergeKey: statKey,
    };
  }

  return null;
}

function resolveStatsMapProjection(prop = {}, statsMap = null, statsLookup = null) {
  const fromIndex = resolveFromKeyMap(prop, statsLookup?.byKey);
  if (fromIndex) return fromIndex;

  if (!(statsMap instanceof Map)) return null;
  const profile = findStatProfile(statsMap, { ...prop, sport: "MLB" });
  return resolveProfileProjectionRow(profile, prop);
}

export function logProjectionSchemaSamples(props = [], context = {}) {
  const rawSample = (props || []).slice(0, 5).map((prop) => ({
    keys: Object.keys(prop || {}).sort(),
    playerName: prop.playerName,
    playerId: extractPlayerId(prop),
    statType: prop.statType,
    line: prop.line,
    lineId: prop.id,
    sourceId: prop.sourceId,
    lookupKeys: buildPropLookupKeys(prop).slice(0, 6),
  }));

  const seasonStats = context.seasonStats || [];
  const seasonSample = seasonStats.slice(0, 5).map((row) => ({
    keys: Object.keys(row || {}).sort(),
    Name: row?.Name,
    PlayerID: row?.PlayerID,
    Team: row?.Team,
  }));

  const statsProfiles =
    context.statsMap instanceof Map ? [...context.statsMap.values()].slice(0, 5) : [];
  const projectionSample = statsProfiles.map((profile) => ({
    keys: Object.keys(profile || {}).sort(),
    playerName: profile?.playerName,
    statType: profile?.statType,
    projection: profile?.projection,
    last5Average: profile?.last5Average,
    seasonAverage: profile?.seasonAverage,
    sparse: profile?.sparse,
    lookupKeys: buildPropLookupKeys({
      playerName: profile?.playerName,
      statType: profile?.statType,
      playerId: profile?.playerId,
      sport: profile?.sport,
    }).slice(0, 4),
  }));

  console.info("[MLB Projection Schema] first 5 raw props", rawSample);
  console.info("[MLB Projection Schema] first 5 season stat rows", seasonSample);
  console.info("[MLB Projection Schema] first 5 statsMap profiles", projectionSample);
}

export function mergeProjectionsOntoProps(props = [], context = {}) {
  const seasonStats = context.seasonStats || [];
  const lookup = buildSeasonProjectionLookup(seasonStats);
  lookup.seasonStats = seasonStats;
  const statsLookup = buildStatsMapProjectionLookup(context.statsMap);

  logProjectionSchemaSamples(props, context);

  const unmatchedKeys = [];
  const matchedSamples = [];
  let matchCount = 0;

  const merged = (props || []).map((prop) => {
    const existing = Number(prop.projection ?? prop.projectedValue);
    if (Number.isFinite(existing) && existing > 0) {
      matchCount += 1;
      if (matchedSamples.length < 5) {
        matchedSamples.push({
          playerName: prop.playerName,
          statType: prop.statType,
          projection: existing,
          source: prop.projectionSource || "pre-existing",
          mergeKey: buildPlayerStatKey(prop.playerName, prop.statType, extractPlayerId(prop)),
        });
      }
      return prop;
    }

    const fromStatsMap = resolveStatsMapProjection(prop, context.statsMap, statsLookup);
    const row = fromStatsMap || resolveFromKeyMap(prop, lookup.byKey) || resolveLookupRow(prop, lookup);
    if (!row) {
      unmatchedKeys.push(buildPlayerStatKey(prop.playerName, prop.statType, extractPlayerId(prop)));
      return prop;
    }

    matchCount += 1;
    const next = attachProjectionFields(prop, row);
    if (matchedSamples.length < 5) {
      matchedSamples.push({
        playerName: next.playerName,
        statType: next.statType,
        projection: next.projection,
        source: next.projectionSource,
        mergeKey: row.mergeKey || buildPlayerStatKey(prop.playerName, prop.statType, extractPlayerId(prop)),
      });
    }
    return next;
  });

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

  console.info("[MLB Projection Merge]", debug);
  if (debug.unmatchedSample.length) {
    console.info("[MLB Projection Merge] first unmatched keys", debug.unmatchedSample);
  }
  if (debug.matchedSample.length) {
    console.info("[MLB Projection Merge] matched samples", debug.matchedSample);
  }

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

  console.info("[MLB Projection Join]", {
    rawCount: props.length,
    projectionRows: projectionRows.length,
    matchCount,
    unmatchedSample: unmatched.slice(0, 5),
    matchedSample: matchedSamples,
  });

  return { props: merged, matchCount, unmatchedSample: unmatched.slice(0, 5), matchedSample: matchedSamples };
}
