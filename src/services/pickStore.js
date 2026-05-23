const HISTORY_KEY = "props-of-the-day-history";
const PARLAY_HISTORY_KEY = "dfs-pickem-parlay-history";
const DFS_CACHE_KEY = "dfs-pickem-active-board-cache-v18";
const LINE_MOVEMENT_KEY = "dfs-pickem-line-movement";
const MANUAL_STATS_KEY = "dfs-pick-manual-stats";
const PROP_HISTORY_KEY = "dfs-prop-history-v1";
export const DFS_CACHE_TTL_MS = 3 * 60 * 1000;
export const MAX_PROP_HISTORY = 500;

import { slimPropForUi } from "../utils/renderProp.js";
import { MLB_ONLY_MODE, sanitizeBoardForMlbOnly } from "../utils/mlbOnlyMode.js";

function isMlbLineMovementKey(key = "") {
  const parts = String(key).split("|");
  return parts[1] === "mlb";
}

export function readHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("[DFS Pick'em] History corrupted — resetting safely.", error);
    try {
      window.localStorage.removeItem(HISTORY_KEY);
    } catch {
      // ignore
    }
    return [];
  }
}

export function writeHistory(history) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn("[DFS Pick'em] Could not save pick history.", error);
  }
}

export function readParlayHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PARLAY_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeParlayHistory(history) {
  try {
    window.localStorage.setItem(PARLAY_HISTORY_KEY, JSON.stringify(history.slice(0, 150)));
  } catch (error) {
    console.warn("[DFS Pick'em] Could not save parlay history.", error);
  }
}

export function readCachedBoard(defaultSourceStatus = {}, { allowExpired = false } = {}) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DFS_CACHE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const updatedAt = new Date(parsed.updatedAt).getTime();
    if (!Number.isFinite(updatedAt)) return null;
    if (!allowExpired && Date.now() - updatedAt > DFS_CACHE_TTL_MS) return null;
    if (isFailedEmptyBoard(parsed)) return null;
    return sanitizeBoardForMlbOnly({
      props: Array.isArray(parsed.props) ? parsed.props : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      streakProps: Array.isArray(parsed.streakProps) ? parsed.streakProps : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      sourceStatus: parsed.sourceStatus && typeof parsed.sourceStatus === "object" ? parsed.sourceStatus : defaultSourceStatus,
      sourceHealth: parsed.sourceHealth && typeof parsed.sourceHealth === "object" ? parsed.sourceHealth : {},
      debugInfo: parsed.debugInfo && typeof parsed.debugInfo === "object" ? parsed.debugInfo : null,
      updatedAt: parsed.updatedAt,
    });
  } catch {
    return null;
  }
}

export function compactPropForStorage(prop) {
  if (!prop || typeof prop !== "object") return prop;
  return slimPropForUi(prop);
}

export function writeCachedBoard(board) {
  try {
    if (isFailedEmptyBoard(board)) return;
    const scopedBoard = sanitizeBoardForMlbOnly(board);
    const compactBoard = {
      ...scopedBoard,
      props: (scopedBoard.props || []).slice(0, 100).map(compactPropForStorage),
      watchlist: (scopedBoard.watchlist || []).slice(0, 60).map(compactPropForStorage),
      streakProps: (scopedBoard.streakProps || []).slice(0, 180).map(compactPropForStorage),
    };
    window.localStorage.setItem(DFS_CACHE_KEY, JSON.stringify(compactBoard));
  } catch (error) {
    console.warn("[DFS Pick'em] Cache skipped.", error);
  }
}

function isFailedEmptyBoard(board = {}) {
  const hasVisibleProps =
    (Array.isArray(board.props) && board.props.length > 0) ||
    (Array.isArray(board.watchlist) && board.watchlist.length > 0) ||
    (Array.isArray(board.streakProps) && board.streakProps.length > 0);
  if (hasVisibleProps) return false;
  const prizePicksStatus = String(board.sourceStatus?.PrizePicks || "");
  const warnings = Array.isArray(board.warnings) ? board.warnings.join(" ") : "";
  return /failed/i.test(prizePicksStatus) || /could not load prizepicks|prizepicks .*failed/i.test(warnings);
}

export function clearBoardCache() {
  try {
    window.localStorage.removeItem(DFS_CACHE_KEY);
  } catch {
    // ignore
  }
}

export function readLineMovement() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LINE_MOVEMENT_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    if (!MLB_ONLY_MODE) return parsed;
    const scoped = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (isMlbLineMovementKey(key)) scoped[key] = value;
    });
    if (Object.keys(scoped).length !== Object.keys(parsed).length) {
      try {
        window.localStorage.setItem(LINE_MOVEMENT_KEY, JSON.stringify(scoped));
      } catch {
        // ignore
      }
    }
    return scoped;
  } catch {
    return {};
  }
}

export function writeLineMovement(movement) {
  try {
    window.localStorage.setItem(LINE_MOVEMENT_KEY, JSON.stringify(movement));
  } catch {
    // ignore
  }
}

export function lineMovementKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.startTime].join("|").toLowerCase();
}

export function readManualStatsMap() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MANUAL_STATS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeManualStatsMap(map) {
  try {
    window.localStorage.setItem(MANUAL_STATS_KEY, JSON.stringify(map || {}));
  } catch (error) {
    console.warn("[DFS Pick'em] Could not save manual stats.", error);
  }
}

export function readManualStatsForProp(propId) {
  const map = readManualStatsMap();
  return map[propId] || null;
}

export function writeManualStatsForProp(propId, stats) {
  const map = readManualStatsMap();
  if (!stats || typeof stats !== "object") {
    delete map[propId];
  } else {
    map[propId] = stats;
  }
  writeManualStatsMap(map);
  return map[propId] || null;
}

export function readPropHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROP_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writePropHistory(rows = []) {
  try {
    window.localStorage.setItem(PROP_HISTORY_KEY, JSON.stringify(rows.slice(0, MAX_PROP_HISTORY)));
  } catch {
    // ignore
  }
}

export function recordPropHistoryEntry(prop = {}, outcome = {}) {
  if (!prop?.playerName || !prop?.statType) return readPropHistory();
  const history = readPropHistory();
  const entry = {
    id: `${prop.platform || "unknown"}|${prop.playerName}|${prop.statType}|${prop.line}|${Date.now()}`,
    platform: prop.platform || "",
    sport: prop.sport || "MLB",
    playerName: prop.playerName,
    statType: prop.statType,
    line: prop.line,
    side: prop.bestPick || prop.side || "",
    confidence: prop.confidenceScore ?? prop.confidence ?? null,
    edge: prop.edge ?? null,
    timestamp: new Date().toISOString(),
    resultStatus: outcome.resultStatus || outcome.status || "Pending",
    hit: outcome.hit ?? null,
    openingLine: prop.lineMovement?.openingLine ?? prop.line,
    closingLine: prop.line,
  };
  history.unshift(entry);
  writePropHistory(history);
  return history;
}

export { HISTORY_KEY, PARLAY_HISTORY_KEY, DFS_CACHE_KEY, LINE_MOVEMENT_KEY, MANUAL_STATS_KEY };
