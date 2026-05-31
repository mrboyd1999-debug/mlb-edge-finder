import { useState } from "react";
import { styles } from "../theme/styles.js";

/** Lazy-mount debug panel content only when expanded. */
export default function LazyDebugDetails({ title, eyebrow = "Development", countLabel = "", children }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      style={styles.compactDetails}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary style={styles.detailsSummary}>
        <span>
          <span style={styles.eyebrow}>{eyebrow}</span>
          <strong>{title}</strong>
        </span>
        {countLabel ? <span style={styles.countPill}>{countLabel}</span> : null}
      </summary>
      {open ? <div style={styles.compactPanel}>{children}</div> : null}
    </details>
  );
}
