import { styles } from "../theme/styles.js";
import { formatDateTime } from "../utils/formatters.js";
import { formatCooldownRemaining } from "../services/sourceRateLimit.js";
import {
  resolveSourceHealthState,
  healthStateStyle,
  HEALTH_STATES,
  CONNECTION_LABELS,
  summarizeSourceCounts,
} from "../services/sourceHealth.js";

function mapStatus(raw) {
  const s = String(raw || "Pending");
  const upper = s.toUpperCase();
  if (Object.values(HEALTH_STATES).includes(upper)) return upper;
  if (["Full", "Partial", "Fallback", "Failed", "Cached", "Stale", "Connected", "Unavailable", "Empty", "active", "rate_limited", "cached", "empty"].includes(s)) {
    if (s === "rate_limited") return HEALTH_STATES.CACHED;
    if (s === "Empty" || s === "empty") return HEALTH_STATES.EMPTY;
    if (s === "active" || s === "Connected" || s === "Full") return HEALTH_STATES.LIVE;
    if (s === "Unavailable") return HEALTH_STATES.DEGRADED;
    if (s === "Failed" || s === "Not Connected") return HEALTH_STATES.FAILED;
    if (s === "Cached") return HEALTH_STATES.CACHED;
    if (s === "Stale") return HEALTH_STATES.STALE;
  }
  if (/partial|fallback/i.test(s)) return HEALTH_STATES.DEGRADED;
  if (s === "Pending") return HEALTH_STATES.NOT_CONFIGURED;
  return s;
}

function connectionHint(row = {}) {
  const status = mapStatus(row.status || row.lineSourceBadge);
  if (status === HEALTH_STATES.NOT_CONFIGURED) return CONNECTION_LABELS.NOT_CONFIGURED;
  if (status === HEALTH_STATES.EMPTY) return CONNECTION_LABELS.EMPTY;
  if (status === HEALTH_STATES.FAILED && /401|403|unauthorized|invalid key/i.test(String(row.lastError || ""))) {
    return CONNECTION_LABELS.INVALID;
  }
  if (status === HEALTH_STATES.CACHED || Number(row.cooldownRemainingMs) > 0) return CONNECTION_LABELS.RATE_LIMITED;
  if (status === HEALTH_STATES.LIVE) return CONNECTION_LABELS.CONNECTED;
  return "";
}

function formatHealthTime(value) {
  if (!value) return "—";
  try {
    return formatDateTime(value);
  } catch {
    return value;
  }
}

function chipStatusColor(status) {
  const text = String(status || "");
  const key = text.toUpperCase();
  if (/^LIVE\b/i.test(text) || key === HEALTH_STATES.LIVE) return "#86efac";
  if (/^CACHED\b/i.test(text) || key === HEALTH_STATES.CACHED) return "#93c5fd";
  if (/^TIMED OUT\b/i.test(text)) return "#fde047";
  if (key === HEALTH_STATES.EMPTY || /^EMPTY\b/i.test(text)) return "#cbd5e1";
  if (key === HEALTH_STATES.DEGRADED) return "#fdba74";
  if (key === HEALTH_STATES.FAILED || /^FAILED\b/i.test(text)) return "#fca5a5";
  return "#cbd5e1";
}

function formatChipStatus(row = {}) {
  if (row.statusLabel) return row.statusLabel;
  return mapStatus(row.status || row.lineSourceBadge);
}

function formatHealthRowStatus(row = {}) {
  if (row.statusLabel) return row.statusLabel;
  return mapStatus(row.status || row.lineSourceBadge);
}

function formatCountLine(row = {}) {
  const counts = summarizeSourceCounts(row);
  return `raw ${counts.rawCount} · parsed ${counts.parsedCount} · usable ${counts.usableCount}`;
}

export default function SourceStatusBar({
  sourceStatus = {},
  sourceHealth = {},
  cacheStatus = "",
  stale = false,
  apiHealth = {},
  lastUpdated = "",
  devMode = false,
  upcomingSlateCount = 0,
  slateExcludedCount = 0,
  pregameWindowHours = 24,
}) {
  const cacheCounts = summarizeSourceCounts(apiHealth.cache || {});
  const boardHealth = resolveSourceHealthState({
    status: stale ? HEALTH_STATES.STALE : cacheStatus,
    lineSourceBadge: apiHealth?.cache?.status || cacheStatus,
    lastFetchAt: apiHealth?.cache?.lastFetchAt || lastUpdated,
    hasData: cacheCounts.usableCount > 0,
    usableCount: cacheCounts.usableCount,
  });

  const items = [
    ["PrizePicks", formatChipStatus(apiHealth?.PrizePicks || { status: sourceStatus.PrizePicks })],
    ["Underdog", formatChipStatus(apiHealth?.Underdog || { status: sourceStatus.Underdog })],
    ["Odds", formatChipStatus(apiHealth?.OddsAPI || { status: sourceStatus["The Odds API"] })],
    ["SportsData", formatChipStatus(apiHealth?.SportsData || { status: sourceHealth.SportsDataIO || HEALTH_STATES.NOT_CONFIGURED })],
    ["Cache", apiHealth?.cache?.statusLabel || boardHealth],
  ];

  const healthRows = [
    {
      label: "PrizePicks",
      priority: 1,
      ...apiHealth.PrizePicks,
      status: apiHealth?.PrizePicks?.lineSourceBadge || sourceStatus.PrizePicks,
    },
    {
      label: "Underdog",
      priority: 2,
      ...apiHealth.Underdog,
      status: apiHealth?.Underdog?.lineSourceBadge || sourceStatus.Underdog,
    },
    {
      label: "Odds API",
      priority: 3,
      ...apiHealth.OddsAPI,
      status: apiHealth?.OddsAPI?.lineSourceBadge || sourceStatus["The Odds API"],
    },
    {
      label: "SportsDataIO",
      priority: 4,
      ...apiHealth.SportsData,
      status: apiHealth?.SportsData?.lineSourceBadge || sourceHealth.SportsDataIO || HEALTH_STATES.NOT_CONFIGURED,
      lastFetchAt: apiHealth?.SportsData?.lastFetchAt || "",
      cacheAge: apiHealth?.SportsData?.cacheAge || "",
      requestCount: apiHealth?.SportsData?.sessionRequestCount ?? apiHealth?.SportsData?.requestCount,
      lastError: apiHealth?.SportsData?.lastError || "",
      cooldownRemainingMs: 0,
    },
    {
      label: "Verified cache",
      priority: 5,
      status: boardHealth,
      rawCount: cacheCounts.rawCount,
      parsedCount: cacheCounts.parsedCount,
      usableCount: cacheCounts.usableCount,
      lastFetchAt: apiHealth?.cache?.lastFetchAt || lastUpdated,
      cacheAge: apiHealth?.cache?.cacheAge || (apiHealth?.cache?.lastFetchAt ? formatHealthTime(apiHealth.cache.lastFetchAt) : ""),
      cooldownRemainingMs: 0,
      requestCount: null,
      lastError: apiHealth?.cache?.lastError || "",
      sessionRequestCount: null,
    },
    {
      label: "Upcoming slate",
      priority: 99,
      status: `${upcomingSlateCount} props`,
      badge: slateExcludedCount > 0 ? `${slateExcludedCount} excluded` : "",
      lastFetchAt: pregameWindowHours > 0 ? `Next ${pregameWindowHours}h window` : "All future games",
      cacheAge: "",
      cooldownRemainingMs: 0,
      requestCount: null,
      lastError: "",
    },
  ].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  return (
    <section className="api-health-section" aria-label="API health">
      <div className="api-health-chips-row" aria-label="API status chips">
        {items.map(([name, status]) => (
          <span key={name} className="api-health-chip">
            <span className="api-health-chip-name">{name}:</span>
            <span className="api-health-chip-status" style={{ color: chipStatusColor(status) }}>
              {status}
            </span>
          </span>
        ))}
      </div>

      <details className="api-health-expand api-health-collapsed-default" style={styles.compactDetails}>
        <summary>API Health details</summary>
        <div className="api-health-full-panel">
          <section style={styles.apiHealthPanel}>
            <div style={styles.apiHealthHeader}>
              <strong style={styles.apiHealthTitle}>API health</strong>
              {devMode ? <span style={styles.apiHealthDevTag}>Dev throttle on</span> : null}
            </div>
            <p className="mobile-hide-verbose" style={styles.compactFlags}>
              Provider priority: PrizePicks → Underdog → Odds API → SportsData → verified cache
            </p>
            <div style={styles.sourceStatusBar}>
              {items.map(([name, status]) => (
                <div key={name} style={styles.sourceStatusItem}>
                  <span style={styles.sourceName}>{name}</span>
                  <span style={healthStateStyle(status)}>{status}</span>
                </div>
              ))}
            </div>
            <div style={styles.apiHealthGrid}>
              {healthRows.map((row) => {
                const health = formatHealthRowStatus(row);
                const hint = connectionHint(row);
                const sessionCount = row.sessionRequestCount ?? row.requestCount;
                const countLine = formatCountLine(row);
                return (
                  <div key={row.label} style={styles.apiHealthRow}>
                    <div style={styles.apiHealthRowTop}>
                      <span style={styles.sourceName}>{row.label}</span>
                      <span style={healthStateStyle(health)}>{health}</span>
                    </div>
                    <div style={styles.apiHealthMeta}>
                      {hint ? <span>{hint}</span> : null}
                      {row.badge ? <span style={styles.lineSourceBadge(row.badge)}>{row.badge}</span> : null}
                      {row.label !== "Upcoming slate" && devMode ? <span className="api-health-count-line">{countLine}</span> : null}
                      <span>Last OK: {formatHealthTime(row.lastFetchAt)}</span>
                      {devMode && row.cacheAge ? <span>Cache age: {row.cacheAge}</span> : null}
                      {Number(row.cooldownRemainingMs) > 0 ? (
                        <span>Cooldown: {formatCooldownRemaining(row.cooldownRemainingMs)}</span>
                      ) : null}
                      {devMode && sessionCount != null ? <span>Requests (session): {sessionCount}</span> : null}
                      {row.lastError ? (
                        <span className="api-health-error-preview">Last error: {row.lastError}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </details>
    </section>
  );
}
