import { memo, useMemo } from "react";
import { getOddsApiKey, getSportsDataApiKey } from "../services/runtimeSettings.js";
import { formatCooldownRemaining } from "../services/sourceRateLimit.js";
import { CONNECTION_TIERS } from "../services/sourceHealth.js";

function badgeClass(tier = "") {
  const key = String(tier || "").toLowerCase();
  if (key === "connected") return " compact-api-badge--ok";
  if (key === "warning") return " compact-api-badge--warn";
  if (key === "failed") return " compact-api-badge--bad";
  return "";
}

function sourceTier(apiHealth = {}, key = "") {
  const row = apiHealth?.[key];
  if (!row) return CONNECTION_TIERS.PENDING;
  if (row.connectionTier) return row.connectionTier;
  const usable = Number(row.usableCount) || 0;
  const parsed = Number(row.parsedCount) || 0;
  if (usable > 0 || parsed > 0) {
    return /cached|warning/i.test(String(row.statusLabel || "")) ? CONNECTION_TIERS.WARNING : CONNECTION_TIERS.CONNECTED;
  }
  const status = String(row.status || "").toLowerCase();
  if (status === "connected" || status === "full" || status === "live") return CONNECTION_TIERS.CONNECTED;
  if (/failed|unavailable|offline/i.test(status)) return CONNECTION_TIERS.FAILED;
  return CONNECTION_TIERS.PENDING;
}

function CompactApiHeader({
  title = "MLB Pick Finder",
  apiHealth = {},
  loading = false,
  refreshBlocked = false,
  refreshCountdownSec = 0,
  onRefresh,
  lastUpdated = "",
}) {
  const oddsConnected = Boolean(getOddsApiKey());
  const sportsDataConnected = Boolean(getSportsDataApiKey());
  const ppTier = sourceTier(apiHealth, "PrizePicks");
  const udTier = sourceTier(apiHealth, "Underdog");
  const dfsLabel = useMemo(() => {
    const connected = [ppTier, udTier].filter((tier) => tier === CONNECTION_TIERS.CONNECTED).length;
    const warning = [ppTier, udTier].filter((tier) => tier === CONNECTION_TIERS.WARNING).length;
    if (connected === 2) return { tier: CONNECTION_TIERS.CONNECTED, text: "Connected" };
    if (connected + warning >= 1) return { tier: CONNECTION_TIERS.WARNING, text: "Partial" };
    if (ppTier === CONNECTION_TIERS.FAILED && udTier === CONNECTION_TIERS.FAILED) {
      return { tier: CONNECTION_TIERS.FAILED, text: "Not Connected" };
    }
    return { tier: CONNECTION_TIERS.PENDING, text: "Pending" };
  }, [ppTier, udTier]);

  const refreshLabel = loading
    ? "Loading…"
    : refreshCountdownSec > 0
      ? `Wait ${formatCooldownRemaining(refreshCountdownSec * 1000)}`
      : "Refresh";

  return (
    <header className="compact-app-header">
      <div className="compact-app-header__top">
        <div>
          <h1 className="compact-app-header__title">{title}</h1>
          {lastUpdated ? <p className="compact-app-header__updated">Updated {lastUpdated}</p> : null}
        </div>
        <button
          type="button"
          className="compact-app-header__refresh"
          disabled={refreshBlocked || loading}
          onClick={onRefresh}
        >
          {refreshLabel}
        </button>
      </div>
      <div className="compact-app-header__badges">
        <span className={`compact-api-badge${oddsConnected ? " compact-api-badge--ok" : ""}`}>
          Odds API: {oddsConnected ? "Connected" : "Not Connected"}
        </span>
        <span className={`compact-api-badge${sportsDataConnected ? " compact-api-badge--ok" : ""}`}>
          SportsDataIO: {sportsDataConnected ? "Connected" : "Not Connected"}
        </span>
        <span className={`compact-api-badge${badgeClass(dfsLabel.tier)}`}>
          PrizePicks/Underdog: {dfsLabel.text}
        </span>
      </div>
    </header>
  );
}

export default memo(CompactApiHeader);
