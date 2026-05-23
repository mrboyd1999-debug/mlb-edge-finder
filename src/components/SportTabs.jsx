import { memo } from "react";
import { styles } from "../theme/styles.js";

function SportTabs({ options = [], active, onChange, boards = {} }) {
  return (
    <div className="sport-tabs-wrap" style={styles.segmentGroup}>
      <span className="mobile-hide-verbose" style={styles.controlLabel}>Category</span>
      <div className="sport-tabs-scroll" role="tablist" aria-label="Sport categories">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active === option.value}
            className={`sport-tab-chip${active === option.value ? " sport-tab-chip-active" : ""}`}
            style={active === option.value ? styles.segmentActive : styles.segment}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            <span className="sport-tab-count"> ({boards[option.value]?.generatedCount ?? 0})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default memo(SportTabs);
