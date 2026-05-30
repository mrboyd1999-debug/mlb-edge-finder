/**
 * Instant-start localStorage caches for props, projections, and verified plays.
 */

import { readCachedBoard, readVerifiedCacheBoard } from "./pickStore.js";
import { readLastGoodBoard, boardFromLastGood } from "./lastGoodBoardCache.js";
import {
  selectStartupProjectionCandidates,
  STARTUP_PROJECTION_CANDIDATE_LIMIT,
} from "../utils/startupPerformance.js";

const CACHE_KEYS = {
  props: "mlb-last-good-props-v1",
  projections: "mlb-last-good-projections-v1",
  verifiedPlays: "mlb-last-good-verified-plays-v1",
};

const MAX_STORED_PROPS = 120;
const MAX_STORED_VERIFIED = 20;

function safeParse(raw) {
  try {
    return JSON.parse(raw || "null");
  } catch {
    return null;
  }
}

function hasProps(rows = []) {
  return Array.isArray(rows) && rows.length > 0;
}

function readJson(key) {
  try {
    return safeParse(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export function readStartupSliceCache() {
  return {
    props: readJson(CACHE_KEYS.props),
    projections: readJson(CACHE_KEYS.projections),
    verifiedPlays: readJson(CACHE_KEYS.verifiedPlays),
  };
}

export function writeStartupSliceCache({ props = [], projections = [], verifiedPlays = [] } = {}) {
  if (hasProps(props)) {
    writeJson(CACHE_KEYS.props, {
      updatedAt: new Date().toISOString(),
      props: props.slice(0, MAX_STORED_PROPS),
    });
  }
  if (hasProps(projections)) {
    writeJson(CACHE_KEYS.projections, {
      updatedAt: new Date().toISOString(),
      projections: projections.slice(0, STARTUP_PROJECTION_CANDIDATE_LIMIT),
    });
  }
  if (hasProps(verifiedPlays)) {
    writeJson(CACHE_KEYS.verifiedPlays, {
      updatedAt: new Date().toISOString(),
      verifiedPlays: verifiedPlays.slice(0, MAX_STORED_VERIFIED),
    });
  }
}

/** Best available board for instant paint on app start. */
export function readInstantStartupBoard(defaultSourceStatus = {}) {
  const verified = readVerifiedCacheBoard(defaultSourceStatus, { allowExpired: true });
  if (verified?.allDisplayProps?.length || verified?.props?.length) {
    return { board: verified, layer: "verified-cache" };
  }
  const cached = readCachedBoard(defaultSourceStatus, { allowExpired: true });
  if (cached?.allDisplayProps?.length || cached?.props?.length) {
    return { board: cached, layer: "board-cache" };
  }
  const slice = readStartupSliceCache();
  if (hasProps(slice.props?.props)) {
    const props = slice.props.props;
    return {
      board: {
        props,
        allDisplayProps: props,
        usableProps: props,
        qualifiedReadyProps: slice.verifiedPlays?.verifiedPlays || props.slice(0, 10),
        updatedAt: slice.props.updatedAt,
        sourceStatus: defaultSourceStatus,
        pipelineFallback: true,
        cacheNotice: "Showing cached props — refreshing in background",
      },
      layer: "startup-props-cache",
    };
  }
  const lastGood = readLastGoodBoard();
  if (lastGood) {
    return {
      board: boardFromLastGood(lastGood, defaultSourceStatus),
      layer: "last-good",
    };
  }
  return null;
}

export function persistStartupBoardSlices(board = {}) {
  const props = board.allDisplayProps || board.props || board.usableProps || [];
  if (!props.length) return;
  const projections = selectStartupProjectionCandidates(props);
  const verifiedPlays =
    board.qualifiedReadyProps ||
    board.acceptedPropsForRender ||
    board.sections?.[0]?.picks ||
    projections.slice(0, 10);
  writeStartupSliceCache({ props, projections, verifiedPlays });
}
