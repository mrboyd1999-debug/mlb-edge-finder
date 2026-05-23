import { resolveCacheLayer, formatCacheLayerLabel, CACHE_TTL } from "./smartCache.js";

export const HEALTH_STATES = {
  LIVE: "LIVE",
  CACHED: "CACHED",
  STALE: "STALE",
  DEGRADED: "DEGRADED",
  OFFLINE: "OFFLINE",
};

const HEALTH_COLORS = {
  LIVE: { bg: "rgba(34,197,94,0.18)", text: "#86efac", border: "rgba(34,197,94,0.35)" },
  CACHED: { bg: "rgba(59,130,246,0.18)", text: "#93c5fd", border: "rgba(59,130,246,0.35)" },
  STALE: { bg: "rgba(234,179,8,0.18)", text: "#fde047", border: "rgba(234,179,8,0.35)" },
  DEGRADED: { bg: "rgba(249,115,22,0.18)", text: "#fdba74", border: "rgba(249,115,22,0.35)" },
  OFFLINE: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5", border: "rgba(239,68,68,0.3)" },
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

export function resolveSourceHealthState({
  status = "",
  lineSourceBadge = "",
  lastFetchAt = "",
  ttlMs = CACHE_TTL.PROPS_MS,
  hasData = true,
} = {}) {
  const badge = String(lineSourceBadge || "").toUpperCase();
  if (["LIVE", "CACHED", "STALE", "DEGRADED", "OFFLINE"].includes(badge)) return badge;

  const normalized = String(status || "").toLowerCase();
  if (normalized === "failed" || normalized === "not connected") {
    return lastFetchAt ? HEALTH_STATES.DEGRADED : HEALTH_STATES.OFFLINE;
  }
  if (normalized === "unavailable") {
    return lastFetchAt ? HEALTH_STATES.DEGRADED : HEALTH_STATES.OFFLINE;
  }
  if (normalized === "cached") return HEALTH_STATES.CACHED;

  if (lastFetchAt) {
    const ts = new Date(lastFetchAt).getTime();
    if (Number.isFinite(ts)) {
      const layer = resolveCacheLayer(ts, ttlMs);
      if (layer === "LIVE") return HEALTH_STATES.LIVE;
      if (layer === "CACHED") return HEALTH_STATES.CACHED;
      if (layer === "STALE") return HEALTH_STATES.STALE;
    }
  }

  if (!hasData) return HEALTH_STATES.OFFLINE;
  if (normalized === "connected" || normalized === "full") return HEALTH_STATES.LIVE;
  return HEALTH_STATES.DEGRADED;
}

export function formatHealthStateLabel(state = "") {
  return formatCacheLayerLabel(state) === "—" ? String(state || "—").toUpperCase() : formatCacheLayerLabel(state);
}
