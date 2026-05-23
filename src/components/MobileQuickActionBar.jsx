import { memo } from "react";

function MobileQuickActionBar({ onRefresh, onNavigate, refreshDisabled = false, refreshLabel = "Refresh" }) {
  return (
    <nav className="mobile-quick-bar" aria-label="Quick actions">
      <button type="button" className="mobile-quick-bar-btn" onClick={onRefresh} disabled={refreshDisabled}>
        {refreshLabel}
      </button>
      <button type="button" className="mobile-quick-bar-btn" onClick={() => onNavigate?.("top-picks")}>
        Top Picks
      </button>
      <button type="button" className="mobile-quick-bar-btn" onClick={() => onNavigate?.("accepted")}>
        Accepted
      </button>
      <button type="button" className="mobile-quick-bar-btn" onClick={() => onNavigate?.("settings")}>
        Settings
      </button>
    </nav>
  );
}

export default memo(MobileQuickActionBar);
