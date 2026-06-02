import { memo } from "react";
import ProviderLabel from "./ProviderLabel.jsx";

function DataSourceTag({ prop = null, tag = "", cacheStatus = "", compact = false }) {
  const label = prop?.providerLabel || tag || "";
  if (!label || /live_provider|cache_provider|null|undefined/i.test(String(label))) {
    return <ProviderLabel prop={prop} cacheStatus={cacheStatus} compact={compact} />;
  }
  return (
    <span className={`data-source-tag${compact ? " data-source-tag--compact" : ""}`}>
      {label}
    </span>
  );
}

export default memo(DataSourceTag);
