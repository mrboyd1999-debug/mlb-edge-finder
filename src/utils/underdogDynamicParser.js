/**
 * Dynamic Underdog schema detection — no hardcoded response shape.
 */

import { discoverArrayCollections, walkPayloadArrays } from "./rawResponseDebug.js";
import { unwrapUnderdogPayload } from "./underdogEnvelope.js";

function unwrapRoot(payload) {
  return unwrapUnderdogPayload(payload);
}

function staticLineExtract(payload) {
  const normalized = unwrapRoot(payload);
  if (Array.isArray(normalized)) return normalized;
  const lines =
    normalized?.over_under_lines ||
    normalized?.overUnders ||
    normalized?.data ||
    normalized?.items ||
    normalized?.results ||
    normalized?.props ||
    [];
  return Array.isArray(lines) ? lines : [];
}

function finiteLine(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function lineLikeScore(item = {}) {
  if (!item || typeof item !== "object") return 0;
  let score = 0;
  const paths = [
    item.stat_value,
    item.line,
    item.value,
    item.over_under?.stat_value,
    item.over_under?.line,
    item.attributes?.stat_value,
    item.attributes?.line,
    item.appearance_stat?.stat_value,
  ];
  paths.forEach((v) => {
    if (Number.isFinite(finiteLine(v))) score += 2;
  });
  if (item.appearance_id || item.over_under?.appearance_id || item.player_name || item.over_under?.title) score += 1;
  return score;
}

export function discoverUnderdogLineRecords(payload) {
  const root = unwrapRoot(payload);
  const staticRecords = staticLineExtract(payload);
  if (staticRecords.length) {
    return { records: staticRecords, path: "static", schema: discoverArrayCollections(root) };
  }

  let best = { records: [], path: "", score: 0 };
  walkPayloadArrays(root, (arr, path) => {
    if (!arr?.length) return;
    const score = arr.slice(0, 8).reduce((sum, item) => sum + lineLikeScore(item), 0);
    if (score > best.score) best = { records: arr, path, score };
  });

  return {
    records: best.records || [],
    path: best.path || "none",
    schema: discoverArrayCollections(root),
  };
}

function mapById(rows = []) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const id = row?.id ?? row?.uuid;
    if (id != null) map.set(String(id), row);
  });
  return map;
}

function playerLike(row = {}) {
  return Boolean(row?.full_name || row?.name || (row?.first_name && row?.last_name));
}

export function buildDynamicUnderdogLookupMaps(payload) {
  const normalized = unwrapRoot(payload);
  const overUnderRows = normalized?.over_under_lines || normalized?.overUnders || normalized?.over_under || [];
  const maps = {
    players: mapById(normalized?.players || normalized?.athletes || []),
    games: mapById(normalized?.games || normalized?.matches || []),
    appearances: mapById(normalized?.appearances || []),
    teams: mapById(normalized?.teams || []),
    overUnders: mapById(Array.isArray(overUnderRows) ? overUnderRows : []),
  };

  if (maps.players.size && maps.appearances.size) return maps;

  walkPayloadArrays(normalized, (arr, path) => {
    if (!arr?.length) return;
    const sample = arr[0] || {};
    if (/player|athlete/i.test(path) || playerLike(sample)) {
      arr.forEach((row) => {
        const id = row?.id ?? row?.uuid ?? row?.player_id;
        if (id != null) maps.players.set(String(id), row);
      });
    }
    if (/appearance/i.test(path)) {
      arr.forEach((row) => {
        const id = row?.id ?? row?.uuid;
        if (id != null) maps.appearances.set(String(id), row);
      });
    }
    if (/game|match/i.test(path)) {
      arr.forEach((row) => {
        const id = row?.id ?? row?.uuid ?? row?.game_id;
        if (id != null) maps.games.set(String(id), row);
      });
    }
    if (/team/i.test(path)) {
      arr.forEach((row) => {
        const id = row?.id ?? row?.uuid ?? row?.team_id;
        if (id != null) maps.teams.set(String(id), row);
      });
    }
  });

  return maps;
}

export function flattenUnderdogLineRecord(raw = {}) {
  if (!raw || typeof raw !== "object") return raw;
  const ou = raw.over_under || raw.overUnder;
  const appearanceStat = ou?.appearance_stat || raw.appearance_stat;
  const hoisted = {
    appearance_id: appearanceStat?.appearance_id || raw.appearance_id,
    appearance_stat: appearanceStat,
    stat_type: appearanceStat?.display_stat || appearanceStat?.stat,
  };
  if (ou && typeof ou === "object") {
    return { ...ou, ...hoisted, ...raw, over_under: ou };
  }
  if (raw.attributes && typeof raw.attributes === "object") {
    return { ...raw.attributes, ...hoisted, ...raw, attributes: raw.attributes };
  }
  return { ...hoisted, ...raw };
}
