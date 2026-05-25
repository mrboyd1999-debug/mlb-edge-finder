import { memo } from "react";

export const COMPACT_APP_TABS = [
  { id: "manual", label: "Manual Analyzer" },
  { id: "bestPlays", label: "Best Plays" },
  { id: "goblins", label: "Goblins" },
  { id: "demons", label: "Demons" },
  { id: "saved", label: "Saved Picks" },
];

function CompactAppTabs({ activeTab = "manual", onChange }) {
  return (
    <nav className="compact-app-tabs" aria-label="Main sections">
      {COMPACT_APP_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`compact-app-tabs__btn${activeTab === tab.id ? " compact-app-tabs__btn--active" : ""}`}
          onClick={() => onChange?.(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export default memo(CompactAppTabs);
