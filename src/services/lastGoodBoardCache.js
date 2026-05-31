/** Persist last non-empty board for instant restore on fetch failure. */

const LAST_GOOD_BOARD_KEY = "dfs-last-good-board-v1";
const MAX_PROPS = 120;

function hasBoardProps(board = {}) {
  return Boolean(
    board?.allDisplayProps?.length ||
      board?.props?.length ||
      board?.usableProps?.length ||
      board?.qualifiedReadyProps?.length
  );
}

export function readLastGoodBoard() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_GOOD_BOARD_KEY) || "null");
    if (!parsed || !hasBoardProps(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLastGoodBoard(board = {}) {
  if (!hasBoardProps(board)) return;
  try {
    const props = (board.allDisplayProps || board.props || board.usableProps || []).slice(0, MAX_PROPS);
    window.localStorage.setItem(
      LAST_GOOD_BOARD_KEY,
      JSON.stringify({
        updatedAt: board.updatedAt || new Date().toISOString(),
        sourceStatus: board.sourceStatus || {},
        props,
        allDisplayProps: props,
        usableProps: props,
        pipelineFallback: Boolean(board.pipelineFallback),
        ingestionSource: board.ingestionSource || "live",
      })
    );
  } catch {
    // ignore quota errors
  }
}

export function boardFromLastGood(lastGood = {}, sourceStatus = {}) {
  const props = lastGood.allDisplayProps || lastGood.props || lastGood.usableProps || [];
  return {
    props,
    allDisplayProps: props,
    usableProps: props,
    qualifiedReadyProps: props,
    acceptedPropsForRender: props,
    streakProps: [],
    watchlist: [],
    nearQualification: [],
    sourceStatus: { ...sourceStatus, ...(lastGood.sourceStatus || {}) },
    pipelineFallback: true,
    ingestionSource: lastGood.ingestionSource || "last-good-cache",
    updatedAt: lastGood.updatedAt || new Date().toISOString(),
  };
}
