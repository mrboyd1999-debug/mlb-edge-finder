const HISTORY_KEY = "props-of-the-day-history";
const PARLAY_HISTORY_KEY = "dfs-pickem-parlay-history";
const DFS_CACHE_KEY = "dfs-pickem-active-board-cache-v17";
const LINE_MOVEMENT_KEY = "dfs-pickem-line-movement";
export const DFS_CACHE_TTL_MS = 8 * 60 * 1000;

export function readHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
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

export function readCachedBoard(defaultSourceStatus = {}) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DFS_CACHE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const updatedAt = new Date(parsed.updatedAt).getTime();
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > DFS_CACHE_TTL_MS) return null;
    return {
      props: Array.isArray(parsed.props) ? parsed.props : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      streakProps: Array.isArray(parsed.streakProps) ? parsed.streakProps : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      sourceStatus: parsed.sourceStatus && typeof parsed.sourceStatus === "object" ? parsed.sourceStatus : defaultSourceStatus,
      sourceHealth: parsed.sourceHealth && typeof parsed.sourceHealth === "object" ? parsed.sourceHealth : {},
      debugInfo: parsed.debugInfo && typeof parsed.debugInfo === "object" ? parsed.debugInfo : null,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function compactPropForStorage(prop) {
  if (!prop || typeof prop !== "object") return prop;
  const { raw, rawLineMovement, ...rest } = prop;
  const modelSignal =
    rest.modelSignal && typeof rest.modelSignal === "object"
      ? Object.fromEntries(Object.entries(rest.modelSignal).filter(([key]) => key !== "raw"))
      : rest.modelSignal;
  return { ...rest, modelSignal };
}

export function writeCachedBoard(board) {
  try {
    const compactBoard = {
      ...board,
      props: (board.props || []).slice(0, 120).map(compactPropForStorage),
      watchlist: (board.watchlist || []).slice(0, 80).map(compactPropForStorage),
      streakProps: (board.streakProps || []).slice(0, 700).map(compactPropForStorage),
    };
    window.localStorage.setItem(DFS_CACHE_KEY, JSON.stringify(compactBoard));
  } catch (error) {
    console.warn("[DFS Pick'em] Cache skipped.", error);
  }
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
    return parsed && typeof parsed === "object" ? parsed : {};
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

export { HISTORY_KEY, PARLAY_HISTORY_KEY, DFS_CACHE_KEY, LINE_MOVEMENT_KEY };
