/**
 * Unified provider status — connected | warning | failed with live/cached/none source mode.
 */

export const PROVIDER_STATUS = {
  CONNECTED: "connected",
  WARNING: "warning",
  FAILED: "failed",
};

export const PROVIDER_SOURCE_MODE = {
  LIVE: "live",
  CACHED: "cached",
  NONE: "none",
};

const STATUS_LABELS = {
  PrizePicks: {
    connected: (count) => `Live connected — ${count} props`,
    warning: (count) => `Using cached PrizePicks — live fetch failed (${count} props)`,
    failed: () => "Unavailable — no usable PrizePicks props",
  },
  Underdog: {
    connected: (count) => `Live connected — ${count} props`,
    warning: (count) => `Using cached Underdog — live fetch failed (${count} props)`,
    failed: () => "Unavailable — no usable Underdog props",
  },
  "MLB Stats API": {
    connected: () => "Connected — player logs available",
    warning: () => "Using cached MLB logs",
    failed: () => "Stats API unavailable",
  },
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function resolveProviderFeedStatus({
  provider = "",
  liveSuccess = false,
  cachedUsableCount = 0,
  liveUsableCount = 0,
  parsedCount = 0,
  lastChecked = "",
  details = "",
} = {}) {
  const liveCount = finite(liveUsableCount);
  const cachedCount = finite(cachedUsableCount);
  const parsed = finite(parsedCount);
  const usable = Math.max(liveCount, cachedCount, parsed);

  let status = PROVIDER_STATUS.FAILED;
  let sourceMode = PROVIDER_SOURCE_MODE.NONE;

  if (liveSuccess && liveCount > 0) {
    status = PROVIDER_STATUS.CONNECTED;
    sourceMode = PROVIDER_SOURCE_MODE.LIVE;
  } else if (cachedCount > 0 || (!liveSuccess && usable > 0)) {
    status = PROVIDER_STATUS.WARNING;
    sourceMode = PROVIDER_SOURCE_MODE.CACHED;
  } else if (liveSuccess && parsed > 0) {
    status = PROVIDER_STATUS.CONNECTED;
    sourceMode = PROVIDER_SOURCE_MODE.LIVE;
  }

  const labelFn = STATUS_LABELS[provider] || STATUS_LABELS.PrizePicks;
  const detail =
    status === PROVIDER_STATUS.CONNECTED
      ? labelFn.connected(usable)
      : status === PROVIDER_STATUS.WARNING
        ? labelFn.warning(usable)
        : labelFn.failed();

  return {
    provider,
    status,
    sourceMode,
    propsCount: usable,
    lastChecked,
    details: details || detail,
    displayStatus:
      status === PROVIDER_STATUS.CONNECTED ? "Connected" : status === PROVIDER_STATUS.WARNING ? "Warning" : "Failed",
    displayDetail: detail,
  };
}

export function resolveMlbStatsProviderStatus({
  liveOk = false,
  usingCache = false,
  profilesMatched = 0,
  gameLogsAttached = 0,
  lastChecked = "",
  error = "",
} = {}) {
  const hasLogs = finite(profilesMatched) > 0 || finite(gameLogsAttached) > 0;
  if (liveOk && hasLogs) {
    return resolveProviderFeedStatus({
      provider: "MLB Stats API",
      liveSuccess: true,
      liveUsableCount: Math.max(profilesMatched, gameLogsAttached, 1),
      lastChecked,
      details: resolveProviderFeedStatus({ provider: "MLB Stats API", liveSuccess: true, liveUsableCount: 1 }).details,
    });
  }
  if (hasLogs && usingCache) {
    return resolveProviderFeedStatus({
      provider: "MLB Stats API",
      liveSuccess: false,
      cachedUsableCount: Math.max(profilesMatched, gameLogsAttached, 1),
      lastChecked,
    });
  }
  return {
    provider: "MLB Stats API",
    status: PROVIDER_STATUS.FAILED,
    sourceMode: PROVIDER_SOURCE_MODE.NONE,
    propsCount: 0,
    lastChecked,
    details: error || "Stats API unavailable",
    displayStatus: "Failed",
    displayDetail: error || "Stats API unavailable",
  };
}
