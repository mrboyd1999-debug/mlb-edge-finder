import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";

/** Freshness tiers for verified MLB cache layers. */
export const FRESHNESS_TIERS = {
  LIVE: "LIVE",
  VERIFIED_CACHE: "VERIFIED_CACHE",
  STALE_WARNING: "STALE_WARNING",
  EXPIRED: "EXPIRED",
};

export const VERIFIED_CACHE_FALLBACK_MESSAGE = "Using recently verified cached MLB props.";
export const VERIFIED_CACHE_COOLDOWN_MESSAGE =
  "Live refresh paused during cooldown — showing recently verified cached MLB props.";

/** Default MLB verified cache window (5–10 min target). */
export const MLB_VERIFIED_CACHE_MS = 8 * 60 * 1000;
export const MLB_LIVE_CACHE_MS = 3 * 60 * 1000;
export const MLB_STALE_WARNING_MS = 12 * 60 * 1000;
export const MLB_CACHE_EXPIRED_MS = 15 * 60 * 1000;

/** Line-movement-sensitive props expire sooner. */
export const MLB_MOVEMENT_SENSITIVE_CACHE_MS = 5 * 60 * 1000;
export const MLB_MOVEMENT_SENSITIVE_STALE_MS = 8 * 60 * 1000;
export const MLB_MOVEMENT_SENSITIVE_EXPIRED_MS = 10 * 60 * 1000;

const MOVEMENT_SENSITIVE_MARKETS = new Set(["homeRuns", "stolenBases", "earnedRuns", "hitsAllowed"]);
const VOLATILE_MOVEMENT_TAGS = new Set(["volatile", "steamed"]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isGameNotExpired(prop = {}) {
  const status = String(prop.status || "").toLowerCase();
  return status !== "expired" && status !== "closed";
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseTimestamp(value = "") {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isLineMovementSensitiveProp(prop = {}) {
  const key = canonicalMarketKey(prop.statType || prop.marketKey || prop.market);
  if (MOVEMENT_SENSITIVE_MARKETS.has(key)) return true;
  const tag = String(prop.lineMovementTag || prop.lineMovement?.tag || "").toLowerCase();
  if (VOLATILE_MOVEMENT_TAGS.has(tag)) return true;
  if (prop.lineMovement?.againstPick) return true;
  const vol = finiteNumber(prop.volatility);
  return Number.isFinite(vol) && vol >= 3.25;
}

export function resolveFreshnessWindows(prop = {}) {
  if (isLineMovementSensitiveProp(prop)) {
    return {
      liveMs: Math.min(MLB_LIVE_CACHE_MS, 2 * 60 * 1000),
      verifiedMs: MLB_MOVEMENT_SENSITIVE_CACHE_MS,
      staleMs: MLB_MOVEMENT_SENSITIVE_STALE_MS,
      expiredMs: MLB_MOVEMENT_SENSITIVE_EXPIRED_MS,
    };
  }
  return {
    liveMs: MLB_LIVE_CACHE_MS,
    verifiedMs: MLB_VERIFIED_CACHE_MS,
    staleMs: MLB_STALE_WARNING_MS,
    expiredMs: MLB_CACHE_EXPIRED_MS,
  };
}

export function resolveFreshnessTier(ageMs = 0, prop = {}) {
  const windows = resolveFreshnessWindows(prop);
  if (ageMs <= windows.liveMs) return FRESHNESS_TIERS.LIVE;
  if (ageMs <= windows.verifiedMs) return FRESHNESS_TIERS.VERIFIED_CACHE;
  if (ageMs <= windows.staleMs) return FRESHNESS_TIERS.STALE_WARNING;
  if (ageMs <= windows.expiredMs) return FRESHNESS_TIERS.EXPIRED;
  return FRESHNESS_TIERS.EXPIRED;
}

export function isLineMovementStable(prop = {}) {
  const tag = String(prop.lineMovementTag || prop.lineMovement?.tag || "").toLowerCase();
  if (VOLATILE_MOVEMENT_TAGS.has(tag)) return false;
  if (prop.lineMovement?.againstPick) return false;
  if (tag === "stable" || tag === "hold") return true;
  const delta = finiteNumber(prop.lineMovement?.delta ?? prop.lineMovement?.change);
  if (Number.isFinite(delta) && Math.abs(delta) >= 0.5) return false;
  return true;
}

export function computeFreshnessScore(prop = {}, ageMs = 0) {
  const windows = resolveFreshnessWindows(prop);
  const ageRatio = ageMs / Math.max(1, windows.verifiedMs);
  let score = clamp(Math.round(100 - ageRatio * 42), 0, 100);

  if (isLineMovementStable(prop)) score += 8;
  else score -= 14;

  const edge = finiteNumber(prop.edge);
  if (Number.isFinite(edge) && edge >= 1) score += 4;

  const confidence = finiteNumber(prop.confidenceScore ?? prop.confidence);
  if (Number.isFinite(confidence) && confidence >= 60) score += 4;

  if (prop.hasVerifiedStats || prop.manualEnriched) score += 4;
  if (prop.projectionSource && prop.projectionSource !== "missing") score += 3;

  const tier = resolveFreshnessTier(ageMs, prop);
  if (tier === FRESHNESS_TIERS.EXPIRED) score = Math.min(score, 20);
  if (tier === FRESHNESS_TIERS.STALE_WARNING) score = Math.min(score, 62);

  return clamp(Math.round(score), 0, 100);
}

export function attachCacheMetadata(prop = {}, { verifiedAt = "", boardUpdatedAt = "", now = Date.now() } = {}) {
  const verifiedAtMs = parseTimestamp(prop.verifiedAt || verifiedAt || boardUpdatedAt) || now;
  const ageMs = Math.max(0, now - verifiedAtMs);
  const lastLineMove =
    prop.lastLineMove ||
    prop.lineMovement?.updatedAt ||
    prop.lineMovement?.observedAt ||
    prop.lineMovement?.timestamp ||
    verifiedAt;
  const freshnessTier = resolveFreshnessTier(ageMs, prop);
  const freshnessScore = computeFreshnessScore(prop, ageMs);
  const lineSourceBadge =
    freshnessTier === FRESHNESS_TIERS.LIVE
      ? "LIVE"
      : freshnessTier === FRESHNESS_TIERS.EXPIRED
        ? "STALE"
        : "CACHED";

  return {
    ...prop,
    verifiedAt: new Date(verifiedAtMs).toISOString(),
    lastLineMove: lastLineMove || new Date(verifiedAtMs).toISOString(),
    cacheAgeMs: ageMs,
    cacheAgeLabel: formatCacheAgeLabel(ageMs),
    freshnessScore,
    freshnessTier,
    lineSourceBadge,
    cacheFallback: freshnessTier !== FRESHNESS_TIERS.LIVE,
  };
}

export function formatCacheAgeLabel(ageMs = 0) {
  if (ageMs < 60_000) return `${Math.max(1, Math.round(ageMs / 1000))}s`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m`;
  return `${(ageMs / 3_600_000).toFixed(1)}h`;
}

export function isPropCacheUsable(prop = {}, { verifiedAt = "", boardUpdatedAt = "", now = Date.now(), minFreshnessScore = 52 } = {}) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (!isGameNotExpired(prop)) return false;
  const enriched = attachCacheMetadata(prop, { verifiedAt, boardUpdatedAt, now });
  if (enriched.freshnessTier === FRESHNESS_TIERS.EXPIRED) return false;
  if (enriched.freshnessScore < minFreshnessScore) return false;
  if (isLineMovementSensitiveProp(prop) && !isLineMovementStable(prop) && enriched.freshnessTier !== FRESHNESS_TIERS.LIVE) {
    return false;
  }
  const start = new Date(prop.startTime).getTime();
  if (Number.isFinite(start) && start <= now) return false;
  return true;
}

export function filterUsableCachedProps(props = [], boardMeta = {}) {
  const verifiedAt = boardMeta.verifiedAt || boardMeta.updatedAt || "";
  const boardUpdatedAt = boardMeta.updatedAt || verifiedAt;
  const now = Date.now();
  return props
    .filter((prop) => isPropCacheUsable(prop, { verifiedAt, boardUpdatedAt, now }))
    .map((prop) => attachCacheMetadata(prop, { verifiedAt, boardUpdatedAt, now }));
}

export function prepareVerifiedCacheBoard(board = {}, { now = Date.now() } = {}) {
  if (!board || typeof board !== "object") return null;
  const verifiedAt = board.verifiedAt || board.updatedAt || new Date(now).toISOString();
  const boardUpdatedAt = board.updatedAt || verifiedAt;
  const props = filterUsableCachedProps(board.props || [], { verifiedAt, updatedAt: boardUpdatedAt });
  const qualifiedReadyProps = filterUsableCachedProps(board.qualifiedReadyProps || board.readyProps || [], {
    verifiedAt,
    updatedAt: boardUpdatedAt,
  });
  const nearQualification = filterUsableCachedProps(board.nearQualification || [], { verifiedAt, updatedAt: boardUpdatedAt });
  const streakProps = filterUsableCachedProps(board.streakProps || [], { verifiedAt, updatedAt: boardUpdatedAt });
  const watchlist = filterUsableCachedProps(board.watchlist || [], { verifiedAt, updatedAt: boardUpdatedAt });

  if (!props.length && !qualifiedReadyProps.length) return null;

  const cacheAnalytics = buildCacheAnalytics([...props, ...qualifiedReadyProps], { verifiedAt, boardUpdatedAt, now });
  const freshnessTier = resolveBoardFreshnessTier(boardUpdatedAt, props[0] || qualifiedReadyProps[0]);

  return {
    ...board,
    props: props.length ? props : qualifiedReadyProps,
    qualifiedReadyProps: qualifiedReadyProps.length ? qualifiedReadyProps : props.filter((prop) => prop.isQualificationAccepted),
    nearQualification,
    streakProps,
    watchlist,
    verifiedAt,
    updatedAt: boardUpdatedAt,
    cacheMetadata: {
      verifiedAt,
      boardUpdatedAt,
      freshnessTier,
      cacheAnalytics,
      fallbackActive: freshnessTier !== FRESHNESS_TIERS.LIVE,
    },
    cacheAnalytics,
    cacheFallback: freshnessTier !== FRESHNESS_TIERS.LIVE,
    cacheNotice:
      freshnessTier === FRESHNESS_TIERS.LIVE ? "" : VERIFIED_CACHE_FALLBACK_MESSAGE,
  };
}

export function resolveBoardFreshnessTier(boardUpdatedAt = "", sampleProp = null) {
  const ts = parseTimestamp(boardUpdatedAt);
  if (!ts) return FRESHNESS_TIERS.EXPIRED;
  const ageMs = Math.max(0, Date.now() - ts);
  return resolveFreshnessTier(ageMs, sampleProp || {});
}

export function buildCacheAnalytics(props = [], { verifiedAt = "", boardUpdatedAt = "", now = Date.now() } = {}) {
  const tiers = {
    live: 0,
    verifiedCache: 0,
    staleWarning: 0,
    expired: 0,
  };
  let freshnessTotal = 0;
  let counted = 0;

  props.forEach((prop) => {
    const enriched = attachCacheMetadata(prop, { verifiedAt, boardUpdatedAt, now });
    counted += 1;
    freshnessTotal += enriched.freshnessScore;
    if (enriched.freshnessTier === FRESHNESS_TIERS.LIVE) tiers.live += 1;
    else if (enriched.freshnessTier === FRESHNESS_TIERS.VERIFIED_CACHE) tiers.verifiedCache += 1;
    else if (enriched.freshnessTier === FRESHNESS_TIERS.STALE_WARNING) tiers.staleWarning += 1;
    else tiers.expired += 1;
  });

  return {
    live: tiers.live,
    cached: tiers.verifiedCache,
    stale: tiers.staleWarning,
    expired: tiers.expired,
    avgFreshnessScore: counted ? Math.round(freshnessTotal / counted) : 0,
    total: counted,
  };
}

export function readBoardCacheFreshness(board = {}) {
  const updatedAt = board.updatedAt || board.verifiedAt || "";
  const tier = resolveBoardFreshnessTier(updatedAt, board.props?.[0]);
  return {
    tier,
    isUsable: tier !== FRESHNESS_TIERS.EXPIRED && (board.props?.length || board.qualifiedReadyProps?.length),
    updatedAt,
  };
}

export function buildBoardCacheMetaFromFetch(board = {}) {
  const nowIso = new Date().toISOString();
  const props = board.props || [];
  return {
    verifiedAt: nowIso,
    updatedAt: board.updatedAt || nowIso,
    cacheAnalytics: buildCacheAnalytics(props, { verifiedAt: nowIso, boardUpdatedAt: board.updatedAt || nowIso }),
    lastSuccessfulVerificationAt: nowIso,
    acceptedProps: Number(board.qualifiedReadyProps?.length || board.readyProps?.length || 0),
  };
}
