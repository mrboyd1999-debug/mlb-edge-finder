import { memo, useMemo } from "react";
import { getOddsApiKey, getSportsDataApiKey } from "../services/runtimeSettings.js";
import { formatCooldownRemaining } from "../services/sourceRateLimit.js";

function badge(label, connected) {
  return (
    <span className={`compact-api-badge${connected ? " compact-api-badge--ok" : " compact-api-badge--bad"}`}>
      {label}: {connected ? "Connected" : "Not Connected"}
    </span>
  );
}

function sourceConnected(apiHealth = {}, key = "") {
  const row = apiHealth?.[key];
  if (!row) return false;
  const status = String(row.status || "").toLowerCase();
  return status === "ok" || status === "success" || status === "cached" || status === "live";
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
  const ppConnected = sourceConnected(apiHealth, "PrizePicks");
  const udConnected = sourceConnected(apiHealth, "Underdog");
  const dfsLabel = useMemo(() => {
    if (ppConnected && udConnected) return "Connected";
    if (ppConnected || udConnected) return "Partial";
    return "Not Connected";
  }, [ppConnected, udConnected]);

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
        {badge("Odds API", oddsConnected)}
        {badge("SportsDataIO", sportsDataConnected)}
        <span className={`compact-api-badge${dfsLabel === "Connected" ? " compact-api-badge--ok" : dfsLabel === "Partial" ? " compact-api-badge--warn" : " compact-api-badge--bad"}`}>
          PrizePicks/Underdog: {dfsLabel}
        </span>
      </div>
    </header>
  );
}

export default memo(CompactApiHeader);
