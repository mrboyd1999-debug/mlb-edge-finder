import { memo } from "react";

/** MLB-only navigation — verified plays, props feed, manual lookup, saved picks. */
export const COMPACT_APP_TABS = [
  { id: "bestPlays", label: "Verified Plays" },
  { id: "prizepicks", label: "MLB Props" },
  { id: "manual", label: "Player Lookup" },
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
