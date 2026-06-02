import { memo } from "react";
import { resolveProviderLineDisplayRows } from "../utils/lineComparisonMerge.js";

function ProviderLabel({ prop = null, label = "", compact = false }) {
  if (label && !/live_provider|cache_provider|null|undefined/i.test(String(label))) {
    return (
      <span className={`provider-label-tag${compact ? " provider-label-tag--compact" : ""}`}>
        {label}
      </span>
    );
  }

  const rows = prop ? resolveProviderLineDisplayRows(prop) : [];
  if (!rows.length) return null;

  return (
    <div className={`provider-line-display${compact ? " provider-line-display--compact" : ""}`}>
      {rows.map((row) => (
        <div key={`${row.label}-${row.value}`} className="provider-line-display__row">
          <span className="provider-line-display__label">{row.label}</span>
          <strong className="provider-line-display__value">
            {row.value}
            {row.detail ? <span className="provider-line-display__detail"> ({row.detail})</span> : null}
          </strong>
        </div>
      ))}
    </div>
  );
}

export default memo(ProviderLabel);
