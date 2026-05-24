import { memo } from "react";

const NAV_ITEMS = [
  { id: "refresh", label: "Refresh", icon: "↻", action: "refresh" },
  { id: "top-picks", label: "Picks", icon: "★", action: "section-top-picks" },
  { id: "manual-props", label: "Manual", icon: "✎", action: "section-manual-props" },
  { id: "accepted", label: "Accepted", icon: "✓", action: "section-accepted" },
  { id: "settings", label: "Settings", icon: "⚙", action: "section-settings" },
];

function MobileQuickActionBar({ onRefresh, onNavigate, refreshDisabled = false, refreshLabel = "Refresh" }) {
  return (
    <nav className="mobile-quick-bar" aria-label="Quick actions">
      {NAV_ITEMS.map((item) => {
        const isRefresh = item.action === "refresh";
        return (
          <button
            key={item.id}
            type="button"
            className="mobile-quick-bar-btn"
            onClick={() => (isRefresh ? onRefresh?.() : onNavigate?.(item.action))}
            disabled={isRefresh && refreshDisabled}
            aria-label={isRefresh ? refreshLabel : item.label}
          >
            <span className="mobile-quick-bar-icon" aria-hidden="true">{item.icon}</span>
            <span className="mobile-quick-bar-label">{isRefresh ? refreshLabel : item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default memo(MobileQuickActionBar);
