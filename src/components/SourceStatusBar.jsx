import { styles, sourceStatusStyle } from "../theme/styles.js";
import { formatDateTime } from "../utils/formatters.js";
import { formatCooldownRemaining } from "../services/sourceRateLimit.js";
import { resolveSourceHealthState, healthStateStyle, HEALTH_STATES } from "../services/sourceHealth.js";

function mapStatus(raw) {
  const s = String(raw || "Pending");
  if (Object.values(HEALTH_STATES).includes(s.toUpperCase())) return s.toUpperCase();
  if (["Full", "Partial", "Fallback", "Failed", "Cached", "Stale", "Connected", "Unavailable", "active", "rate_limited", "cached"].includes(s)) {
    if (s === "rate_limited") return HEALTH_STATES.CACHED;
    if (s === "active" || s === "Connected" || s === "Full") return HEALTH_STATES.LIVE;
    if (s === "Unavailable") return HEALTH_STATES.DEGRADED;
    if (s === "Failed" || s === "Not Connected") return HEALTH_STATES.OFFLINE;
    if (s === "Cached") return HEALTH_STATES.CACHED;
    if (s === "Stale") return HEALTH_STATES.STALE;
  }
  if (/partial|fallback/i.test(s)) return HEALTH_STATES.DEGRADED;
  if (s === "Pending") return HEALTH_STATES.OFFLINE;
  return s;
}

function formatHealthTime(value) {
  if (!value) return "—";
  try {
    return formatDateTime(value);
  } catch {
    return value;
  }
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
  const boardHealth = resolveSourceHealthState({
    status: stale ? HEALTH_STATES.STALE : cacheStatus,
    lineSourceBadge: apiHealth?.cache?.status || cacheStatus,
    lastFetchAt: apiHealth?.cache?.lastFetchAt || lastUpdated,
    hasData: Boolean(lastUpdated),
  });

  const items = [
    ["PrizePicks", mapStatus(apiHealth?.PrizePicks?.lineSourceBadge || sourceStatus.PrizePicks)],
    ["Underdog", mapStatus(apiHealth?.Underdog?.lineSourceBadge || sourceStatus.Underdog)],
    ["Odds", mapStatus(apiHealth?.OddsAPI?.lineSourceBadge || sourceStatus["The Odds API"])],
    ["Injuries", mapStatus(sourceHealth.injuries || HEALTH_STATES.LIVE)],
    ["Cache", boardHealth],
  ];

  const healthRows = [
    {
      label: "PrizePicks API",
      ...apiHealth.PrizePicks,
      status: apiHealth?.PrizePicks?.lineSourceBadge || sourceStatus.PrizePicks,
    },
    {
      label: "Underdog API",
      ...apiHealth.Underdog,
      status: apiHealth?.Underdog?.lineSourceBadge || sourceStatus.Underdog,
    },
    {
      label: "Odds API",
      ...apiHealth.OddsAPI,
      status: apiHealth?.OddsAPI?.lineSourceBadge || sourceStatus["The Odds API"],
    },
    {
      label: "Upcoming slate",
      status: `${upcomingSlateCount} props`,
      badge: slateExcludedCount > 0 ? `${slateExcludedCount} excluded` : "",
      lastFetchAt: pregameWindowHours > 0 ? `Next ${pregameWindowHours}h window` : "All future games",
      cacheAge: "",
      cooldownRemainingMs: 0,
      requestCount: null,
      lastError: "",
    },
    {
      label: "Board cache",
      status: boardHealth,
      badge: "",
      lastFetchAt: apiHealth?.cache?.lastFetchAt || lastUpdated,
      cacheAge: apiHealth?.cache?.lastFetchAt ? formatHealthTime(apiHealth.cache.lastFetchAt) : "",
      cooldownRemainingMs: 0,
      requestCount: null,
      lastError: "",
    },
  ];

  return (
    <details style={styles.compactDetails} aria-label="API health">
      <summary style={styles.detailsSummary}>
        <span>
          <span style={styles.eyebrow}>Source health</span>
          <strong>API Health</strong>
        </span>
        <span style={styles.countPill}>{items.map(([, status]) => status).join(" / ")}</span>
      </summary>
      <section style={styles.apiHealthPanel}>
        <div style={styles.apiHealthHeader}>
          <strong style={styles.apiHealthTitle}>API health</strong>
          {devMode ? <span style={styles.apiHealthDevTag}>Dev throttle on</span> : null}
        </div>
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
            const health = mapStatus(row.status);
            return (
              <div key={row.label} style={styles.apiHealthRow}>
                <div style={styles.apiHealthRowTop}>
                  <span style={styles.sourceName}>{row.label}</span>
                  <span style={healthStateStyle(health)}>{health}</span>
                </div>
                <div style={styles.apiHealthMeta}>
                  {row.badge ? <span style={styles.lineSourceBadge(row.badge)}>{row.badge}</span> : null}
                  <span>Last OK: {formatHealthTime(row.lastFetchAt)}</span>
                  {row.cacheAge ? <span>Cache age: {row.cacheAge}</span> : null}
                  {Number(row.cooldownRemainingMs) > 0 ? (
                    <span>Cooldown: {formatCooldownRemaining(row.cooldownRemainingMs)}</span>
                  ) : null}
                  {row.requestCount != null ? <span>Requests: {row.requestCount}</span> : null}
                  {row.lastError ? <span>Last error: {row.lastError}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </details>
  );
}
