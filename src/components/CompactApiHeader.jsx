import { memo } from "react";
import { formatCooldownRemaining } from "../services/sourceRateLimit.js";

function CompactApiHeader({
  title = "MLB Pick Finder",
  loading = false,
  refreshBlocked = false,
  refreshCountdownSec = 0,
  onRefresh,
  lastUpdated = "",
}) {
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
    </header>
  );
}

export default memo(CompactApiHeader);
