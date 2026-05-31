import { memo } from "react";
import { resolveProviderDisplayLabel } from "../utils/propDisplayFields.js";

function ProviderLabel({ prop = null, label = "", compact = false }) {
  const resolved = label || prop?.providerLabel || (prop ? resolveProviderDisplayLabel(prop) : "");
  if (!resolved || /live_provider|cache_provider|null|undefined/i.test(String(resolved))) return null;
  return (
    <span className={`provider-label-tag${compact ? " provider-label-tag--compact" : ""}`}>
      {resolved}
    </span>
  );
}

export default memo(ProviderLabel);
