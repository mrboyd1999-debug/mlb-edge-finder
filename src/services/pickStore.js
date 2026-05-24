import { slimPropForUi } from "../utils/renderProp.js";
import { MLB_ONLY_MODE, sanitizeBoardForMlbOnly } from "../utils/mlbOnlyMode.js";
import {
  MLB_CACHE_EXPIRED_MS,
  attachCacheMetadata,
  buildBoardCacheMetaFromFetch,
  prepareVerifiedCacheBoard,
  resolveBoardFreshnessTier,
  FRESHNESS_TIERS,
} from "./verifiedCacheFallback.js";

const HISTORY_KEY = "props-of-the-day-history";
const PARLAY_HISTORY_KEY = "dfs-pickem-parlay-history";
const DFS_CACHE_KEY = "dfs-pickem-active-board-cache-v18";
const LINE_MOVEMENT_KEY = "dfs-pickem-line-movement";
const MANUAL_STATS_KEY = "dfs-pick-manual-stats";
const PROP_HISTORY_KEY = "dfs-prop-history-v1";
export const DFS_CACHE_TTL_MS = 8 * 60 * 1000;
export const DFS_CACHE_VERIFIED_MAX_MS = MLB_CACHE_EXPIRED_MS;
export const MAX_PROP_HISTORY = 500;

function isMlbLineMovementKey(key = "") {
  const parts = String(key).split("|");
  return parts[1] === "mlb";
}

function normalizeStoredOutcomeRow(row = {}) {
  if (!row || typeof row !== "object") return null;
  const playerName = String(row.playerName || row.player || "").trim();
  if (!playerName) return null;
  const resultStatus = String(row.resultStatus || row.finalResult || row.result || "Pending");
  const statusText = String(row.status || resultStatus).toLowerCase();
  const status =
    statusText === "win" || statusText === "loss" || statusText === "push" || statusText === "void"
      ? statusText
      : resultStatus.toLowerCase() === "win"
        ? "win"
        : resultStatus.toLowerCase() === "loss"
          ? "loss"
          : resultStatus.toLowerCase() === "push"
            ? "push"
            : resultStatus.toLowerCase() === "void"
              ? "void"
              : "pending";
  return {
    ...row,
    playerName,
    player: playerName,
    resultStatus,
    finalResult: row.finalResult || resultStatus,
    result: row.result || resultStatus,
    status,
  };
}

export function readHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) throw new Error("invalid history shape");
    return parsed.map(normalizeStoredOutcomeRow).filter(Boolean);
  } catch (error) {
    console.warn("[DFS Pick'em] Outcome history corrupted — resetting safely.", error);
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

function readRawCachedBoard(defaultSourceStatus = {}) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DFS_CACHE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const updatedAt = new Date(parsed.updatedAt).getTime();
    if (!Number.isFinite(updatedAt)) return null;
    if (isFailedEmptyBoard(parsed)) return null;
    return sanitizeBoardForMlbOnly({
      props: Array.isArray(parsed.props) ? parsed.props : [],
      allDisplayProps: Array.isArray(parsed.allDisplayProps) ? parsed.allDisplayProps : Array.isArray(parsed.usableProps) ? parsed.usableProps : [],
      usableProps: Array.isArray(parsed.usableProps) ? parsed.usableProps : Array.isArray(parsed.allDisplayProps) ? parsed.allDisplayProps : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      nearQualification: Array.isArray(parsed.nearQualification) ? parsed.nearQualification : [],
      qualifiedReadyProps: Array.isArray(parsed.qualifiedReadyProps)
        ? parsed.qualifiedReadyProps
        : Array.isArray(parsed.readyProps)
          ? parsed.readyProps
          : [],
      acceptedPropsForRender: Array.isArray(parsed.acceptedPropsForRender)
        ? parsed.acceptedPropsForRender
        : Array.isArray(parsed.qualifiedReadyProps)
          ? parsed.qualifiedReadyProps
          : Array.isArray(parsed.readyProps)
            ? parsed.readyProps
            : [],
      streakProps: Array.isArray(parsed.streakProps) ? parsed.streakProps : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      degradedWarnings: Array.isArray(parsed.degradedWarnings) ? parsed.degradedWarnings : [],
      criticalWarnings: Array.isArray(parsed.criticalWarnings) ? parsed.criticalWarnings : [],
      sourceStatus: parsed.sourceStatus && typeof parsed.sourceStatus === "object" ? parsed.sourceStatus : defaultSourceStatus,
      sourceHealth: parsed.sourceHealth && typeof parsed.sourceHealth === "object" ? parsed.sourceHealth : {},
      debugInfo: parsed.debugInfo && typeof parsed.debugInfo === "object" ? parsed.debugInfo : null,
      updatedAt: parsed.updatedAt,
      verifiedAt: parsed.verifiedAt || parsed.cacheMetadata?.verifiedAt || parsed.updatedAt,
      cacheMetadata: parsed.cacheMetadata || null,
      cacheAnalytics: parsed.cacheAnalytics || parsed.cacheMetadata?.cacheAnalytics || null,
      cacheNotice: parsed.cacheNotice || "",
    });
  } catch {
    return null;
  }
}

export function readCachedBoard(defaultSourceStatus = {}, { allowExpired = false } = {}) {
  const raw = readRawCachedBoard(defaultSourceStatus);
  if (!raw) return null;
  const ageMs = Date.now() - new Date(raw.updatedAt).getTime();
  if (!allowExpired && ageMs > DFS_CACHE_TTL_MS) {
    const prepared = readVerifiedCacheBoard(defaultSourceStatus, { allowExpired: false });
    return prepared;
  }
  return prepareVerifiedCacheBoard(raw) || (allowExpired ? raw : null);
}

export function readVerifiedCacheBoard(defaultSourceStatus = {}, { allowExpired = false } = {}) {
  const raw = readRawCachedBoard(defaultSourceStatus);
  if (!raw) return null;
  const ageMs = Date.now() - new Date(raw.updatedAt).getTime();
  if (!allowExpired && ageMs > DFS_CACHE_VERIFIED_MAX_MS) return null;
  const tier = resolveBoardFreshnessTier(raw.updatedAt, raw.props?.[0]);
  if (!allowExpired && tier === FRESHNESS_TIERS.EXPIRED) return null;
  return prepareVerifiedCacheBoard(raw);
}

export function compactPropForStorage(prop) {
  if (!prop || typeof prop !== "object") return prop;
  return slimPropForUi(prop);
}

export function writeCachedBoard(board) {
  try {
    const parsedCount = (board?.allDisplayProps || board?.props || []).length;
    const qualifiedCount = (board?.qualifiedReadyProps || board?.readyProps || []).length;
    if (parsedCount === 0 && qualifiedCount === 0) return;
    if (isFailedEmptyBoard(board)) return;
    const scopedBoard = sanitizeBoardForMlbOnly(board);
    const hasAccepted =
      (scopedBoard.qualifiedReadyProps || []).length > 0 ||
      (scopedBoard.props || []).some((prop) => prop.isQualificationAccepted);
    const cacheMeta = buildBoardCacheMetaFromFetch({
      ...scopedBoard,
      updatedAt: scopedBoard.updatedAt || new Date().toISOString(),
    });
    const verifiedAt = cacheMeta.verifiedAt;
    const enrichList = (rows = []) =>
      rows.slice(0, 120).map((prop) => attachCacheMetadata(compactPropForStorage(prop), { verifiedAt, boardUpdatedAt: cacheMeta.updatedAt }));
    const compactBoard = {
      ...scopedBoard,
      verifiedAt,
      cacheMetadata: cacheMeta,
      cacheAnalytics: cacheMeta.cacheAnalytics,
      props: enrichList(scopedBoard.allDisplayProps?.length ? scopedBoard.allDisplayProps : scopedBoard.props || []),
      allDisplayProps: enrichList(scopedBoard.allDisplayProps || scopedBoard.usableProps || scopedBoard.props || []),
      usableProps: enrichList(scopedBoard.usableProps || scopedBoard.allDisplayProps || scopedBoard.props || []),
      qualifiedReadyProps: enrichList(scopedBoard.qualifiedReadyProps || scopedBoard.readyProps || []),
      acceptedPropsForRender: enrichList(
        scopedBoard.acceptedPropsForRender || scopedBoard.qualifiedReadyProps || scopedBoard.readyProps || []
      ),
      nearQualification: enrichList(scopedBoard.nearQualification || []),
      watchlist: enrichList(scopedBoard.watchlist || []).slice(0, 60),
      streakProps: enrichList(scopedBoard.streakProps || []).slice(0, 180),
      acceptedPropsCount: hasAccepted
        ? (scopedBoard.qualifiedReadyProps || scopedBoard.readyProps || scopedBoard.props || []).length
        : 0,
    };
    window.localStorage.setItem(DFS_CACHE_KEY, JSON.stringify(compactBoard));
  } catch (error) {
    console.warn("[DFS Pick'em] Cache skipped.", error);
  }
}

function isFailedEmptyBoard(board = {}) {
  const hasVisibleProps =
    (Array.isArray(board.props) && board.props.length > 0) ||
    (Array.isArray(board.qualifiedReadyProps) && board.qualifiedReadyProps.length > 0) ||
    (Array.isArray(board.readyProps) && board.readyProps.length > 0) ||
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
    platform: prop.platform || prop.source || "",
    sportsbook: prop.sportsbook || prop.platform || prop.source || "",
    sport: prop.sport || "MLB",
    playerName: prop.playerName,
    statType: prop.statType,
    line: prop.line,
    side: prop.bestPick || prop.side || "",
    projection: prop.projection ?? prop.projectedValue ?? null,
    confidence: prop.confidenceScore ?? prop.confidence ?? null,
    edge: prop.edge ?? null,
    timestamp: new Date().toISOString(),
    resultStatus: outcome.resultStatus || outcome.status || "Pending",
    finalResult: outcome.resultStatus || outcome.status || "Pending",
    hit: outcome.hit ?? null,
    openingLine: prop.lineMovement?.openingLine ?? prop.line,
    closingLine: prop.line,
  };
  history.unshift(entry);
  writePropHistory(history);
  return history;
}

export { HISTORY_KEY, PARLAY_HISTORY_KEY, DFS_CACHE_KEY, LINE_MOVEMENT_KEY, MANUAL_STATS_KEY };
