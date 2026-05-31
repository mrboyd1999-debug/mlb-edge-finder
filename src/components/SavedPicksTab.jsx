import { memo } from "react";
import CompactPropCard from "./CompactPropCard.jsx";

function SavedPicksTab({ picks = [], onOpen, onDelete, onClearAll }) {
  if (!picks.length) {
    return <p className="compact-empty">No saved picks yet. Analyze a prop and tap Save Pick.</p>;
  }

  return (
    <div className="compact-tab-panel">
      <div className="compact-section__head compact-section__head--row">
        <div>
          <h2>Saved Picks</h2>
          <p>{picks.length} saved analyzed picks</p>
        </div>
        <button type="button" className="compact-prop-card__btn compact-prop-card__btn--danger" onClick={onClearAll}>
          Clear all
        </button>
      </div>
      <div className="compact-card-list">
        {picks.map((prop, index) => (
          <CompactPropCard
            key={prop.id || `saved-${index}`}
            prop={prop}
            onOpen={onOpen}
            onDelete={onDelete}
            showSave={false}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(SavedPicksTab);
