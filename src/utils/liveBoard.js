/**
 * Single canonical live board object — all UI/diagnostics read from here.
 */

import { countMergedProjections } from "./projectionCoverageAudit.js";
import { filterVerifiedSportsbookProps } from "./propValidation.js";

export const LIVE_BOARD_SOURCE_MODES = {
  LIVE: "live",
  CACHE: "cache",
  EMPTY: "empty",
};

export function resolveLiveBoardSourceMode({ normalizedCount = 0, cacheUsed = false } = {}) {
  if (Number(normalizedCount) > 0) return LIVE_BOARD_SOURCE_MODES.LIVE;
  if (cacheUsed) return LIVE_BOARD_SOURCE_MODES.CACHE;
  return LIVE_BOARD_SOURCE_MODES.EMPTY;
}

export function buildLiveBoard({
  rawProps = [],
  parsedProps = [],
  normalizedProps = [],
  projectedProps = [],
  verifiedProps = [],
  rankedProps = [],
  renderedProps = [],
  sourceMode = LIVE_BOARD_SOURCE_MODES.LIVE,
  cacheUsed = false,
  updatedAt = "",
} = {}) {
  const raw = Array.isArray(rawProps) ? rawProps : [];
  const parsed = Array.isArray(parsedProps) ? parsedProps : [];
  const normalized = Array.isArray(normalizedProps) ? normalizedProps : [];
  const projected = Array.isArray(projectedProps) ? projectedProps : [];
  const verified = Array.isArray(verifiedProps) ? verifiedProps : [];
  const ranked = Array.isArray(rankedProps) ? rankedProps : [];
  const rendered = Array.isArray(renderedProps) ? renderedProps : [];

  return {
    sourceMode,
    rawProps: raw,
    parsedProps: parsed,
    normalizedProps: normalized,
    projectedProps: projected,
    verifiedProps: verified,
    rankedProps: ranked,
    renderedProps: rendered,
    updatedAt: updatedAt || new Date().toISOString(),
    cacheUsed: Boolean(cacheUsed),
    counts: {
      raw: raw.length,
      parsed: parsed.length,
      normalized: normalized.length,
      projected: projected.length || countMergedProjections(normalized),
      verified: verified.length,
      ranked: ranked.length,
      rendered: rendered.length,
    },
  };
}

export function buildLiveBoardFromPipeline({
  rawProps = [],
  parsedProps = [],
  normalizedProps = [],
  allDisplayProps = [],
  rankedProps = [],
  renderedProps = [],
  cacheUsed = false,
  updatedAt = "",
} = {}) {
  const normalized = Array.isArray(normalizedProps) ? normalizedProps : [];
  const display = Array.isArray(allDisplayProps) ? allDisplayProps : [];
  const projected = display.filter((prop) => {
    const projection = Number(prop?.projection ?? prop?.projectedValue);
    return Number.isFinite(projection) && projection > 0;
  });

  return buildLiveBoard({
    rawProps,
    parsedProps,
    normalizedProps: normalized.length ? normalized : display,
    projectedProps: projected.length ? projected : display,
    verifiedProps: filterVerifiedSportsbookProps(display),
    rankedProps,
    renderedProps,
    sourceMode: resolveLiveBoardSourceMode({
      normalizedCount: normalized.length || display.length,
      cacheUsed,
    }),
    cacheUsed,
    updatedAt,
  });
}

export function pickLiveBoardRenderProps(liveBoard = null, fallback = []) {
  if (!liveBoard) return fallback || [];
  if (liveBoard.renderedProps?.length) return liveBoard.renderedProps;
  if (liveBoard.projectedProps?.length) return liveBoard.projectedProps;
  if (liveBoard.normalizedProps?.length) return liveBoard.normalizedProps;
  return fallback || [];
}
