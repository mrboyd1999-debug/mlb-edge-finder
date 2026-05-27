/**
 * Join raw props to projections using stable player/stat keys.
 */

import { computeProjectionForProp, findSeasonStatRow, resolveSportsDataPropLabel } from "../../../api/lib/sportsDataMlbStatProjection.js";
import { buildStatFallbackProjection } from "./statBasedFallbackProjection.js";
import { findStatProfile } from "../playerStats.js";
import { normalizePlayerName } from "../../utils/playerNames.js";
import { buildPropMergeKey, buildPlayerStatKey, normalizeMergeId } from "../../utils/propMergeKeys.js";

function attachProjectionFields(prop = {}, projectionRow = {}) {
  const projection = Number(projectionRow.projection ?? projectionRow.projectedValue);
  if (!Number.isFinite(projection) || projection <= 0) return prop;
  return {
    ...prop,
    projection,
    projectedValue: projection,
    team: prop.team || projectionRow.team || "",
    playerId: prop.playerId ?? projectionRow.playerId ?? prop.sportsDataPlayerId,
    sportsDataPlayerId: prop.sportsDataPlayerId ?? projectionRow.playerId,
    projectionSource: projectionRow.projectionSource || prop.projectionSource || "merged",
    edge: projectionRow.edge ?? (Number.isFinite(Number(prop.line)) ? Number((projection - prop.line).toFixed(3)) : prop.edge),
    confidenceScore: projectionRow.confidence ?? prop.confidenceScore,
    mergeKey: projectionRow.mergeKey || prop.mergeKey,
    projectionMerged: true,
  };
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
      byKey.set(mergeKey, {
        projection: computed.projection,
        projectionSource: computed.projectionSource || "sportsdataio-season",
        team: row.Team,
        playerId: row.PlayerID,
        propLabel: label,
        mergeKey,
      });
    });
  });

  return { byKey, byPlayerId, byPlayerName, seasonCount: seasonStats.length, projectionCount: byKey.size };
}

function resolveLookupRow(prop = {}, lookup = {}) {
  const playerName = prop.playerName || prop.player || "";
  const playerId = normalizeMergeId(prop.playerId ?? prop.sportsDataPlayerId ?? prop.PlayerID);
  const statKey = buildPlayerStatKey(playerName, prop.statType || prop.market, playerId);

  if (lookup.byKey?.has(statKey)) return lookup.byKey.get(statKey);

  const statRow =
    (playerId && lookup.byPlayerId?.get(playerId)) ||
    lookup.byPlayerName?.get(normalizePlayerName(playerName)) ||
    findSeasonStatRow(lookup.seasonStats || [], { playerName, playerId: prop.playerId });

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

function resolveStatsMapProjection(prop = {}, statsMap = null) {
  if (!(statsMap instanceof Map)) return null;
  const profile = findStatProfile(statsMap, { ...prop, sport: "MLB" });
  const projection = Number(profile?.projection ?? profile?.projectedValue);
  if (!profile || !Number.isFinite(projection) || projection <= 0) return null;
  return {
    projection,
    projectionSource: profile.projectionSource || "mlb-verified-engine",
    team: profile.team || prop.team,
    playerId: profile.playerId,
    confidence: profile.confidence ?? profile.confidenceScore,
    mergeKey: buildPropMergeKey(prop),
  };
}

export function mergeProjectionsOntoProps(props = [], context = {}) {
  const seasonStats = context.seasonStats || [];
  const lookup = buildSeasonProjectionLookup(seasonStats);
  lookup.seasonStats = seasonStats;

  const unmatchedKeys = [];
  let matchCount = 0;

  const merged = (props || []).map((prop) => {
    const existing = Number(prop.projection ?? prop.projectedValue);
    if (Number.isFinite(existing) && existing > 0) {
      matchCount += 1;
      return prop;
    }

    const fromStatsMap = resolveStatsMapProjection(prop, context.statsMap);
    const row = fromStatsMap || resolveLookupRow(prop, lookup);
    if (!row) {
      unmatchedKeys.push(buildPropMergeKey(prop));
      return prop;
    }

    matchCount += 1;
    return attachProjectionFields(prop, row);
  });

  const debug = {
    rawCount: props.length,
    projectionLookupCount: lookup.projectionCount,
    seasonStatRows: lookup.seasonCount,
    matchCount,
    unmatchedCount: props.length - matchCount,
    unmatchedSample: unmatchedKeys.slice(0, 5),
  };

  console.info("[MLB Projection Merge]", debug);
  if (debug.unmatchedSample.length) {
    console.info("[MLB Projection Merge] first unmatched keys", debug.unmatchedSample);
  }

  return { props: merged, debug, lookup };
}

export function indexPropsByMergeKey(props = []) {
  const map = new Map();
  (props || []).forEach((prop) => {
    const key = buildPropMergeKey(prop);
    if (key) map.set(key, prop);
  });
  return map;
}

export function joinPropsWithProjectionRows(props = [], projectionRows = []) {
  const rowMap = new Map();
  (projectionRows || []).forEach((row) => {
    const key = row.mergeKey || buildPropMergeKey(row);
    if (key) rowMap.set(key, row);
  });

  let matchCount = 0;
  const unmatched = [];

  const merged = (props || []).map((prop, index) => {
    const key = buildPropMergeKey(prop);
    const row = rowMap.get(key) || projectionRows[index];
    if (!row) {
      unmatched.push(key);
      return prop;
    }
    const projection = Number(row.projection ?? row.projectedValue);
    if (!Number.isFinite(projection) || projection <= 0) {
      unmatched.push(key);
      return prop;
    }
    matchCount += 1;
    return attachProjectionFields(prop, { ...row, mergeKey: key });
  });

  console.info("[MLB Projection Join]", {
    rawCount: props.length,
    projectionRows: projectionRows.length,
    matchCount,
    unmatchedSample: unmatched.slice(0, 5),
  });

  return { props: merged, matchCount, unmatchedSample: unmatched.slice(0, 5) };
}
