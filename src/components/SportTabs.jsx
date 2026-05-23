import { styles } from "../theme/styles.js";

export default function SportTabs({ options = [], active, onChange, boards = {} }) {
  return (
    <div style={styles.segmentGroup}>
      <span style={styles.controlLabel}>Category</span>
      <div style={styles.segmentRow}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            style={active === option.value ? styles.segmentActive : styles.segment}
            onClick={() => onChange(option.value)}
          >
            {option.label} ({boards[option.value]?.generatedCount ?? 0})
          </button>
        ))}
      </div>
    </div>
  );
}
