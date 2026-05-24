import { resolveCacheLayer, formatCacheLayerLabel, CACHE_TTL } from "./smartCache.js";
import { countUsableProps } from "../utils/propShape.js";

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

const HEALTH_COLORS = {
  LIVE: { bg: "rgba(34,197,94,0.18)", text: "#86efac", border: "rgba(34,197,94,0.35)" },
  CACHED: { bg: "rgba(59,130,246,0.18)", text: "#93c5fd", border: "rgba(59,130,246,0.35)" },
  STALE: { bg: "rgba(234,179,8,0.18)", text: "#fde047", border: "rgba(234,179,8,0.35)" },
  DEGRADED: { bg: "rgba(249,115,22,0.18)", text: "#fdba74", border: "rgba(249,115,22,0.35)" },
  OFFLINE: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5", border: "rgba(239,68,68,0.3)" },
  FAILED: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5", border: "rgba(239,68,68,0.3)" },
  EMPTY: { bg: "rgba(148,163,184,0.12)", text: "#cbd5e1", border: "rgba(148,163,184,0.28)" },
  "NOT CONFIGURED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1", border: "rgba(148,163,184,0.3)" },
};

export function healthStateStyle(state = "") {
  const key = String(state || "").toUpperCase();
  const colors = HEALTH_COLORS[key] || HEALTH_COLORS.DEGRADED;
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

export function resolveFetchHealthBadge({
  ok = true,
  rateLimited = false,
  failed = false,
  cached = false,
  rawCount = 0,
  parsedCount = 0,
  usableCount = 0,
} = {}) {
  if (usableCount > 0 || parsedCount > 0) {
    if (rateLimited || cached) {
      return {
        pipelineStatus: "Cached",
        badge: HEALTH_STATES.CACHED,
        message: "",
      };
    }
    return {
      pipelineStatus: "Full",
      badge: HEALTH_STATES.LIVE,
      message: "",
    };
  }
  if (failed || ok === false) {
    return {
      pipelineStatus: "Failed",
      badge: HEALTH_STATES.DEGRADED,
      message: "",
    };
  }
  if (rateLimited || cached) {
    return {
      pipelineStatus: usableCount > 0 ? "Cached" : "Cached",
      badge: usableCount > 0 ? HEALTH_STATES.CACHED : HEALTH_STATES.CACHED,
      message: usableCount > 0 ? "" : rateLimited ? "Rate limited with no usable cached props." : EMPTY_SOURCE_MESSAGE,
    };
  }
  if (usableCount > 0) {
    return {
      pipelineStatus: "Full",
      badge: HEALTH_STATES.LIVE,
      message: "",
    };
  }
  return {
    pipelineStatus: "Empty",
    badge: HEALTH_STATES.EMPTY,
    message: rawCount > 0 || parsedCount > 0 ? EMPTY_SOURCE_MESSAGE : EMPTY_SOURCE_MESSAGE,
  };
}

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
  if ((normalized === "failed" || normalized === "not connected") && (usableCount > 0 || hasData)) {
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
