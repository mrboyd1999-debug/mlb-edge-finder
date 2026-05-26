import { memo } from "react";

export const COMPACT_APP_TABS = [
  { id: "bestPlays", label: "Best Plays" },
  { id: "prizepicks", label: "PrizePicks" },
  { id: "underdog", label: "Underdog" },
  { id: "goblins", label: "Goblins" },
  { id: "demons", label: "Demons" },
  { id: "manual", label: "Manual" },
  { id: "saved", label: "Saved" },
];

function CompactAppTabs({ activeTab = "bestPlays", onChange }) {
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
