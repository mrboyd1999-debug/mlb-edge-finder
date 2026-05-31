import { resolveCacheLayer, formatCacheLayerLabel, CACHE_TTL } from "./smartCache.js";
import { countUsableProps } from "../utils/propShape.js";
import { formatProviderStatusLabel, resolveLiveBadge } from "../utils/livePropUsability.js";
import { normalizeSource } from "../utils/normalizeSource.js";

export const HEALTH_STATES = {
  LIVE: "LIVE",
  CACHED: "CACHED",
  STALE: "STALE",
  DEGRADED: "DEGRADED",
  OFFLINE: "OFFLINE",
  FAILED: "FAILED",
  EMPTY: "EMPTY",
  NOT_CONFIGURED: "NOT CONFIGURED",
};

export const EMPTY_SOURCE_MESSAGE = "Connected but no usable props parsed.";

export const CONNECTION_LABELS = {
  CONNECTED: "Connected",
  NOT_CONFIGURED: "Not configured",
  INVALID: "Invalid key or unauthorized",
  RATE_LIMITED: "Rate limited — using cache",
  EMPTY: EMPTY_SOURCE_MESSAGE,
};

export const CONNECTION_TIERS = {
  CONNECTED: "Connected",
  REFRESHING: "Refreshing",
  DEGRADED: "Degraded",
  WARNING: "Warning",
  FAILED: "Failed",
  PENDING: "Pending",
};

export const HEALTH_COLORS = {
  Connected: { bg: "rgba(34,197,94,0.18)", text: "#86efac", border: "rgba(34,197,94,0.35)" },
  Refreshing: { bg: "rgba(59,130,246,0.18)", text: "#93c5fd", border: "rgba(59,130,246,0.35)" },
  Degraded: { bg: "rgba(234,179,8,0.18)", text: "#fde047", border: "rgba(234,179,8,0.35)" },
  Warning: { bg: "rgba(234,179,8,0.18)", text: "#fde047", border: "rgba(234,179,8,0.35)" },
  Failed: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5", border: "rgba(239,68,68,0.3)" },
  Pending: { bg: "rgba(148,163,184,0.12)", text: "#cbd5e1", border: "rgba(148,163,184,0.28)" },
  LIVE: { bg: "rgba(34,197,94,0.18)", text: "#86efac", border: "rgba(34,197,94,0.35)" },
  CACHED: { bg: "rgba(59,130,246,0.18)", text: "#93c5fd", border: "rgba(59,130,246,0.35)" },
  STALE: { bg: "rgba(234,179,8,0.18)", text: "#fde047", border: "rgba(234,179,8,0.35)" },
  DEGRADED: { bg: "rgba(249,115,22,0.18)", text: "#fdba74", border: "rgba(249,115,22,0.35)" },
  OFFLINE: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5", border: "rgba(239,68,68,0.3)" },
  FAILED: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5", border: "rgba(239,68,68,0.3)" },
  EMPTY: { bg: "rgba(148,163,184,0.12)", text: "#cbd5e1", border: "rgba(148,163,184,0.28)" },
  "NOT CONFIGURED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1", border: "rgba(148,163,184,0.3)" },
};

const LEGACY_HEALTH_COLORS = {
  LIVE: HEALTH_COLORS.LIVE,
  CACHED: HEALTH_COLORS.CACHED,
  STALE: HEALTH_COLORS.STALE,
  DEGRADED: HEALTH_COLORS.DEGRADED,
  OFFLINE: HEALTH_COLORS.OFFLINE,
  FAILED: HEALTH_COLORS.FAILED,
  EMPTY: HEALTH_COLORS.EMPTY,
  "NOT CONFIGURED": HEALTH_COLORS["NOT CONFIGURED"],
};

export function healthStateStyle(state = "") {
  const key = String(state || "");
  const colors =
    HEALTH_COLORS[key] ||
    LEGACY_HEALTH_COLORS[String(key).toUpperCase()] ||
    HEALTH_COLORS.Pending;
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    background: colors.bg,
    color: colors.text,
    border: `1px solid ${colors.border}`,
  };
}

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** Count props currently rendered from a line provider. */
export function countActivePropsForSource(props = [], provider = "") {
  if (!Array.isArray(props)) return 0;
  const key = String(provider || "").toLowerCase();
  if (!key) return 0;
  return props.filter((prop) => {
    const src = normalizeSource(prop).toLowerCase();
    if (key.includes("prize")) return src === "prizepicks";
    if (key.includes("underdog")) return src === "underdog";
    return src === key;
  }).length;
}

/**
 * Provider status: active board props win over stale timeout flags.
 * CONNECTED — live refresh returned usable props.
 * DEGRADED — refresh timed out/failed but cached/active props still in use.
 * FAILED — no usable and no cached props available.
 */
export function resolveProviderConnectionStatus({
  usableCount = 0,
  activeUsableCount = 0,
  parsedCount = 0,
  rawCount = 0,
  cachedCount = 0,
  cached = false,
  fallback = false,
  partial = false,
  fetchFailed = false,
  timedOut = false,
} = {}) {
  const usable = finiteCount(usableCount);
  const active = finiteCount(activeUsableCount) || usable;
  const parsed = finiteCount(parsedCount);
  const raw = finiteCount(rawCount);
  const cachedProps = finiteCount(cachedCount);
  const hasCached = cached || cachedProps > 0;
  const hasActive = active > 0;
  const hasRefreshData = usable > 0 || parsed > 0;
  const refreshDegraded = timedOut || fetchFailed || fallback || partial;

  if (hasActive) {
    const liveOk = usable > 0 && !refreshDegraded;
    if (liveOk) {
      return {
        tier: CONNECTION_TIERS.CONNECTED,
        badge: HEALTH_STATES.LIVE,
        connected: true,
        degraded: false,
      };
    }
    return {
      tier: CONNECTION_TIERS.WARNING,
      badge: hasCached ? HEALTH_STATES.CACHED : HEALTH_STATES.DEGRADED,
      connected: true,
      degraded: true,
    };
  }

  if (hasRefreshData && hasCached) {
    return {
      tier: CONNECTION_TIERS.WARNING,
      badge: HEALTH_STATES.CACHED,
      connected: true,
      degraded: true,
    };
  }

  if (refreshDegraded || timedOut || fetchFailed) {
    if (hasCached) {
      return {
        tier: CONNECTION_TIERS.WARNING,
        badge: HEALTH_STATES.CACHED,
        connected: true,
        degraded: true,
      };
    }
    return { tier: CONNECTION_TIERS.FAILED, badge: HEALTH_STATES.FAILED, connected: false, degraded: false };
  }

  if (raw > 0) {
    return { tier: CONNECTION_TIERS.FAILED, badge: HEALTH_STATES.EMPTY, connected: false, degraded: false };
  }

  return { tier: CONNECTION_TIERS.FAILED, badge: HEALTH_STATES.EMPTY, connected: false, degraded: false };
}

export function formatIngestionMetrics(row = {}) {
  const raw = finiteCount(row.rawCount ?? row.rawPropsLoaded);
  const parsed = finiteCount(row.parsedCount ?? row.propsAfterParsing);
  const usable = finiteCount(row.usableCount ?? row.usablePropsCount);
  const filtered = finiteCount(row.filteredCount ?? Math.max(0, parsed - usable));
  const cached = finiteCount(
    row.cachedCount ?? (row.lineSourceBadge === HEALTH_STATES.CACHED || /cached/i.test(String(row.statusLabel || "")) ? usable || parsed : 0)
  );
  return {
    rawCount: raw,
    parsedCount: parsed,
    usableCount: usable,
    filteredCount: filtered,
    cachedCount: cached,
    summary: `raw ${raw} · parsed ${parsed} · usable ${usable} · filtered ${filtered}${cached > 0 ? ` · cached ${cached}` : ""}`,
  };
}

/** Merge pipeline + apiHealth rows; prop counts always override stale Failed flags. */
export function resolveProviderPanelRow(apiRow = {}, pipelineRow = {}) {
  const row = { ...pipelineRow, ...apiRow };
  const metrics = formatIngestionMetrics(row);
  const cached =
    metrics.cachedCount > 0 ||
    /cached/i.test(String(row.statusLabel || row.lineSourceBadge || row.status || ""));
  const connection = resolveProviderConnectionStatus({
    usableCount: metrics.usableCount,
    parsedCount: metrics.parsedCount,
    rawCount: metrics.rawCount,
    cachedCount: metrics.cachedCount,
    cached,
    fallback: Boolean(row.fallback),
    fetchFailed: /failed|unavailable|offline/i.test(String(row.status || "")) && metrics.usableCount === 0 && metrics.parsedCount === 0,
  });
  return {
    ...row,
    ...metrics,
    connectionTier: connection.tier,
    status: connection.tier,
    ingestionSummary: row.ingestionSummary || metrics.summary,
  };
}

export function resolveFetchHealthBadge({
  ok = true,
  rateLimited = false,
  failed = false,
  timedOut = false,
  cached = false,
  rawCount = 0,
  parsedCount = 0,
  usableCount = 0,
  lastError = "",
  fallback = false,
  partial = false,
} = {}) {
  const connection = resolveProviderConnectionStatus({
    usableCount,
    parsedCount,
    rawCount,
    cached,
    fallback,
    partial,
    fetchFailed: failed || ok === false,
    timedOut,
  });

  const statusLabel = formatProviderStatusLabel({
    badge: connection.badge,
    usableCount,
    rawCount,
    parsedCount,
    failed: connection.tier === CONNECTION_TIERS.FAILED,
    timedOut,
    cached: cached || rateLimited || connection.warning,
    lastError,
    connectionTier: connection.tier,
  });

  if (connection.tier === CONNECTION_TIERS.CONNECTED) {
    return {
      pipelineStatus: cached || rateLimited ? "Cached" : "Full",
      badge: connection.badge,
      message: statusLabel,
      connectionTier: connection.tier,
    };
  }
  if (connection.tier === CONNECTION_TIERS.DEGRADED || connection.tier === CONNECTION_TIERS.WARNING) {
    return {
      pipelineStatus: cached || rateLimited || timedOut ? "Degraded" : "Degraded",
      badge: connection.badge,
      message: statusLabel,
      connectionTier: connection.degraded ? CONNECTION_TIERS.DEGRADED : connection.tier,
    };
  }
  if (timedOut && finiteCount(usableCount) === 0 && finiteCount(parsedCount) === 0) {
    return {
      pipelineStatus: "Timed out",
      badge: "TIMED OUT",
      message: statusLabel,
      connectionTier: cached ? CONNECTION_TIERS.WARNING : CONNECTION_TIERS.FAILED,
    };
  }
  if (rawCount > 0 && parsedCount === 0) {
    return {
      pipelineStatus: "Empty",
      badge: HEALTH_STATES.EMPTY,
      message: statusLabel || "Underdog connected, but parser returned 0 props.",
      connectionTier: CONNECTION_TIERS.WARNING,
    };
  }
  return {
    pipelineStatus: "Failed",
    badge: connection.badge,
    message: statusLabel,
    connectionTier: connection.tier,
  };
}

export { formatProviderStatusLabel } from "../utils/livePropUsability.js";

export function resolveSourceHealthState({
  status = "",
  lineSourceBadge = "",
  lastFetchAt = "",
  ttlMs = CACHE_TTL.PROPS_MS,
  hasData = false,
  usableCount = 0,
} = {}) {
  const badge = String(lineSourceBadge || "").toUpperCase();
  if (Object.values(HEALTH_STATES).includes(badge)) return badge;

  const normalized = String(status || "").toLowerCase();
  if ((normalized === "failed" || normalized === "not connected") && usableCount > 0) {
    return HEALTH_STATES.LIVE;
  }
  if (normalized === "failed" || normalized === "not connected") {
    return lastFetchAt ? HEALTH_STATES.DEGRADED : HEALTH_STATES.OFFLINE;
  }
  if (normalized === "unavailable") {
    return lastFetchAt ? HEALTH_STATES.DEGRADED : HEALTH_STATES.OFFLINE;
  }
  if (normalized === "empty") return HEALTH_STATES.EMPTY;
  if (normalized === "cached") {
    return usableCount > 0 || hasData ? HEALTH_STATES.CACHED : HEALTH_STATES.EMPTY;
  }

  const hasUsable = usableCount > 0 || hasData;

  if (lastFetchAt && hasUsable) {
    const ts = new Date(lastFetchAt).getTime();
    if (Number.isFinite(ts)) {
      const layer = resolveCacheLayer(ts, ttlMs);
      if (layer === "LIVE") return HEALTH_STATES.LIVE;
      if (layer === "CACHED") return HEALTH_STATES.CACHED;
      if (layer === "STALE") return HEALTH_STATES.STALE;
    }
  }

  if (!hasUsable) {
    if (normalized === "connected" || normalized === "full" || normalized === "partial") {
      return HEALTH_STATES.EMPTY;
    }
    return HEALTH_STATES.OFFLINE;
  }

  if (normalized === "connected" || normalized === "full") return HEALTH_STATES.LIVE;
  return HEALTH_STATES.DEGRADED;
}

export function formatHealthStateLabel(state = "") {
  return formatCacheLayerLabel(state) === "—" ? String(state || "—").toUpperCase() : formatCacheLayerLabel(state);
}

export function summarizeSourceCounts(row = {}) {
  return {
    rawCount: Number(row.rawPropsLoaded ?? row.rawCount ?? 0),
    parsedCount: Number(row.propsAfterParsing ?? row.parsedCount ?? 0),
    usableCount: Number(row.usablePropsCount ?? row.usableCount ?? countUsableProps(row.propsSample || [])),
  };
}
